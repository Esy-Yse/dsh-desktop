const test = require('node:test')
const assert = require('node:assert/strict')

let dragRegions = {}
try {
  dragRegions = require('../source/drag-region-controller.cjs')
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error
}

function element({ top = 0, left = 0, height = 60, containsDialog = false, descendants = [] } = {}) {
  return {
    style: {},
    getBoundingClientRect: () => ({ top, left, height }),
    querySelector: selector => selector.includes('[role="dialog"]') && containsDialog ? {} : null,
    querySelectorAll: () => descendants,
  }
}

test('does not turn a header containing the settings dialog into a drag region', () => {
  assert.equal(typeof dragRegions.applySafeDragRegions, 'function')

  const closeButton = element()
  const dialog = element({ descendants: [closeButton] })
  const modalHeader = element({ top: 0, height: 64, containsDialog: true })

  dragRegions.applySafeDragRegions({
    headers: [modalHeader],
    logoRows: [],
    dialogs: [dialog],
  })

  assert.notEqual(modalHeader.style.webkitAppRegion, 'drag')
  assert.equal(dialog.style.webkitAppRegion, 'no-drag')
  assert.equal(closeButton.style.webkitAppRegion, 'no-drag')
})

test('keeps modal controls clickable by suspending the top-level drag region', () => {
  assert.equal(typeof dragRegions.applySafeDragRegions, 'function')

  const mainButton = element()
  const mainHeader = element({ top: 0, height: 64, descendants: [mainButton] })
  const closeButton = element()
  const dialog = element({ descendants: [closeButton] })

  dragRegions.applySafeDragRegions({
    headers: [mainHeader],
    logoRows: [],
    dialogs: [dialog],
  })

  assert.notEqual(mainHeader.style.webkitAppRegion, 'drag')
  assert.equal(dialog.style.webkitAppRegion, 'no-drag')
  assert.equal(closeButton.style.webkitAppRegion, 'no-drag')
})

test('clears a stale drag region when a settings dialog is mounted below it', () => {
  const modalHeader = element({ top: 0, height: 64, containsDialog: true })
  modalHeader.style.webkitAppRegion = 'drag'

  dragRegions.applySafeDragRegions({
    headers: [modalHeader],
    logoRows: [],
    dialogs: [],
  })

  assert.notEqual(modalHeader.style.webkitAppRegion, 'drag')
})

test('suspends all launcher drag regions while a settings dialog overlaps the session header', () => {
  const mainButton = element()
  const mainHeader = element({ top: 0, height: 64, descendants: [mainButton] })
  mainHeader.style.webkitAppRegion = 'drag'
  const logoRow = element({ top: 0, left: 0, height: 48 })
  logoRow.style.webkitAppRegion = 'drag'
  const closeButton = element()
  const dialog = element({ descendants: [closeButton] })

  dragRegions.applySafeDragRegions({
    headers: [mainHeader],
    logoRows: [logoRow],
    dialogs: [dialog],
  })

  assert.notEqual(mainHeader.style.webkitAppRegion, 'drag')
  assert.notEqual(logoRow.style.webkitAppRegion, 'drag')
  assert.equal(dialog.style.webkitAppRegion, 'no-drag')
  assert.equal(closeButton.style.webkitAppRegion, 'no-drag')
})
