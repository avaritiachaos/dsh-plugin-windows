import { spawn, ChildProcess } from 'node:child_process'
import { WindowsProcessManager } from './process.js'
import { WindowsEncodingUtils } from './encoding.js'

export interface CommandExecOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
  forceUtf8?: boolean
  enableProcessTreeGuard?: boolean
  /** Strict cap on total captured stdout+stderr bytes. */
  maxOutputBytes?: number
  /** TextDecoder label for stdout/stderr bytes, e.g. 'utf-8', 'gbk', 'cp1252', 'ibm850'. Default 'utf-8'. */
  encoding?: string
}

export interface CommandExecResult {
  stdout: string
  stderr: string
  exitCode: number
  signal: string | null
  timedOut: boolean
  /** Backward compatibility alias for `timedOut` (kept for 0.1.x callers). */
  killedByTimeout: boolean
  aborted: boolean
  /** Why the execution ended. Distinguishes real cleanup from failed cleanup. */
  terminationReason:
    | 'completed'
    | 'pre-abort'
    | 'spawn-error'
    | 'timeout'
    | 'aborted'
    | 'kill-failed'
    | 'cleanup-timeout'
  /** true when captured output exceeded maxOutputBytes and was truncated. */
  truncated: boolean
  /** bytes dropped because of maxOutputBytes. */
  droppedBytes: number
}

const MAX_SAFE_TIMEOUT = 2147483647 // 32-bit setTimeout ceiling (~24.8 days)
const DEFAULT_MAX_OUTPUT = 10 * 1024 * 1024 // 10MB
const KILL_GRACE_MS = 3000 // how long we wait for taskkill/process-group kill to finish
const FALLBACK_SETTLE_MS = 1500 // settle even if the kill helper never resolves

// POSIX signal numbers used to derive `128 + N` exit codes (M10).
const SIGNAL_NUMBERS: Record<string, number> = {
  SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGILL: 4, SIGTRAP: 5, SIGABRT: 6, SIGBUS: 7,
  SIGFPE: 8, SIGKILL: 9, SIGUSR1: 10, SIGSEGV: 11, SIGUSR2: 12, SIGPIPE: 13,
  SIGALRM: 14, SIGTERM: 15, SIGSTKFLT: 16, SIGCHLD: 17, SIGCONT: 18, SIGSTOP: 19,
  SIGTSTP: 20, SIGBREAK: 21, SIGTTIN: 22, SIGTTOU: 23, SIGURG: 24, SIGXCPU: 25,
  SIGXFSZ: 26, SIGVTALRM: 27, SIGPROF: 28, SIGWINCH: 29, SIGIO: 30, SIGPWR: 31,
  SIGSYS: 31,
}

const signalExitCode = (name: string | null): number => 128 + (name ? SIGNAL_NUMBERS[name] ?? 15 : 0)

