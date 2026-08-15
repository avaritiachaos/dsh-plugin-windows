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
  maxOutputBytes?: number
}

export interface CommandExecResult {
  stdout: string
  stderr: string
  exitCode: number
  signal: string | null
  timedOut: boolean
  aborted: boolean
}

const MAX_SAFE_TIMEOUT = 2147483647 // 32-bit int limit for setTimeout (~24.8 days)
const DEFAULT_MAX_OUTPUT = 10 * 1024 * 1024 // 10MB

export class WindowsCommandRunner {
  public static execute(command: string, options: CommandExecOptions = {}): Promise<CommandExecResult> {
    return new Promise((resolve) => {
      const forceUtf8 = options.forceUtf8 ?? true
      const enableTreeGuard = options.enableProcessTreeGuard ?? true
      const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT

      const { shell, args } = forceUtf8
        ? WindowsProcessManager.sanitizeShellArgs(command)
        : { shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh', args: ['-Command', command] }

      const cwd = options.cwd || process.cwd()
      const env = { ...process.env, ...(options.env || {}) }

      let child: ChildProcess
      try {
        child = spawn(shell, args, {
          cwd,
          env,
          windowsHide: true,
          detached: process.platform !== 'win32', // Create process group on POSIX
        })
      } catch (err: any) {
        return resolve({
          stdout: '',
          stderr: String(err?.message || err),
          exitCode: 1,
          signal: null,
          timedOut: false,
          aborted: false,
        })
      }

      let totalBytes = 0
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let isSettled = false
      let timedOut = false
      let aborted = false
      let timer: NodeJS.Timeout | null = null

      const settle = (code: number | null, signalName: string | null = null) => {
        if (isSettled) return
        isSettled = true
        if (timer) clearTimeout(timer)

        let resolvedExitCode = code ?? (timedOut ? 124 : aborted ? 130 : signalName ? 1 : 0)
        if (code === null && !timedOut && !aborted && signalName) {
          resolvedExitCode = 128 + 15 // Standard SIGTERM code
        }

        const stdout = WindowsEncodingUtils.decodeBuffer(Buffer.concat(stdoutChunks))
        const stderr = WindowsEncodingUtils.decodeBuffer(Buffer.concat(stderrChunks))

        resolve({
          stdout,
          stderr,
          exitCode: resolvedExitCode,
          signal: signalName,
          timedOut,
          aborted,
        })
      }

      // 1. Timeout handling with safe range clamp
      if (Number.isFinite(options.timeoutMs) && (options.timeoutMs as number) > 0) {
        const clampedTimeout = Math.min(MAX_SAFE_TIMEOUT, Math.floor(options.timeoutMs as number))
        timer = setTimeout(async () => {
          if (!isSettled) {
            timedOut = true
            if (child.pid) {
              if (enableTreeGuard) {
                await WindowsProcessManager.killProcessTree(child.pid)
              } else {
                try { child.kill('SIGKILL') } catch {}
              }
            }
            // Fallback settle if close event doesn't fire within 1500ms
            setTimeout(() => settle(124, 'SIGKILL'), 1500)
          }
        }, clampedTimeout)
      }

      // 2. AbortSignal listener
      if (options.signal) {
        if (options.signal.aborted) {
          aborted = true
          if (child.pid) WindowsProcessManager.killProcessTree(child.pid).catch(() => {})
          return settle(130, 'SIGINT')
        }
        options.signal.addEventListener('abort', async () => {
          if (!isSettled) {
            aborted = true
            if (child.pid) {
              await WindowsProcessManager.killProcessTree(child.pid)
            }
            setTimeout(() => settle(130, 'SIGINT'), 1500)
          }
        })
      }

      // 3. Stdio streams with buffer limits
      child.stdout?.on('data', (chunk: Buffer) => {
        if (totalBytes < maxBytes) {
          stdoutChunks.push(chunk)
          totalBytes += chunk.length
        }
      })

      child.stderr?.on('data', (chunk: Buffer) => {
        if (totalBytes < maxBytes) {
          stderrChunks.push(chunk)
          totalBytes += chunk.length
        }
      })

      child.on('close', (code, signal) => {
        settle(code, signal)
      })

      child.on('error', (err) => {
        stderrChunks.push(Buffer.from(err.message || 'Spawn error'))
        settle(1, null)
      })
    })
  }
}
