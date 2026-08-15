import { Context, Service, Schema } from 'cordis'
import { WindowsPathUtils } from './path.js'
import { WindowsProcessManager } from './process.js'
import { WindowsEncodingUtils } from './encoding.js'
import { WindowsCommandRunner, CommandExecOptions, CommandExecResult } from './runner.js'

export interface WindowsPlatformConfig {
  /** Force UTF-8 on Windows command execution. Default: true */
  forceUtf8?: boolean
  /** Enable taskkill process tree guard. Default: true */
  enableProcessTreeGuard?: boolean
}

export const WindowsPlatformConfig: Schema<WindowsPlatformConfig> = Schema.object({
  forceUtf8: Schema.boolean().default(true).description('Force UTF-8 output encoding for PowerShell / CMD.'),
  enableProcessTreeGuard: Schema.boolean().default(true).description('Use taskkill /T /F for child process tree termination.'),
})

declare module 'cordis' {
  interface Context {
    windows: WindowsPlatformService
  }
}

/**
 * DeepSeek Harness Windows Platform Compatibility Service.
 * Provides Windows-safe process management, path normalization, UTF-8 command runner, and encoding guards.
 */
export class WindowsPlatformService extends Service {
  public path = WindowsPathUtils
  public process = WindowsProcessManager
  public encoding = WindowsEncodingUtils
  public runner = WindowsCommandRunner

  constructor(ctx: Context, private config: WindowsPlatformConfig = {}) {
    super(ctx, 'windows', true)
  }

  /**
   * Execute command safely with Windows UTF-8 encoding and timeout tree kill guard.
   */
  public exec(command: string, options?: CommandExecOptions): Promise<CommandExecResult> {
    return WindowsCommandRunner.execute(command, options)
  }

  protected start(): void {
    const isWin = process.platform === 'win32'
    this.ctx.logger.info(
      `[dsh-plugin-windows] Platform patch active (OS: ${process.platform}, ProcessTreeGuard: ON, UTF-8 Runner: READY)`
    )
  }
}

export { WindowsPathUtils, WindowsProcessManager, WindowsEncodingUtils, WindowsCommandRunner, CommandExecOptions, CommandExecResult }

export default function apply(ctx: Context, config: WindowsPlatformConfig = {}) {
  ctx.plugin(WindowsPlatformService, config)
}
