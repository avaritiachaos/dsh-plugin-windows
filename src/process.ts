import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface SanitizeShellOptions {
  /** Prepend a UTF-8 output-encoding preset for PowerShell. Default: true */
  utf8Preset?: boolean
}

/**
 * Windows-safe child process lifecycle manager.
 * Prevents zombie orphaned processes when executing tools or background dev servers.
 */
export class WindowsProcessManager {
  /**
   * Safely terminate a process and all of its spawned child processes (Entire Process Tree).
   *
   * On Windows: Uses `taskkill /F /T /PID <pid>`
   * On POSIX: Uses process group kill `process.kill(-pid, 'SIGKILL')`
   *
   * @param pid target process id
   * @param timeoutMs optional hard bound on the kill operation itself; when the
   *                  bound expires the promise resolves `false` (kill could not
   *                  be confirmed) instead of hanging forever.
   */
  public static async killProcessTree(pid: number, timeoutMs = 0): Promise<boolean> {
    if (!pid || pid <= 0) return false

    const op = process.platform === 'win32'
      ? (async (): Promise<boolean> => {
          try {
            await execFileAsync('taskkill', ['/F', '/T', '/PID', pid.toString()])
            return true
          } catch (err: any) {
            // Exit code 128 / 255 usually means process has already exited
            if (err && (err.code === 128 || err.code === 255 || String(err).includes('not found'))) {
              return true
            }
            // Fallback to standard process.kill
            try {
              process.kill(pid, 'SIGKILL')
              return true
            } catch {
              return false
            }
          }
        })()
      : (async (): Promise<boolean> => {
          try {
            process.kill(-pid, 'SIGKILL')
            return true
          } catch {
            try {
              process.kill(pid, 'SIGKILL')
              return true
            } catch {
              return false
            }
          }
        })()

    if (timeoutMs > 0) {
      return Promise.race([
        op,
        new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
      ])
    }
    return op
  }

  /**
   * Format command line arguments for PowerShell / CMD on Windows.
   *
   * @param utf8Preset when true, prepend `[Console]::OutputEncoding = UTF8`;
   *                   when false, the shell still runs sanitized
   *                   (-NoProfile/-NonInteractive/ExecutionPolicy Bypass) but
   *                   output bytes are decoded with the caller-provided decoder.
   */
  public static sanitizeShellArgs(command: string, options: SanitizeShellOptions = {}): { shell: string; args: string[] } {
    const utf8Preset = options.utf8Preset ?? true

    if (process.platform === 'win32') {
      const preset = utf8Preset ? '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' : ''
      return {
        shell: 'powershell.exe',
        args: [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `${preset}${command}`,
        ],
      }
    }

    return {
      shell: '/bin/bash',
      args: ['-c', command],
    }
  }
}
