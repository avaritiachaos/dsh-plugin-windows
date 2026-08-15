import { Context, Service, Schema } from 'cordis'
import { WindowsPathUtils } from './path.js'
import { WindowsProcessManager } from './process.js'
import { WindowsEncodingUtils } from './encoding.js'

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
 * Provides Windows-safe process management, path normalization, and encoding guards.
 */
export class WindowsPlatformService extends Service {
  public path = WindowsPathUtils
  public process = WindowsProcessManager
  public encoding = WindowsEncodingUtils

  constructor(ctx: Context, private config: WindowsPlatformConfig = {}) {
    super(ctx, 'windows', true)
  }

  protected start(): void {
    const isWin = process.platform === 'win32'
    this.ctx.logger.info(
      `[dsh-plugin-windows] Platform patch loaded (OS: ${process.platform}, Windows optimizations: ${isWin ? 'ACTIVE' : 'IDLE'})`
    )
  }
}

export { WindowsPathUtils, WindowsProcessManager, WindowsEncodingUtils }

export default function apply(ctx: Context, config: WindowsPlatformConfig = {}) {
  ctx.plugin(WindowsPlatformService, config)
}