export class WindowsCommandRunner {
  public static execute(command: string, options: CommandExecOptions = {}): Promise<CommandExecResult> {
    return new Promise((resolve) => {
      // 1. Pre-abort: never spawn when the signal is already aborted (C2).
      if (options.signal?.aborted) {
        return resolve({
          stdout: '',
          stderr: 'Command aborted before spawn.',
          exitCode: 130,
          signal: 'SIGINT',
          timedOut: false,
          killedByTimeout: false,
          aborted: true,
          terminationReason: 'pre-abort',
          truncated: false,
          droppedBytes: 0,
        })
      }

      const forceUtf8 = options.forceUtf8 ?? true
      const enableTreeGuard = options.enableProcessTreeGuard ?? true
      // Strict cap: non-finite or negative values fall back to the default
      // instead of silently discarding all output (M5).
      const maxBytes =
        Number.isFinite(options.maxOutputBytes) && options.maxOutputBytes! >= 0
          ? Math.floor(options.maxOutputBytes!)
          : DEFAULT_MAX_OUTPUT
      const encoding = options.encoding || 'utf-8'

      const { shell, args } = forceUtf8
        ? WindowsProcessManager.sanitizeShellArgs(command, { utf8Preset: true })
        : WindowsProcessManager.sanitizeShellArgs(command, { utf8Preset: false })

      const cwd = options.cwd || process.cwd()
      const env = { ...process.env, ...(options.env || {}) }

      let child: ChildProcess
      try {
        child = spawn(shell, args, {
          cwd,
          env,
          windowsHide: true,
          detached: process.platform !== 'win32', // POSIX: own process group for tree kill
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (err: any) {
        return resolve({
          stdout: '',
          stderr: String(err?.message || err),
          exitCode: 1,
          signal: null,
          timedOut: false,
          killedByTimeout: false,
          aborted: false,
          terminationReason: 'spawn-error',
          truncated: false,
          droppedBytes: 0,
        })
      }

      // --- shared termination state ------------------------------------------
      let isSettled = false
      let timedOut = false
      let aborted = false
      let truncated = false
      let droppedBytes = 0
      let totalBytes = 0
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let timer: NodeJS.Timeout | null = null
      let fallbackTimer: NodeJS.Timeout | null = null
      let killInFlight = false

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        if (fallbackTimer) {
          clearTimeout(fallbackTimer)
          fallbackTimer = null
        }
        if (options.signal) options.signal.removeEventListener('abort', onAbort)
        child.stdout?.removeAllListeners('data')
        child.stderr?.removeAllListeners('data')
        child.removeAllListeners('close')
        child.removeAllListeners('error')
      }

      const settle = (
        code: number | null,
        signalName: string | null,
        reason: CommandExecResult['terminationReason'],
      ) => {
        if (isSettled) return
        isSettled = true
        cleanup()

        // First-cause priority (M2): once timeout/abort fired, the exit code
        // reflects the cause (124/130), never taskkill's real exit code.
        let exitCode: number
        if (timedOut) exitCode = 124
        else if (aborted) exitCode = 130
        else if (code !== null) exitCode = code
        else exitCode = signalName ? signalExitCode(signalName) : 0

        const stdout = WindowsEncodingUtils.decodeBuffer(Buffer.concat(stdoutChunks), encoding)
        const stderr = WindowsEncodingUtils.decodeBuffer(Buffer.concat(stderrChunks), encoding)

        resolve({
          stdout,
          stderr,
          exitCode,
          signal: signalName,
          timedOut,
          killedByTimeout: timedOut,
          aborted,
          terminationReason: reason,
          truncated,
          droppedBytes,
        })
      }

      // Termination helper: bounded kill, reports failure instead of lying (C3).
      const terminateChild = async (cause: 'timeout' | 'aborted') => {
        if (killInFlight || isSettled || !child.pid) return
        killInFlight = true
        let killed = false
        try {
          if (enableTreeGuard) {
            killed = await WindowsProcessManager.killProcessTree(child.pid, KILL_GRACE_MS)
          } else {
            try {
              child.kill(cause === 'timeout' ? 'SIGKILL' : 'SIGINT')
              killed = true
            } catch {
              killed = false
            }
          }
        } finally {
          killInFlight = false
        }
        if (!killed && !isSettled) {
          // The process tree could not be terminated: report a cleanup failure
          // instead of pretending everything is fine.
          if (fallbackTimer) {
            clearTimeout(fallbackTimer)
            fallbackTimer = null
          }
          settle(null, cause === 'timeout' ? 'SIGKILL' : 'SIGINT', 'kill-failed')
        }
      }

      // 2. Timeout handling: first cause wins, fallback registered immediately (C3).
      if (Number.isFinite(options.timeoutMs) && (options.timeoutMs as number) > 0) {
        const clampedTimeout = Math.min(MAX_SAFE_TIMEOUT, Math.floor(options.timeoutMs as number))
        timer = setTimeout(() => {
          if (isSettled || aborted) return // first cause wins (M2)
          timedOut = true
          fallbackTimer = setTimeout(() => {
            // Last resort: even if the tree helper could not confirm the kill
            // (e.g. taskkill raced process startup), force-kill the direct
            // child so the event loop is not held until it exits on its own.
            try {
              child.kill('SIGKILL')
            } catch {
              /* already gone */
            }
            settle(null, 'SIGKILL', 'cleanup-timeout')
          }, FALLBACK_SETTLE_MS)
          void terminateChild('timeout')
        }, clampedTimeout)
      }

      // 3. AbortSignal listener with guard check and explicit cleanup (M1/M11).
      const onAbort = () => {
        if (isSettled || timedOut) return // first cause wins (M2)
        aborted = true
        fallbackTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL') // last resort: do not leave the child alive
          } catch {
            /* already gone */
          }
          settle(null, 'SIGINT', 'cleanup-timeout')
        }, FALLBACK_SETTLE_MS)
        void terminateChild('aborted')
      }
      if (options.signal) {
        options.signal.addEventListener('abort', onAbort, { once: true })
      }

      // 4. Stdio accumulation with a strict shared byte budget (M5).
      const accumulate = (chunks: Buffer[], chunk: Buffer) => {
        if (isSettled) return
        const budget = maxBytes - totalBytes
        if (budget <= 0) {
          truncated = true
          droppedBytes += chunk.length
          return
        }
        const keep = chunk.length > budget ? chunk.subarray(0, budget) : chunk
        if (keep.length < chunk.length) {
          truncated = true
          droppedBytes += chunk.length - keep.length
        }
        chunks.push(keep)
        totalBytes += keep.length
      }
      child.stdout?.on('data', (chunk: Buffer) => accumulate(stdoutChunks, chunk))
      child.stderr?.on('data', (chunk: Buffer) => accumulate(stderrChunks, chunk))

      // 5. close/error: idempotent, ignore late events after settle (M11a).
      child.on('close', (code, signal) => {
        if (isSettled) return
        settle(code, signal, timedOut ? 'timeout' : aborted ? 'aborted' : 'completed')
      })

      child.on('error', (err) => {
        if (isSettled) return // late spawn error after termination: drop it
        stderrChunks.push(Buffer.from(err.message || 'Spawn error'))
        settle(1, null, 'spawn-error')
      })
    })
  }
}
