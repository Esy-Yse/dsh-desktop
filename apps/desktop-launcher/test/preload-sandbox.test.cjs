const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const { resolve } = require('node:path')

test('preload starts when the sandbox only permits Electron built-ins', () => {
  const source = readFileSync(resolve(__dirname, '../source/preload.js'), 'utf8')
  const sandbox = {
    require(id) {
      if (id === 'electron') return { ipcRenderer: {} }
      throw new Error('sandbox preload cannot load: ' + id)
    },
    window: { addEventListener() {} },
  }

  assert.doesNotThrow(() => vm.runInNewContext(source, sandbox))
})
