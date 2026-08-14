const test = require('node:test')
const assert = require('node:assert/strict')
const { createHarnessPageLoader } = require('../source/harness-page-loader.cjs')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

test('clears only the HTTP cache before loading with no-cache headers', async () => {
  const calls = []
  const window = {
    webContents: {
      session: {
        clearCache: async () => { calls.push('clear-cache') },
      },
    },
    loadURL: async (url, options) => { calls.push({ url, options }) },
  }
  const loader = createHarnessPageLoader({
    getWindow: () => window,
    getUrl: () => 'http://127.0.0.1:3080/',
    isQuitting: () => false,
    log: () => {},
  })

  assert.equal(await loader.load('startup'), true)
  assert.deepEqual(calls, [
    'clear-cache',
    {
      url: 'http://127.0.0.1:3080/',
      options: { extraHeaders: 'Cache-Control: no-cache\r\nPragma: no-cache\r\n' },
    },
  ])
})

test('coalesces simultaneous page reload requests', async () => {
  const cacheCleared = deferred()
  let clearCalls = 0
  let loadCalls = 0
  const window = {
    webContents: {
      session: {
        clearCache: () => {
          clearCalls += 1
          return cacheCleared.promise
        },
      },
    },
    loadURL: async () => { loadCalls += 1 },
  }
  const loader = createHarnessPageLoader({
    getWindow: () => window,
    getUrl: () => 'http://127.0.0.1:3080/',
    isQuitting: () => false,
    log: () => {},
  })

  const first = loader.load('startup')
  const second = loader.load('F5')
  assert.strictEqual(first, second)
  cacheCleared.resolve()
  await first
  assert.equal(clearCalls, 1)
  assert.equal(loadCalls, 1)
})

test('coalesces repeated failure retries and logs a failed retry', async () => {
  const scheduled = []
  const logs = []
  const window = {
    webContents: { session: { clearCache: async () => {} } },
    loadURL: async () => { throw new Error('offline') },
  }
  const loader = createHarnessPageLoader({
    getWindow: () => window,
    getUrl: () => 'http://127.0.0.1:3080/',
    isQuitting: () => false,
    log: line => logs.push(line),
    schedule: callback => scheduled.push(callback),
  })

  assert.equal(loader.scheduleRetry('failed load'), true)
  assert.equal(loader.scheduleRetry('failed load'), false)
  assert.equal(scheduled.length, 1)
  scheduled[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.match(logs[0], /page reload failed after failed load: offline/)
})
