import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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
   */
  public static async killProcessTree(pid: number): Promise<boolean> {
    if (!pid || pid <= 0) return false

    if (process.platform === 'win32') {
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
    } else {
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
    }
  }

  /**
   * Format command line arguments for PowerShell / CMD on Windows.
   */
  public static sanitizeShellArgs(command: string): { shell: string; args: string[] } {
    if (process.platform === 'win32') {
      // Use powershell.exe with -NoProfile and UTF-8 encoding preset
      return {
        shell: 'powershell.exe',
        args: [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`,
        ],
      }
    }

    return {
      shell: '/bin/bash',
      args: ['-c', command],
    }
  }
}
