import test from 'node:test'
import assert from 'node:assert'
import { WindowsPathUtils } from '../src/path.ts'
import { WindowsEncodingUtils } from '../src/encoding.ts'

test('WindowsPathUtils normalizes drive letters, backslashes, and preserves drive roots on parent traversal', () => {
  // Backslashes & lowercase drive letter
  assert.strictEqual(WindowsPathUtils.normalize('c:\\users\\test\\project'), 'C:/users/test/project')
  assert.strictEqual(WindowsPathUtils.normalize('d:\\foo\\..\\bar'), 'D:/bar')

  // Drive root boundary: .. above drive root must NOT strip the drive prefix
  assert.strictEqual(WindowsPathUtils.normalize('D:/workspace/../../outside'), 'D:/outside')
})

test('WindowsPathUtils correctly preserves UNC and extended \\\\?\\UNC paths', () => {
  // Standard UNC
  assert.strictEqual(WindowsPathUtils.normalize('\\\\server\\share\\repo\\file.ts'), '//server/share/repo/file.ts')

  // Extended UNC
  assert.strictEqual(WindowsPathUtils.normalize('\\\\?\\UNC\\server\\share\\repo'), '//server/share/repo')

  // Extended Drive
  assert.strictEqual(WindowsPathUtils.normalize('\\\\?\\D:\\project\\file.ts'), 'D:/project/file.ts')
})

test('WindowsPathUtils.isInsideWorkspace handles boundaries and rejects empty roots', () => {
  // Normal inside
  assert.strictEqual(WindowsPathUtils.isInsideWorkspace('D:/Project/src/index.ts', 'D:/Project'), true)

  // Empty root must return false (prevents root bypass)
  assert.strictEqual(WindowsPathUtils.isInsideWorkspace('D:/Project/src/index.ts', ''), false)

  // Outside
  assert.strictEqual(WindowsPathUtils.isInsideWorkspace('D:/Other/secret.txt', 'D:/Project'), false)
})

test('WindowsEncodingUtils strips UTF-8 BOM and normalizes CRLF', () => {
  const withBom = '\uFEFFconst hello = "world";\r\nconsole.log(hello);\r\n'
  const cleaned = WindowsEncodingUtils.stripBom(withBom)
  assert.strictEqual(cleaned.startsWith('\uFEFF'), false)
  assert.strictEqual(WindowsEncodingUtils.normalizeLineEndings(cleaned), 'const hello = "world";\nconsole.log(hello);\n')
})
