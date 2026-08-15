import { spawn, ChildProcess } from 'node:child_process'
import { WindowsProcessManager } from './process.js'
import { WindowsEncodingUtils } from './encoding.js'

export interface CommandExecOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
}

export interface CommandExecResult {
  stdout: string
  stderr: string
  exitCode: number
  killedByTimeout: boolean
}

/**
 * High-reliability command execution runner tailored for Windows.
 */
export class WindowsCommandRunner {
  public static execute(command: string, options: CommandExecOptions = {}): Promise<CommandExecResult> {
    return new Promise((resolve) => {
      const { shell, args } = WindowsProcessManager.sanitizeShellArgs(command)
      const cwd = options.cwd || process.cwd()
      const env = { ...process.env, ...(options.env || {}) }

      let child: ChildProcess
      try {
        child = spawn(shell, args, { cwd, env, windowsHide: true })
      } catch (err: any) {
        return resolve({
          stdout: '',
          stderr: String(err),
          exitCode: 1,
          killedByTimeout: false,
        })
      }

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let isDone = false
      let killedByTimeout = false
      let timer: NodeJS.Timeout | null = null

      if (options.timeoutMs && options.timeoutMs > 0) {
        timer = setTimeout(async () => {
          if (!isDone && child.pid) {
            killedByTimeout = true
            await WindowsProcessManager.killProcessTree(child.pid)
          }
        }, options.timeoutMs)
      }

      child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
      child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

      child.on('close', (code) => {
        if (isDone) return
        isDone = true
        if (timer) clearTimeout(timer)

        const stdout = WindowsEncodingUtils.decodeBuffer(Buffer.concat(stdoutChunks))
        const stderr = WindowsEncodingUtils.decodeBuffer(Buffer.concat(stderrChunks))

        resolve({
          stdout,
          stderr,
          exitCode: code ?? (killedByTimeout ? 124 : 0),
          killedByTimeout,
        })
      })

      child.on('error', (err) => {
        if (isDone) return
        isDone = true
        if (timer) clearTimeout(timer)
        resolve({
          stdout: WindowsEncodingUtils.decodeBuffer(Buffer.concat(stdoutChunks)),
          stderr: err.message,
          exitCode: 1,
          killedByTimeout: false,
        })
      })
    })
  }
}
