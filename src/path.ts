/**
 * Windows-safe cross-platform path utilities with true UNC & drive preservation.
 *
 * This helper is used as a *security boundary* (workspace containment), so it
 * is intentionally conservative:
 * - `..` above a rooted/drive/UNC root is clamped at the root instead of
 *   escaping it;
 * - UNC server/share authorities are preserved and can never be popped by `..`;
 * - drive-relative paths (`C:foo`) are ambiguous and therefore refused;
 * - device namespaces (`\\.\pipe`, `\\.\GLOBALROOT`, volume GUIDs, ...) are
 *   refused because they cannot be safely mapped;
 * - `trim()` is skipped for extended-length (`\\?\`) paths so trailing-space
 *   names survive.
 */
export class WindowsPathUtils {
  /**
   * Normalize path string, preserving Windows drive letters, UNC paths
   * (`\\server\share`), and stripping extended-length `\\?\` prefixes without
   * corrupting UNC authorities. Returns `''` for paths that cannot be safely
   * normalized (device namespaces, malformed UNC, drive-relative paths).
   */
  public static normalize(inputPath: string): string {
    if (!inputPath || typeof inputPath !== 'string') return ''

    const isExtended = inputPath.startsWith('\\\\?\\') || inputPath.startsWith('//?/')
    let p = isExtended ? inputPath : inputPath.trim()
    if (!p) return ''

    // Device namespaces (named pipes, GLOBALROOT, volume GUIDs, ...) must not
    // be treated as ordinary paths.
    if (p.startsWith('\\\\.\\') || p.startsWith('//./')) return ''

    let isUnc = false
    let uncAuthority = ''

    // 1. Extended UNC: \\?\UNC\server\share\file -> //server/share/file
    if (p.startsWith('\\\\?\\UNC\\') || p.startsWith('//?/UNC/')) {
      isUnc = true
      const rest = p.slice(8).replace(/\\+/g, '/')
      const parts = rest.split('/')
      if (parts.length < 2 || !parts[0] || !parts[1] || parts[1] === '.' || parts[1] === '..') return '' // malformed UNC
      uncAuthority = `//${parts[0]}/${parts[1]}`
      p = parts.slice(2).join('/')
    } else if (p.startsWith('\\\\?\\') || p.startsWith('//?/')) {
      // Extended path: only drive letters are safe to map (\\?\D:\foo -> D:/foo).
      p = p.slice(4).replace(/\\+/g, '/')
      if (!/^[a-zA-Z]:\//.test(p)) return '' // extended device namespace (Volume{GUID}, GLOBALROOT...)
    } else if (p.startsWith('\\\\') || p.startsWith('//')) {
      // Standard UNC: \\server\share\file -> //server/share/file
      isUnc = true
      const rest = p.slice(2).replace(/\\+/g, '/')
      const parts = rest.split('/')
      if (parts.length < 2 || !parts[0] || !parts[1] || parts[1] === '.' || parts[1] === '..') return '' // malformed UNC
      uncAuthority = `//${parts[0]}/${parts[1]}`
      p = parts.slice(2).join('/')
    }

    // 2. Unify slashes to forward slash
    p = p.replace(/\\+/g, '/')

    // 3. Drive-relative paths (C:foo) resolve against an unknown drive cwd —
    //    refusing is the only safe option for a security boundary.
    if (/^[a-zA-Z]:[^/]/.test(p)) return ''

    // 4. Drive letter normalization (e.g. "d:/" -> "D:/")
    const driveMatch = p.match(/^([a-zA-Z]):(\/|$)/)
    let drivePrefix = ''
    if (driveMatch) {
      drivePrefix = `${driveMatch[1].toUpperCase()}:`
      p = p.slice(2)
      if (!p.startsWith('/')) p = `/${p}`
    }

    // 5. Resolve relative dots; `..` is clamped at the root for rooted,
    //    drive and UNC paths (never escapes the root).
    const rooted = p.startsWith('/')
    const parts = p.split('/')
    const stack: string[] = []
    for (const part of parts) {
      if (part === '' || part === '.') continue
      if (part === '..') {
        if (stack.length > 0) {
          stack.pop()
        } else if (!rooted && !drivePrefix && !isUnc) {
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

    const leadingSlash = p.startsWith('/')
    return leadingSlash ? `/${resolved}` : resolved || '.'
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
