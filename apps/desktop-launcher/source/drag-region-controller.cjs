const INTERACTIVE_SELECTOR = 'button, a, [role="button"], input, select, textarea, [contenteditable]'
const DIALOG_SELECTOR = '[role="dialog"], [aria-modal="true"]'

function setNoDrag(element) {
  element.style.webkitAppRegion = 'no-drag'
  for (const interactive of element.querySelectorAll(INTERACTIVE_SELECTOR)) {
    interactive.style.webkitAppRegion = 'no-drag'
  }
}

function isSafeMainHeader(header) {
  const rect = header.getBoundingClientRect()
  return rect.top < 10
    && rect.height > 40
    && rect.height < 130
    && header.querySelector(DIALOG_SELECTOR) === null
}

function isSafeLogoRow(logoRow) {
  const rect = logoRow.getBoundingClientRect()
  return rect.top < 20
    && rect.left < 60
    && rect.height > 30
    && rect.height < 110
    && logoRow.querySelector(DIALOG_SELECTOR) === null
}

function applySafeDragRegions({ headers, logoRows, dialogs }) {
  for (const dialog of dialogs) setNoDrag(dialog)
  if (dialogs.length > 0) {
    for (const header of headers) header.style.webkitAppRegion = ''
    for (const logoRow of logoRows) logoRow.style.webkitAppRegion = ''
    return { header: null, logoRow: null }
  }

  for (const candidate of headers) {
    if (!isSafeMainHeader(candidate) && candidate.style.webkitAppRegion === 'drag') {
      candidate.style.webkitAppRegion = ''
    }
  }
  const header = headers.find(isSafeMainHeader)
  if (header) {
    header.style.webkitAppRegion = 'drag'
    for (const interactive of header.querySelectorAll(INTERACTIVE_SELECTOR)) {
      interactive.style.webkitAppRegion = 'no-drag'
    }
  }

  for (const candidate of logoRows) {
    if (!isSafeLogoRow(candidate) && candidate.style.webkitAppRegion === 'drag') {
      candidate.style.webkitAppRegion = ''
    }
  }
  const logoRow = logoRows.find(isSafeLogoRow)
  if (logoRow) {
    logoRow.style.webkitAppRegion = 'drag'
    for (const interactive of logoRow.querySelectorAll(INTERACTIVE_SELECTOR)) {
      interactive.style.webkitAppRegion = 'no-drag'
    }
  }

  return { header, logoRow }
}

function collectDragRegionNodes(document) {
  return {
    headers: [...document.querySelectorAll('header[class*="_header"]')],
    logoRows: [...document.querySelectorAll('div[class*="_logoRow"]')],
    dialogs: [...document.querySelectorAll(DIALOG_SELECTOR)],
  }
}

module.exports = { applySafeDragRegions, collectDragRegionNodes }
