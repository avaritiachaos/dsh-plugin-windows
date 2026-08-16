/**
 * Windows-safe cross-platform path utilities with true UNC & drive preservation.
 */
export class WindowsPathUtils {
  /**
   * Normalize path string, preserving Windows drive letters, UNC paths (`\\server\share`),
   * and stripping extended-length `\\?\` prefixes without corrupting UNC authorities.
   */
  public static normalize(inputPath: string): string {
    if (!inputPath || typeof inputPath !== 'string') return ''

    let p = inputPath.trim()
    if (!p) return ''

    let isUnc = false
    let uncAuthority = ''

    // 1. Extended UNC handling: \\?\UNC\server\share\file -> //server/share/file
    if (p.startsWith('\\\\?\\UNC\\') || p.startsWith('//?/UNC/')) {
      isUnc = true
      p = p.slice(8).replace(/\\+/g, '/')
      const parts = p.split('/')
      const server = parts[0] || ''
      const share = parts[1] || ''
      uncAuthority = `//${server}/${share}`
      p = parts.slice(2).join('/')
    } else if (p.startsWith('\\\\?\\') || p.startsWith('//?/')) {
      // Extended drive path: \\?\D:\foo -> D:\foo
      p = p.slice(4)
    } else if (p.startsWith('\\\\') || p.startsWith('//')) {
      // Standard UNC: \\server\share\file -> //server/share/file
      isUnc = true
      p = p.slice(2).replace(/\\+/g, '/')
      const parts = p.split('/')
      const server = parts[0] || ''
      const share = parts[1] || ''
      uncAuthority = `//${server}/${share}`
      p = parts.slice(2).join('/')
    }

    // 2. Unify slashes to forward slash
    p = p.replace(/\\+/g, '/')

    // 3. Drive letter normalization (e.g. "d:/" -> "D:/")
    const driveMatch = p.match(/^([a-zA-Z]):(\/|$)/)
    let drivePrefix = ''
    if (driveMatch) {
      drivePrefix = `${driveMatch[1].toUpperCase()}:`
      p = p.slice(2)
      if (!p.startsWith('/')) p = `/${p}`
    }

    // 4. Resolve relative dots
    const parts = p.split('/')
    const stack: string[] = []
    for (const part of parts) {
      if (part === '' || part === '.') continue
      if (part === '..') {
        if (stack.length > 0 && stack[stack.length - 1] !== '..') {
          stack.pop()
        } else if (!drivePrefix && !isUnc) {
          stack.push('..')
        }
      } else {
        stack.push(part)
      }
    }

    const resolved = stack.join('/')

    if (isUnc) {
      return resolved ? `${uncAuthority}/${resolved}` : uncAuthority
    }
    if (drivePrefix) {
      return `${drivePrefix}/${resolved}`
    }

    const leadingSlash = inputPath.trim().startsWith('/') || inputPath.trim().startsWith('\\')
    return leadingSlash ? `/${resolved}` : (resolved || '.')
  }

  /**
   * Safe workspace boundary checker.
   * Rejects empty roots and enforces case-insensitivity on Windows only.
   */
  public static isInsideWorkspace(targetPath: string, workspaceRoot: string): boolean {
    if (!targetPath || !workspaceRoot || !workspaceRoot.trim()) return false

    const isWin = process.platform === 'win32'
    const normTarget = WindowsPathUtils.normalize(targetPath)
    const normRoot = WindowsPathUtils.normalize(workspaceRoot).replace(/\/+$/, '')

    if (!normRoot || normRoot === '.') return false

    const cmpTarget = isWin ? normTarget.toLowerCase() : normTarget
    const cmpRoot = isWin ? normRoot.toLowerCase() : normRoot

    return cmpTarget === cmpRoot || cmpTarget.startsWith(`${cmpRoot}/`)
  }

  public static toGlobPattern(inputPath: string): string {
    return WindowsPathUtils.normalize(inputPath)
  }
}
