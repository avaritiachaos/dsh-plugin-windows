import * as path from 'node:path'

/**
 * Windows-safe cross-platform path utilities.
 */
export class WindowsPathUtils {
  /**
   * Normalize any path string to standard forward-slash format,
   * while correctly handling drive letters (e.g. "d:\" -> "D:/") and UNC paths.
   */
  public static normalize(inputPath: string): string {
    if (!inputPath || typeof inputPath !== 'string') return ''

    let p = inputPath.trim()

    // 1. Strip Windows Extended-Length prefix: \\?\
    if (p.startsWith('\\\\?\\')) {
      p = p.slice(4)
    }

    // 2. Unify all backslashes to forward slashes
    p = p.replace(/\\+/g, '/')

    // 3. Uppercase Windows drive letter: "d:/" -> "D:/"
    if (/^[a-zA-Z]:\//.test(p)) {
      p = p.charAt(0).toUpperCase() + p.slice(1)
    }

    // 4. Resolve relative dots while preserving leading slash/drive
    return path.posix.normalize(p)
  }

  /**
   * Prepare path for Glob pattern matching (escaping Windows drive colon if needed).
   */
  public static toGlobPattern(inputPath: string): string {
    return WindowsPathUtils.normalize(inputPath).replace(/\/+/g, '/')
  }

  /**
   * Check if a path is inside a given workspace root (case-insensitive on Windows).
   */
  public static isInsideWorkspace(targetPath: string, workspaceRoot: string): boolean {
    const normTarget = WindowsPathUtils.normalize(targetPath).toLowerCase()
    const normRoot = WindowsPathUtils.normalize(workspaceRoot).toLowerCase().replace(/\/+$/, '')

    return normTarget === normRoot || normTarget.startsWith(normRoot + '/')
  }
}
