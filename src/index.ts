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
  /** Default timeout in milliseconds for command execution */
  defaultTimeoutMs?: number
}

export const WindowsPlatformConfig: Schema<WindowsPlatformConfig> = Schema.object({
  forceUtf8: Schema.boolean().default(true).description('Force UTF-8 output encoding for PowerShell / CMD.'),
  enableProcessTreeGuard: Schema.boolean().default(true).description('Use taskkill /T /F for child process tree termination.'),
  defaultTimeoutMs: Schema.number().default(0).description('Default command timeout in milliseconds (0 for unlimited).'),
})

declare module 'cordis' {
  interface Context {
    windows: WindowsPlatformService
  }
}

/**
 * DeepSeek Harness Windows Platform Compatibility Service.
 */
export class WindowsPlatformService extends Service<WindowsPlatformConfig> {
  public path = WindowsPathUtils
  public process = WindowsProcessManager
  public encoding = WindowsEncodingUtils
  public runner = WindowsCommandRunner

  constructor(ctx: Context, config: WindowsPlatformConfig = {}) {
    super(ctx, 'windows', true)
    this.config = config
  }

  /**
   * Execute command safely, applying configured UTF-8 and process-tree guards.
   */
  public exec(command: string, options: CommandExecOptions = {}): Promise<CommandExecResult> {
    const mergedOptions: CommandExecOptions = {
      forceUtf8: options.forceUtf8 ?? this.config.forceUtf8 ?? true,
      enableProcessTreeGuard: options.enableProcessTreeGuard ?? this.config.enableProcessTreeGuard ?? true,
      timeoutMs: options.timeoutMs ?? (this.config.defaultTimeoutMs || undefined),
      ...options,
    }
    return WindowsCommandRunner.execute(command, mergedOptions)
  }

  protected start(): void {
    const isWin = process.platform === 'win32'
    const treeGuard = this.config.enableProcessTreeGuard ?? true
    const utf8 = this.config.forceUtf8 ?? true

    this.ctx.logger.info(
      `[dsh-plugin-windows] Platform patch active (OS: ${process.platform}, ProcessTreeGuard: ${
        treeGuard ? 'ON' : 'OFF'
      }, UTF-8: ${utf8 ? 'ON' : 'OFF'})`
    )
  }
}

export { WindowsPathUtils, WindowsProcessManager, WindowsEncodingUtils, WindowsCommandRunner, CommandExecOptions, CommandExecResult }

export default function apply(ctx: Context, config: WindowsPlatformConfig = {}) {
  ctx.plugin(WindowsPlatformService, config)
}
