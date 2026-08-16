import test from 'node:test'
import assert from 'node:assert'
import { Context } from 'cordis'
import {
  WindowsPathUtils,
  WindowsEncodingUtils,
  WindowsCommandRunner,
  WindowsPlatformConfig,
  WindowsPlatformService,
} from '../dist/index.js'

// PowerShell (the runner's shell on win32) requires `&` to invoke a quoted path.
// Children sleep 5s: long enough for every timeout/abort below, short enough
// that a racy taskkill cannot hold the suite for a minute.
const NODE = `& "${process.execPath}"`
const SLEEP5 = `${NODE} -e "setTimeout(()=>{},5000)"`

// 鈹€鈹€ path normalization (audit C5 matrix) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

test('WindowsPathUtils normalizes drive letters, backslashes, and preserves drive roots on parent traversal', () => {
  assert.strictEqual(WindowsPathUtils.normalize('c:\\users\\test\\project'), 'C:/users/test/project')
  assert.strictEqual(WindowsPathUtils.normalize('d:\\foo\\..\\bar'), 'D:/bar')
  assert.strictEqual(WindowsPathUtils.normalize('D:/workspace/../../outside'), 'D:/outside')
  assert.strictEqual(WindowsPathUtils.normalize('D:'), 'D:/')
})

test('WindowsPathUtils clamps .. at the root for POSIX-style rooted paths', () => {
  assert.strictEqual(WindowsPathUtils.normalize('/foo/../../bar'), '/bar')
  assert.strictEqual(WindowsPathUtils.normalize('/foo/bar/..'), '/foo')
  assert.strictEqual(WindowsPathUtils.normalize('../foo'), '../foo')
})

test('WindowsPathUtils correctly preserves UNC and extended \\\\?\\UNC paths', () => {
  assert.strictEqual(WindowsPathUtils.normalize('\\\\server\\share\\repo\\file.ts'), '//server/share/repo/file.ts')
  assert.strictEqual(WindowsPathUtils.normalize('\\\\?\\UNC\\server\\share\\repo'), '//server/share/repo')
  assert.strictEqual(WindowsPathUtils.normalize('\\\\?\\D:\\project\\file.ts'), 'D:/project/file.ts')
  // UNC authority must survive .. traversal
  assert.strictEqual(WindowsPathUtils.normalize('//server/share/../x'), '//server/share/x')
  assert.strictEqual(WindowsPathUtils.normalize('//server/share/../../outside'), '//server/share/outside')
})

test('WindowsPathUtils refuses ambiguous or unsafe paths', () => {
  assert.strictEqual(WindowsPathUtils.normalize('C:foo\\..\\bar'), '') // drive-relative
  // single-backslash rooted path: .. clamps at root instead of escaping (C5)
  assert.strictEqual(WindowsPathUtils.normalize('\\foo\\..\\..\\bar'), '/bar')
  assert.strictEqual(WindowsPathUtils.normalize('\\\\foo\\..\\..\\bar'), '') // malformed UNC (share=..)
  assert.strictEqual(WindowsPathUtils.normalize('\\\\.\\pipe\\name'), '') // device namespace
  assert.strictEqual(WindowsPathUtils.normalize('\\\\.\\GLOBALROOT\\x'), '') // device namespace
  assert.strictEqual(WindowsPathUtils.normalize('\\\\?\\Volume{abc}\\file'), '') // extended device namespace
  assert.strictEqual(WindowsPathUtils.normalize(''), '')
})

test('WindowsPathUtils.isInsideWorkspace handles boundaries and rejects empty roots', () => {
  assert.strictEqual(WindowsPathUtils.isInsideWorkspace('D:/Project/src/index.ts', 'D:/Project'), true)
  assert.strictEqual(WindowsPathUtils.isInsideWorkspace('D:/Project', 'D:/Project'), true)
  assert.strictEqual(WindowsPathUtils.isInsideWorkspace('D:/Project2/secret.txt', 'D:/Project'), false)
  assert.strictEqual(WindowsPathUtils.isInsideWorkspace('D:/Other/secret.txt', 'D:/Project'), false)
  assert.strictEqual(WindowsPathUtils.isInsideWorkspace('D:/Project/src/index.ts', ''), false)
  assert.strictEqual(WindowsPathUtils.isInsideWorkspace('', 'D:/Project'), false)
})

// 鈹€鈹€ encoding 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

test('WindowsEncodingUtils strips UTF-8 BOM and normalizes CRLF', () => {
  const withBom = '\uFEFFconst hello = "world";\r\nconsole.log(hello);\r\n'
  const cleaned = WindowsEncodingUtils.stripBom(withBom)
  assert.strictEqual(cleaned.startsWith('\uFEFF'), false)
  assert.strictEqual(WindowsEncodingUtils.normalizeLineEndings(cleaned), 'const hello = "world";\nconsole.log(hello);\n')
})

test('WindowsEncodingUtils decodes GBK bytes when asked (configurable decoder, M4)', () => {
  const gbkHello = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]) // 你好 in GBK
  assert.strictEqual(WindowsEncodingUtils.decodeBuffer(gbkHello, 'gbk'), '你好')
  // the same bytes are invalid UTF-8: c4 e3 ba c3 -> 3 replacement chars
  assert.strictEqual(WindowsEncodingUtils.decodeBuffer(gbkHello, 'utf-8'), '\ufffd\ufffd\ufffd')
})

// 鈹€鈹€ runner termination state machine (C2/C3/M1/M2/M5/M10/M11a) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

