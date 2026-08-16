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
  /** TextDecoder label used when forceUtf8 is false, e.g. 'gbk', 'cp1252'. */
  outputEncoding?: string
}

export const WindowsPlatformConfig: Schema<WindowsPlatformConfig> = Schema.object({
  forceUtf8: Schema.boolean().default(true).description('Force UTF-8 output encoding for PowerShell / CMD.'),
  enableProcessTreeGuard: Schema.boolean().default(true).description('Use taskkill /T /F for child process tree termination.'),
  defaultTimeoutMs: Schema.number().min(0).default(0).description('Default command timeout in milliseconds (0 for unlimited).'),
  outputEncoding: Schema.string().default('utf-8').description('Decoder label for subprocess output when forceUtf8 is disabled (e.g. gbk).'),
})

declare module 'cordis' {
  interface Context {
    windows: WindowsPlatformService
  }
}

/** Config-aware runner surface exposed on the service (never bypasses config). */
export interface WindowsRunner {
  execute(command: string, options?: CommandExecOptions): Promise<CommandExecResult>
}

/**
 * DeepSeek Harness Windows Platform Compatibility Service.
 */
export class WindowsPlatformService extends Service<WindowsPlatformConfig> {
  /** Cordis validates plugin config against this schema (defaults + ValidationError). */
  public static Config = WindowsPlatformConfig

  public path = WindowsPathUtils
  public process = WindowsProcessManager
  public encoding = WindowsEncodingUtils
  /**
   * Config-aware runner: unlike the raw `WindowsCommandRunner` class, this
   * applies defaultTimeoutMs / forceUtf8 / enableProcessTreeGuard / outputEncoding.
   */
  public runner: WindowsRunner = {
    execute: (command: string, options: CommandExecOptions = {}) => this.exec(command, options),
  }

  constructor(ctx: Context, config: WindowsPlatformConfig = {}) {
    super(ctx, 'windows', true)
    // Validate + apply defaults even when the plugin is constructed directly
    // (defensive; Cordis normally validates through `Config` first).
    this.config = WindowsPlatformConfig(config) as WindowsPlatformConfig
  }

  /**
   * Execute command safely, applying configured UTF-8 and process-tree guards.
   */
  public exec(command: string, options: CommandExecOptions = {}): Promise<CommandExecResult> {
    const merged: CommandExecOptions = {
      forceUtf8: this.config.forceUtf8,
      enableProcessTreeGuard: this.config.enableProcessTreeGuard,
      timeoutMs: this.config.defaultTimeoutMs || undefined,
      encoding: this.config.outputEncoding,
    }
    // Never let caller `undefined` own-properties override valid config (M9):
    // only copy keys that carry an actual value.
    for (const key of Object.keys(options) as (keyof CommandExecOptions)[]) {
      const value = options[key]
      if (value !== undefined) {
        ;(merged as Record<string, unknown>)[key] = value
      }
    }
    return WindowsCommandRunner.execute(command, merged)
  }

  protected start(): void {
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
  // Explicit validation at the entry point: invalid values throw ValidationError,
  // defaults land in service.config (M7).
  ctx.plugin(WindowsPlatformService, WindowsPlatformConfig(config))
}
