const test = require('node:test')
const assert = require('node:assert/strict')

let runtime = {}
try {
  runtime = require('../source/launcher-runtime.cjs')
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error
}

test('keeps minimize-to-tray enabled unless the user explicitly disables it', () => {
  assert.equal(typeof runtime.createEffectiveConfig, 'function')

  const defaults = {
    harnessRoot: 'default-root',
    nodePath: 'node',
    port: 3080,
    autoStartServer: true,
    minimizeToTray: true,
    autoInstallSkin: true,
  }

  const enabled = runtime.createEffectiveConfig(defaults, {}, {})
  const disabled = runtime.createEffectiveConfig(defaults, { minimizeToTray: false }, {})

  assert.equal(enabled.minimizeToTray, true)
  assert.equal(disabled.minimizeToTray, false)
})

test('coalesces simultaneous service restarts into one stop, boot, and page reload', async () => {
  assert.equal(typeof runtime.createRestartCoordinator, 'function')

  const calls = []
  let releaseStop
  const coordinator = runtime.createRestartCoordinator({
    stopServer: () => new Promise(resolve => { releaseStop = resolve }),
    bootServer: async () => { calls.push('boot') },
    reloadPage: async reason => { calls.push('reload:' + reason) },
  })

  const first = coordinator.restart('server restart')
  const second = coordinator.restart('server restart')
  assert.equal(first, second)
  releaseStop()
  await first

  assert.deepEqual(calls, ['boot', 'reload:server restart'])
})

test('refreshes the tray menu with restart only for an owned service', () => {
  assert.equal(typeof runtime.createTrayTemplate, 'function')

  const events = []
  const callbacks = {
    show: () => events.push('show'),
    open: () => events.push('open'),
    restart: () => events.push('restart'),
    quit: () => events.push('quit'),
  }

  const external = runtime.createTrayTemplate('external', callbacks)
  const owned = runtime.createTrayTemplate('owned', callbacks)

  assert.equal(external.some(item => item.label === '重启内置服务'), false)
  const restartItem = owned.find(item => item.label === '重启内置服务')
  assert.ok(restartItem)
  restartItem.click()
  assert.deepEqual(events, ['restart'])
})