test('runner resolves immediately for a pre-aborted signal without spawning', async () => {
  const ac = new AbortController()
  ac.abort()
  const start = Date.now()
  const result = await WindowsCommandRunner.execute('echo never-runs', { signal: ac.signal })
  const elapsed = Date.now() - start
  assert.strictEqual(result.aborted, true)
  assert.strictEqual(result.timedOut, false)
  assert.strictEqual(result.terminationReason, 'pre-abort')
  assert.strictEqual(result.exitCode, 130)
  assert.ok(elapsed < 2000, `pre-abort took ${elapsed}ms (should resolve immediately)`)
})

test('runner times out with 124 and never reports both timedOut and aborted (M2)', async () => {
  const result = await WindowsCommandRunner.execute(SLEEP5, { timeoutMs: 800 })
  assert.strictEqual(result.timedOut, true)
  assert.strictEqual(result.aborted, false)
  assert.strictEqual(result.killedByTimeout, true)
  assert.strictEqual(result.exitCode, 124)
  assert.ok(['timeout', 'cleanup-timeout'].includes(result.terminationReason), result.terminationReason)
})

test('runner abort wins over a later timeout (first cause wins, M2)', async () => {
  const ac = new AbortController()
  const promise = WindowsCommandRunner.execute(SLEEP5, { timeoutMs: 5000, signal: ac.signal })
  setTimeout(() => ac.abort(), 300)
  const result = await promise
  assert.strictEqual(result.aborted, true)
  assert.strictEqual(result.timedOut, false)
  assert.strictEqual(result.exitCode, 130)
})

test('runner timeout wins over a later abort (first cause wins, M2)', async () => {
  const ac = new AbortController()
  const promise = WindowsCommandRunner.execute(SLEEP5, { timeoutMs: 400, signal: ac.signal })
  setTimeout(() => ac.abort(), 2000)
  const result = await promise
  assert.strictEqual(result.timedOut, true)
  assert.strictEqual(result.aborted, false)
  assert.strictEqual(result.exitCode, 124)
})

test('runner respects enableProcessTreeGuard:false without hanging (M1)', async () => {
  const result = await WindowsCommandRunner.execute(SLEEP5, {
    timeoutMs: 800,
    enableProcessTreeGuard: false,
  })
  assert.strictEqual(result.timedOut, true)
  assert.strictEqual(result.exitCode, 124)
})

test('runner enforces a strict shared byte cap with truncation metadata (M5)', async () => {
  const result = await WindowsCommandRunner.execute(
    `${NODE} -e "process.stdout.write(String.fromCharCode(65).repeat(5000))"`,
    { maxOutputBytes: 100 },
  )
  assert.ok(result.stdout.length <= 100, `got ${result.stdout.length} bytes`)
  assert.strictEqual(result.truncated, true)
  assert.ok(result.droppedBytes >= 4900, `droppedBytes=${result.droppedBytes}`)
})

test('runner reports spawn failures instead of crashing (invalid cwd)', async () => {
  const result = await WindowsCommandRunner.execute('echo hi', { cwd: 'Z:\\definitely\\missing\\dir\\xyz' })
  assert.strictEqual(result.terminationReason, 'spawn-error')
  assert.strictEqual(result.exitCode, 1)
})

test('runner maps signal exits to 128+N on POSIX (M10)', async (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX-only: Windows has no real signal semantics')
    return
  }
  const result = await WindowsCommandRunner.execute(`${NODE} -e "process.kill(process.pid, 'SIGTERM')"`)
  assert.strictEqual(result.exitCode, 143)
  assert.strictEqual(result.signal, 'SIGTERM')
})

// 鈹€鈹€ config schema + propagation (M7/M8/M9) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

test('WindowsPlatformConfig applies defaults and rejects invalid values (M7)', () => {
  const defaults = WindowsPlatformConfig({})
  assert.strictEqual(defaults.forceUtf8, true)
  assert.strictEqual(defaults.enableProcessTreeGuard, true)
  assert.strictEqual(defaults.defaultTimeoutMs, 0)
  assert.strictEqual(defaults.outputEncoding, 'utf-8')

  assert.throws(() => WindowsPlatformConfig({ forceUtf8: 'yes' }), /expected/i)
  assert.throws(() => WindowsPlatformConfig({ defaultTimeoutMs: -5 }), /expected/i)
})

test('service.exec applies defaultTimeoutMs; explicit undefined does not override (M8/M9)', async () => {
  const ctx = new Context()
  const svc = new WindowsPlatformService(ctx, { defaultTimeoutMs: 600 })

  const a = await svc.exec(SLEEP5)
  assert.strictEqual(a.timedOut, true, 'config defaultTimeoutMs must apply')
  assert.strictEqual(a.exitCode, 124)

  const b = await svc.exec(SLEEP5, { timeoutMs: undefined })
  assert.strictEqual(b.timedOut, true, 'explicit undefined must not disable config timeout')

  const c = await svc.exec(`${NODE} -e "console.log(1)"`, { timeoutMs: 100000 })
  assert.strictEqual(c.timedOut, false)
  assert.strictEqual(c.stdout.trim(), '1')
})

test('service.runner is config-aware, not the bare static class (M8)', async () => {
  const ctx = new Context()
  const svc = new WindowsPlatformService(ctx, { defaultTimeoutMs: 500 })
  const result = await svc.runner.execute(SLEEP5)
  assert.strictEqual(result.timedOut, true, 'service.runner must honor defaultTimeoutMs')
})
