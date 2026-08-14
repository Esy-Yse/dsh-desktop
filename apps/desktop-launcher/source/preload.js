// preload.js — 安全边界: 渲染进程是 harness 的网页内容, 不暴露任何 Node 能力。
// 这里只做纯 DOM 增强:
//  1) 窗口拖拽: GUI 自身顶部区域(左侧 logo 行 + 主区 header)可拖拽,
//     区域内的按钮等交互元素保持可点击(no-drag) — 不遮挡任何按钮。
//  2) 右上角自绘窗口控制按钮: 最小化 / 最大化(还原) / 关闭 — 透明背景,
//     白色符号, 悬停高亮(关闭键悬停变红), 通过 ipcRenderer 控制窗口。
const { ipcRenderer } = require('electron')

window.addEventListener('DOMContentLoaded', () => {
  const interactiveSelector = 'button, a, [role="button"], input, select, textarea, [contenteditable]'
  const dialogSelector = '[role="dialog"], [aria-modal="true"]'

  function setNoDrag(element) {
    element.style.webkitAppRegion = 'no-drag'
    element.querySelectorAll(interactiveSelector).forEach(child => {
      child.style.webkitAppRegion = 'no-drag'
    })
  }

  function isSafeMainHeader(header) {
    const rect = header.getBoundingClientRect()
    return rect.top < 10
      && rect.height > 40
      && rect.height < 130
      && header.querySelector(dialogSelector) === null
  }

  function isSafeLogoRow(logoRow) {
    const rect = logoRow.getBoundingClientRect()
    return rect.top < 20
      && rect.left < 60
      && rect.height > 30
      && rect.height < 110
      && logoRow.querySelector(dialogSelector) === null
  }

  const style = document.createElement('style')
  style.textContent = [
    // 自绘窗口按钮
    '#dsh-win-controls {',
    '  position: fixed; top: 0; right: 0; height: 44px;',
    '  display: flex; z-index: 2147483648;',
    '  -webkit-app-region: no-drag;',
    '}',
    '#dsh-win-controls button {',
    '  width: 46px; height: 44px; margin: 0; padding: 0;',
    '  border: none; background: transparent;',
    '  color: rgba(255, 255, 255, 0.9);',
    '  display: flex; align-items: center; justify-content: center;',
    '  cursor: default; outline: none;',
    '  -webkit-app-region: no-drag;',
    '}',
    '#dsh-win-controls button svg { display: block; }',
    '#dsh-win-controls button:hover { background: rgba(255, 255, 255, 0.12); }',
    '#dsh-win-controls button:active { background: rgba(255, 255, 255, 0.2); }',
    '#dsh-win-controls button#dsh-win-close:hover { background: rgba(232, 17, 35, 0.85); }',
    '#dsh-win-controls button#dsh-win-close:active { background: rgba(200, 12, 30, 0.9); }',
  ].join('\n')
  document.head.appendChild(style)

  // 窗口控制按钮
  const controls = document.createElement('div')
  controls.id = 'dsh-win-controls'
  controls.innerHTML = [
    '<button id="dsh-win-min" title="最小化" aria-label="最小化">',
    '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5.5h10" stroke="currentColor" stroke-width="1.2"/></svg>',
    '</button>',
    '<button id="dsh-win-max" title="最大化" aria-label="最大化">',
    '<svg id="dsh-max-icon" width="10" height="10" viewBox="0 0 10 10"><rect x="0.6" y="0.6" width="8.8" height="8.8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
    '<svg id="dsh-restore-icon" width="10" height="10" viewBox="0 0 10 10" style="display:none"><rect x="0.6" y="2.6" width="6.8" height="6.8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2.6 2.6v-2h6.8v6.8h-2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
    '</button>',
    '<button id="dsh-win-close" title="关闭" aria-label="关闭">',
    '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0.8 0.8l8.4 8.4M9.2 0.8L0.8 9.2" stroke="currentColor" stroke-width="1.2"/></svg>',
    '</button>',
  ].join('')
  document.body.appendChild(controls)

  document.getElementById('dsh-win-min').addEventListener('click', () => ipcRenderer.send('dsh-win:minimize'))
  document.getElementById('dsh-win-max').addEventListener('click', () => ipcRenderer.send('dsh-win:maximize'))
  document.getElementById('dsh-win-close').addEventListener('click', () => ipcRenderer.send('dsh-win:close'))

  // 主界面拖拽区只作用于顶部主框架；弹层及其控件始终是 no-drag，
  // 避免已有会话新增的 header 改变 DOM 顺序后抢走设置关闭按钮的点击。
  function wireDragRegions() {
    const headers = [...document.querySelectorAll('header[class*="_header"]')]
    const logoRows = [...document.querySelectorAll('div[class*="_logoRow"]')]
    const dialogs = [...document.querySelectorAll(dialogSelector)]
    dialogs.forEach(setNoDrag)
    // Dialog and session header are sibling layers. Electron drag hit testing
    // can still prefer the header rectangle, so suspend every launcher drag
    // region until the dialog is removed.
    if (dialogs.length > 0) {
      headers.forEach(candidate => { candidate.style.webkitAppRegion = '' })
      logoRows.forEach(candidate => { candidate.style.webkitAppRegion = '' })
      return
    }

    headers.forEach(candidate => {
      if (!isSafeMainHeader(candidate) && candidate.style.webkitAppRegion === 'drag') {
        candidate.style.webkitAppRegion = ''
      }
    })
    const header = headers.find(isSafeMainHeader)
    if (header) {
      header.style.webkitAppRegion = 'drag'
      header.querySelectorAll(interactiveSelector).forEach(child => {
        child.style.webkitAppRegion = 'no-drag'
      })
    }

    logoRows.forEach(candidate => {
      if (!isSafeLogoRow(candidate) && candidate.style.webkitAppRegion === 'drag') {
        candidate.style.webkitAppRegion = ''
      }
    })
    const logoRow = logoRows.find(isSafeLogoRow)
    if (logoRow) {
      logoRow.style.webkitAppRegion = 'drag'
      logoRow.querySelectorAll(interactiveSelector).forEach(child => {
        child.style.webkitAppRegion = 'no-drag'
      })
    }
  }
  wireDragRegions()
  let dragRegionUpdatePending = false
  const scheduleDragRegionUpdate = () => {
    if (dragRegionUpdatePending) return
    dragRegionUpdatePending = true
    window.requestAnimationFrame(() => {
      dragRegionUpdatePending = false
      wireDragRegions()
    })
  }
  new MutationObserver(scheduleDragRegionUpdate).observe(document.body, {
    childList: true,
    subtree: true,
  })
  window.addEventListener('resize', scheduleDragRegionUpdate)

  // Session log 按钮右移避开窗口控制按钮区 (fixed 按钮区宽 138px)
  // 用 transform 平移: 不改变布局流, resize/重渲染后自动重算
  function shiftSessionLog() {
    const btn = document.querySelector('[class$="_sessionLogButton"]')
    if (!btn) return
    const controlsWidth = 138
    const controlsLeft = window.innerWidth - controlsWidth
    // 关键: 先清除自身位移再读取原始位置, 否则读到的是平移后的位置,
    // 会在"平移/归位"之间来回跳
    btn.style.transform = ''
    const rect = btn.getBoundingClientRect()
    const shift = rect.right - controlsLeft + 10 // 留 10px 间隙
    if (shift > 0) btn.style.transform = 'translateX(-' + shift + 'px)'
  }
  shiftSessionLog()
  window.addEventListener('resize', shiftSessionLog)
  setInterval(shiftSessionLog, 3000)

  // 最大化状态切换图标 (最大化 ↔ 还原)
  ipcRenderer.on('dsh-win:maximized', (_event, isMaximized) => {
    const maxIcon = document.getElementById('dsh-max-icon')
    const restoreIcon = document.getElementById('dsh-restore-icon')
    if (maxIcon && restoreIcon) {
      maxIcon.style.display = isMaximized ? 'none' : ''
      restoreIcon.style.display = isMaximized ? '' : 'none'
      document.getElementById('dsh-win-max').title = isMaximized ? '还原' : '最大化'
      document.getElementById('dsh-win-max').setAttribute('aria-label', isMaximized ? '还原' : '最大化')
    }
  })
})
