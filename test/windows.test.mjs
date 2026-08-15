import test from 'node:test'
import assert from 'node:assert/strict'

// Pure logic test suite for Windows utilities
class WindowsPathUtils {
  static normalize(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') return ''
    let p = inputPath.trim()
    if (p.startsWith('\\\\?\\')) p = p.slice(4)
    p = p.replace(/\\+/g, '/')
    if (/^[a-zA-Z]:\//.test(p)) {
      p = p.charAt(0).toUpperCase() + p.slice(1)
    }
    // Simple posix normalization simulation
    const parts = p.split('/')
    const stack = []
    for (const part of parts) {
      if (part === '.' || part === '') {
        if (stack.length === 0) stack.push('')
        continue
      }
      if (part === '..') {
        if (stack.length > 1) stack.pop()
      } else {
        stack.push(part)
      }
    }
    return stack.join('/') || '/'
  }

  static isInsideWorkspace(targetPath, workspaceRoot) {
    const normTarget = WindowsPathUtils.normalize(targetPath).toLowerCase()
    const normRoot = WindowsPathUtils.normalize(workspaceRoot).toLowerCase().replace(/\/+$/, '')
    return normTarget === normRoot || normTarget.startsWith(normRoot + '/')
  }
}

class WindowsEncodingUtils {
  static decodeBuffer(buffer) {
    if (!buffer || buffer.length === 0) return ''
    const decoder = new TextDecoder('utf-8', { fatal: false })
    let text = decoder.decode(buffer)
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    return text.replace(/\r\n/g, '\n')
  }
}

test('WindowsPathUtils normalizes drive letters, backslashes, and UNC prefixes', () => {
  assert.equal(WindowsPathUtils.normalize('d:\\projects\\repo\\src\\index.ts'), 'D:/projects/repo/src/index.ts')
  assert.equal(WindowsPathUtils.normalize('c:\\Users\\rain\\..\\rain\\app'), 'C:/Users/rain/app')
  assert.equal(WindowsPathUtils.normalize('\\\\?\\D:\\extended\\path\\file.txt'), 'D:/extended/path/file.txt')
  assert.equal(WindowsPathUtils.normalize('e:/mixed\\slashes/test'), 'E:/mixed/slashes/test')
})

test('WindowsPathUtils.isInsideWorkspace handles Windows case-insensitivity', () => {
  const root = 'D:/AI_alice/project'
  assert.ok(WindowsPathUtils.isInsideWorkspace('d:\\ai_alice\\project\\src\\file.py', root))
  assert.ok(WindowsPathUtils.isInsideWorkspace('D:/AI_alice/project', root))
  assert.ok(!WindowsPathUtils.isInsideWorkspace('C:/Windows/System32/cmd.exe', root))
  assert.ok(!WindowsPathUtils.isInsideWorkspace('D:/AI_alice/another_project', root))
})

test('WindowsEncodingUtils strips BOM and normalizes CRLF', () => {
  // UTF-8 with BOM: \uFEFF + "hello\r\nworld\r\n"
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x0d, 0x0a, 0x77, 0x6f, 0x72, 0x6c, 0x64])
  const result = WindowsEncodingUtils.decodeBuffer(bytes)
  assert.equal(result, 'hello\nworld')
  assert.ok(!result.includes('\r'))
  assert.ok(!result.includes('\uFEFF'))
})
