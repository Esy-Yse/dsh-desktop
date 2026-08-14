// DeepSeek Harness 桌面客户端 (Electron 壳)
//
// 功能:
//  - 自动启动 dsh web 服务 (node --import tsx/esm apps/cli/src/bin.ts web --port <port>)
//  - 若 127.0.0.1:<port> 已有服务在运行, 则直接连接, 不接管进程
//  - 原生窗口 + 托盘 + 快捷键; 关闭窗口最小化到托盘; 退出时自动停止内置服务
//  - 配置保存在 %APPDATA%\DeepSeek Harness\config.json
//
// 环境变量覆盖(测试/高级用途):
//  DSH_HARNESS_ROOT / DSH_NODE / DSH_PORT / DSH_AUTO_START_SERVER / DSH_SMOKE_TEST
const { app, BrowserWindow, Tray, Menu, dialog, shell, nativeImage, ipcMain } = require('electron')
const { spawn, execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, renameSync, readdirSync, copyFileSync } = require('node:fs')
const { createConnection } = require('node:net')
const { join, dirname } = require('node:path')
const { homedir } = require('node:os')
const { createHarnessPageLoader } = require('./harness-page-loader.cjs')
const { createEffectiveConfig, createRestartCoordinator, createTrayTemplate } = require('./launcher-runtime.cjs')

const APP_NAME = 'DeepSeek Harness'

// 便携默认: 优先使用 exe 同目录的 harness/ 与 runtime/node.exe (交付包布局),
// 不存在时回退到本机开发路径 / PATH 上的 node
// 注意: 打包后代码在 asar 内, __dirname 是 asar 路径; process.resourcesPath
// 才是 exe 旁真实的 resources 目录, 交付根 = resources 的上级
const PORTABLE_ROOT = dirname(process.resourcesPath)
const PORTABLE_HARNESS = join(PORTABLE_ROOT, 'harness')
const PORTABLE_NODE = join(PORTABLE_ROOT, 'runtime', 'node.exe')
const PORTABLE_SKIN = join(PORTABLE_ROOT, 'skins', 'whale-song')
const DEFAULTS = Object.freeze({
  harnessRoot: existsSync(join(PORTABLE_HARNESS, 'apps', 'cli', 'src', 'bin.ts'))
    ? PORTABLE_HARNESS
    : 'D:\\DeepSeek-Harness',
  nodePath: existsSync(PORTABLE_NODE) ? PORTABLE_NODE : 'node',
  port: 3080,
  autoStartServer: true,
  minimizeToTray: true,
  autoInstallSkin: true,
})
const MAX_START_WAIT_MS = 360_000
const POLL_INTERVAL_MS = 1_000
const LOG_MAX_BYTES = 5 * 1024 * 1024

const state = {
  config: null,
  window: null,
  tray: null,
  child: null,        // 内置服务子进程
  owned: false,       // 服务进程是否由本应用托管
  quitting: false,
  serverLogPath: '',
  port: DEFAULTS.port,
  url: 'http://127.0.0.1:' + DEFAULTS.port + '/',
  mode: 'external',
  pageLoader: null,
  restartCoordinator: null,
  expectedExitChild: null,
}

// ---------------------------------------------------------------- 日志
function logServer(line) {
  try {
    if (!state.serverLogPath) state.serverLogPath = join(app.getPath('userData'), 'server.log')
    const entry = '[' + new Date().toISOString() + '] ' + line
    try {
      if (existsSync(state.serverLogPath) && statSync(state.serverLogPath).size > LOG_MAX_BYTES) {
        renameSync(state.serverLogPath, state.serverLogPath + '.old')
      }
    } catch { /* ignore */ }
    appendFileSync(state.serverLogPath, entry + '\n')
    console.log(entry)
  } catch { /* logging must never crash the app */ }
}

// ---------------------------------------------------------------- 配置
function configPath() {
  return join(app.getPath('userData'), 'config.json')
}

function loadConfig() {
  const p = configPath()
  let cfg = { ...DEFAULTS }
  try {
    if (existsSync(p)) cfg = { ...cfg, ...JSON.parse(readFileSync(p, 'utf8')) }
  } catch { /* fall back to defaults */ }
  // 环境变量只覆盖本次运行, 不写回配置文件;
  // 便携路径优先: 配置里没有显式指定且便携目录存在时, 自动指向便携目录
  const effective = createEffectiveConfig(DEFAULTS, cfg, process.env)
  if (cfg.harnessRoot === DEFAULTS.harnessRoot && existsSync(join(PORTABLE_HARNESS, 'apps', 'cli', 'src', 'bin.ts'))) {
    effective.harnessRoot = PORTABLE_HARNESS
  }
  if (cfg.nodePath === 'node' && existsSync(PORTABLE_NODE)) effective.nodePath = PORTABLE_NODE
  state.config = effective
  state.port = state.config.port
  state.url = 'http://127.0.0.1:' + state.config.port + '/'
  mkdirSync(dirname(p), { recursive: true })
  try { if (!existsSync(p)) writeFileSync(p, JSON.stringify(cfg, null, 2)) } catch { /* ignore */ }
  return state.config
}

function validateHarnessRoot(root) {
  return existsSync(join(root, 'apps', 'cli', 'src', 'bin.ts'))
}

async function ensureHarnessRoot() {
  let root = state.config.harnessRoot
  if (!validateHarnessRoot(root)) {
    const res = await dialog.showOpenDialog({
      title: '选择 DeepSeek Harness 代码目录',
      message: '未找到 DeepSeek Harness 代码 (apps/cli/src/bin.ts)，请选择代码根目录',
      properties: ['openDirectory'],
      defaultPath: 'D:\\',
    })
    if (res.canceled || !res.filePaths.length) { app.exit(1); return null }
    root = res.filePaths[0]
    if (!validateHarnessRoot(root)) {
      dialog.showErrorBox(APP_NAME, '所选目录不是 DeepSeek Harness 代码目录（缺少 apps/cli/src/bin.ts）')
      app.exit(1)
      return null
    }
    state.config.harnessRoot = root
    try { writeFileSync(configPath(), JSON.stringify(state.config, null, 2)) } catch { /* ignore */ }
  }
  return root
}

// ---------------------------------------------------------------- 皮肤自动安装 (便携交付)
const SKIN_PACKAGE = '@linxin666/dsh-client-ui-skin-whale-song'
const WEB_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

function dshHomeDir() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

async function ensureSkinInstalled() {
  if (!state.config.autoInstallSkin || !existsSync(PORTABLE_SKIN)) return
  try {
    const profileDir = join(dshHomeDir(), 'profiles', 'web')
    mkdirSync(profileDir, { recursive: true })

    // 1) manifest: 不存在则按 web 模板创建(含皮肤), 存在则把皮肤补进 bundles
    const manifestPath = join(profileDir, 'package.json')
    let manifest
    if (existsSync(manifestPath)) {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } else {
      manifest = { name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [...WEB_BUNDLES] } } }
    }
    const bundles = manifest.dsh?.profile?.bundles ?? []
    if (!bundles.includes(SKIN_PACKAGE)) {
      manifest.dsh = { ...(manifest.dsh ?? {}), profile: { ...(manifest.dsh?.profile ?? {}), bundles: [...bundles, SKIN_PACKAGE] } }
      manifest.dependencies = { ...(manifest.dependencies ?? {}), [SKIN_PACKAGE]: 'link:' + PORTABLE_SKIN }
      writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
      logServer('[desktop] skin registered in profile bundles')
    }

    // 2) 空用户补丁层 + pnpm 工作区设置 (initProfile 的其余产物)
    const patchPath = join(profileDir, 'cordis.patch.yml')
    if (!existsSync(patchPath)) writeFileSync(patchPath, '# user patch layer\n[]\n')
    const wsPath = join(profileDir, 'pnpm-workspace.yaml')
    if (!existsSync(wsPath)) writeFileSync(wsPath, 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')

    // 3) 拷贝皮肤包到 profile 的 node_modules (hoisted 平铺, 免 pnpm)
    const skinInstallDir = join(profileDir, 'node_modules', '@linxin666')
    const skinTarget = join(skinInstallDir, 'dsh-client-ui-skin-whale-song')
    if (!existsSync(join(skinTarget, 'package.json'))) {
      mkdirSync(skinTarget, { recursive: true })
      copyDirRecursive(PORTABLE_SKIN, skinTarget)
      logServer('[desktop] skin package copied to profile node_modules')
    }
  } catch (err) {
    logServer('[desktop] skin install failed (non-fatal): ' + err.message)
  }
}

function copyDirRecursive(src, dest) {
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name)
    const d = join(dest, entry.name)
    if (entry.isDirectory()) {
      mkdirSync(d, { recursive: true })
      copyDirRecursive(s, d)
    } else {
      copyFileSync(s, d)
    }
  }
}

// ---------------------------------------------------------------- 网络探测
function isHttpAlive(url) {
  return fetch(url, { method: 'GET', signal: AbortSignal.timeout(2000), headers: { Accept: 'text/html' } })
    .then(r => r.ok)
    .catch(() => false)
}

function isPortFree(port) {
  return new Promise(resolve => {
    const sock = createConnection({ host: '127.0.0.1', port })
    sock.once('connect', () => { sock.destroy(); resolve(false) })
    sock.once('error', () => resolve(true))
  })
}

// ---------------------------------------------------------------- 内置服务
function spawnServer(port) {
  const cfg = state.config
  const args = ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web', '--port', String(port)]
  logServer('[desktop] spawning: ' + cfg.nodePath + ' ' + args.join(' ') + '  (cwd: ' + cfg.harnessRoot + ')')
  const child = spawn(cfg.nodePath, args, {
    cwd: cfg.harnessRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  child.stdout.on('data', d => logServer(d.toString()))
  child.stderr.on('data', d => logServer(d.toString()))
  child.on('error', err => {
    logServer('[desktop] spawn error: ' + err.message)
    if (!state.quitting && state.owned) handleServerDown('无法启动内置服务: ' + err.message + '\n（请检查 config.json 中的 nodePath）')
  })
  child.on('exit', (code, signal) => {
    logServer('[desktop] server exited code=' + code + ' signal=' + signal)
    if (state.child === child) state.child = null
    if (state.expectedExitChild === child) return
    if (!state.quitting && state.owned) handleServerDown('内置服务已退出 (exit code ' + code + ')')
  })
  state.child = child
  state.owned = true
  return child
}

function terminateChildTree(child) {
  try {
    execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } catch { /* process already gone */ }
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise(resolve => {
    const onExit = () => {
      clearTimeout(timeout)
      resolve(true)
    }
    const timeout = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolve(false)
    }, timeoutMs)
    child.once('exit', onExit)
  })
}

async function waitForPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return true
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return false
}

async function stopOwnedServer() {
  const child = state.child
  if (!child) return

  state.expectedExitChild = child
  state.child = null
  state.owned = false
  try {
    try { child.kill() } catch { /* fall through to taskkill */ }
    if (!(await waitForChildExit(child, 3_000))) {
      terminateChildTree(child)
      await waitForChildExit(child, 3_000)
    }
    if (!(await waitForPortFree(state.port, 5_000))) {
      throw new Error('旧的内置服务未在限定时间内释放端口 ' + state.port)
    }
  } finally {
    if (state.expectedExitChild === child) state.expectedExitChild = null
  }
}

function killServer() {
  const child = state.child
  if (!child) return
  state.expectedExitChild = child
  state.child = null
  state.owned = false
  try { child.kill() } catch { /* ignore */ }
  terminateChildTree(child)
}

function handleServerDown(reason) {
  if (state.quitting || !state.owned) return
  state.owned = false
  refreshTrayMenu()
  const win = state.window
  const res = dialog.showMessageBoxSync(win || undefined, {
    type: 'error',
    title: APP_NAME,
    message: 'DeepSeek Harness 服务已停止',
    detail: reason + '\n\n服务日志: ' + state.serverLogPath,
    buttons: ['重启服务', '退出'],
    defaultId: 0,
    cancelId: 1,
  })
  if (res === 0) {
    restartServer().catch(e => { dialog.showErrorBox(APP_NAME, String(e.message)); app.exit(1) })
  } else {
    state.quitting = true
    app.quit()
  }
}

function restartServer() {
  if (state.restartCoordinator === null) return Promise.resolve(false)
  return state.restartCoordinator.restart('server restart')
}

// ---------------------------------------------------------------- 启动流程
async function waitForServer(port) {
  const deadline = Date.now() + MAX_START_WAIT_MS
  while (Date.now() < deadline) {
    if (state.child === null && state.owned) throw new Error('内置服务进程已退出，详情见日志: ' + state.serverLogPath)
    if (await isHttpAlive('http://127.0.0.1:' + port + '/')) return
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error('等待服务启动超时 (' + MAX_START_WAIT_MS / 1000 + 's)，详情见日志: ' + state.serverLogPath)
}

async function bootServer() {
  const cfg = state.config
  const baseUrl = 'http://127.0.0.1:' + cfg.port + '/'
  if (await isHttpAlive(baseUrl)) {
    state.mode = 'external'
    state.owned = false
    logServer('[desktop] 检测到已有服务在 ' + baseUrl + '，直接连接（不接管进程）')
    refreshTrayMenu()
    return
  }
  if (!cfg.autoStartServer) {
    throw new Error('未检测到运行中的服务 (' + baseUrl + ')，且 autoStartServer 已关闭')
  }
  let port = cfg.port
  if (!(await isPortFree(port))) {
    // 端口被非 harness 进程占用: 顺延找空闲端口
    let found = false
    for (let p = port + 1; p <= port + 20; p++) {
      if (await isPortFree(p)) { port = p; found = true; break }
    }
    if (!found) throw new Error('端口 ' + port + ' 被占用且未找到空闲端口')
  }
  state.port = port
  state.url = 'http://127.0.0.1:' + port + '/'
  state.mode = 'owned'
  spawnServer(port)
  await waitForServer(port)
  refreshTrayMenu()
}

// ---------------------------------------------------------------- 窗口
function showWindow() {
  if (!state.window) { createWindow(); return }
  if (state.window.isMinimized()) state.window.restore()
  state.window.show()
  state.window.focus()
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b1220',
    title: APP_NAME,
    icon: join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    // 无边框: 窗口按钮由 preload 自绘(透明背景), 顶部区域可拖拽
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.on('page-title-updated', e => e.preventDefault())
  win.once('ready-to-show', () => win.show())
  const syncMaximized = () => win.webContents.send('dsh-win:maximized', win.isMaximized())
  win.on('maximize', syncMaximized)
  win.on('unmaximize', syncMaximized)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(state.url)) {
      e.preventDefault()
      if (/^https?:/.test(url)) shell.openExternal(url)
    }
  })
  win.on('close', e => {
    if (!state.quitting && state.config.minimizeToTray) { e.preventDefault(); win.hide() }
  })
  win.on('closed', () => { state.window = null })
  win.webContents.on('did-finish-load', () => {
    if (process.env.DSH_SMOKE_TEST === '1') {
      console.log('[smoke] window loaded OK: ' + win.webContents.getURL())
      try {
        // 原生标题栏隐藏后, 页面里 outerHeight-innerHeight 应为 0 (默认框架下约 30+px)
        win.webContents.executeJavaScript(`(() => {
          const diff = window.outerHeight - window.innerHeight
          return 'titleBarHeight(outer-inner)=' + diff
        })()`).then(s => console.log('[smoke] ' + s)).catch(e => console.log('[smoke] frame js err: ' + e.message))
      } catch (e) { console.log('[smoke] frame err: ' + e.message) }
      try {
        win.webContents.executeJavaScript(`(() => {
          const header = document.querySelector('[class$="_header"]')
          const logoRow = document.querySelector('[class$="_logoRow"]')
          const allButtons = header ? [...header.querySelectorAll('button')] : []
          const taskBtn = allButtons.find(b => (b.textContent || '').includes('后台任务'))
          const h = header ? getComputedStyle(header).webkitAppRegion : 'not found'
          const l = logoRow ? getComputedStyle(logoRow).webkitAppRegion : 'not found'
          const t = taskBtn ? getComputedStyle(taskBtn).webkitAppRegion : 'not found'
          const bad = allButtons.filter(b => getComputedStyle(b).webkitAppRegion !== 'no-drag').length
          const ctl = document.getElementById('dsh-win-controls')
          const ctlBg = ctl ? getComputedStyle(ctl.querySelector('button')).backgroundColor : 'not found'
          return 'header=' + h + ' logoRow=' + l + ' taskBtn=' + t + ' headerButtons=' + allButtons.length + ' nonNoDrag=' + bad + ' controls=' + (ctl ? 'ok' : 'missing') + ' btnBg=' + ctlBg
        })()`).then(s => console.log('[smoke] ' + s)).catch(e => console.log('[smoke] js err: ' + e.message))
      } catch (e) { console.log('[smoke] exec err: ' + e.message) }
      state.quitting = true
      setTimeout(() => app.quit(), 3000)
    }
  })
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const ctrl = input.control || input.meta
    if (input.key === 'F12' || (ctrl && input.shift && input.key.toLowerCase() === 'i')) {
      win.webContents.toggleDevTools()
      event.preventDefault()
    } else if (input.key === 'F5') {
      void state.pageLoader?.load('F5').catch(error => {
        logServer('[desktop] F5 page reload failed: ' + error.message)
      })
      event.preventDefault()
    }
  })
  // 启动页: 服务就绪前先显示友好提示, 避免连接错误页
  const loadingHtml = '<!doctype html><html><head><meta charset="utf-8"><style>'
    + 'html,body{height:100%;margin:0;background:#0b1220;color:#c7d2e8;font-family:system-ui,"Microsoft YaHei",sans-serif;display:flex;align-items:center;justify-content:center}'
    + '.box{text-align:center}.spinner{width:36px;height:36px;margin:0 auto 18px;border:3px solid rgba(255,255,255,.15);border-top-color:#4d6bfe;border-radius:50%;animation:spin 1s linear infinite}'
    + '@keyframes spin{to{transform:rotate(360deg)}}h1{font-size:18px;margin:0 0 8px}p{font-size:13px;color:#8fa0c2;margin:0}'
    + '</style></head><body><div class="box"><div class="spinner"></div>'
    + '<h1>正在启动 DeepSeek Harness 服务…</h1>'
    + '<p>首次启动或重启电脑后约需 1~3 分钟，请稍候</p>'
    + '</div></body></html>'
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(loadingHtml)).catch(() => {})
  state.window = win
  state.pageLoader = createHarnessPageLoader({
    getWindow: () => state.window,
    getUrl: () => state.url,
    isQuitting: () => state.quitting,
    log: logServer,
  })
  state.restartCoordinator = createRestartCoordinator({
    stopServer: stopOwnedServer,
    bootServer,
    reloadPage: reason => state.pageLoader === null ? Promise.resolve(false) : state.pageLoader.load(reason),
  })
  // 服务未就绪导致加载失败时自动重试 (服务起来后自动恢复)。
  win.webContents.on('did-fail-load', (_event, errorCode, errorDesc, failedUrl, isMainFrame) => {
    if (!isMainFrame || state.quitting) return
    if (failedUrl.startsWith(state.url)) {
      state.pageLoader?.scheduleRetry('failed page load')
    }
  })
}

// ---------------------------------------------------------------- 托盘
function refreshTrayMenu() {
  if (!state.tray) return
  const template = createTrayTemplate(state.mode, {
    show: showWindow,
    open: () => shell.openExternal(state.url),
    restart: () => {
      void restartServer().catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        logServer('[desktop] restart failed: ' + message)
        dialog.showErrorBox(APP_NAME, '重启内置服务失败\n\n' + message)
      })
    },
    quit: () => { state.quitting = true; app.quit() },
  })
  state.tray.setContextMenu(Menu.buildFromTemplate(template))
}

function createTray() {
  const img = nativeImage.createFromPath(join(__dirname, 'build', 'icon.png'))
  const tray = new Tray(img.resize({ width: 16, height: 16 }))
  tray.setToolTip(APP_NAME)
  tray.on('click', showWindow)
  state.tray = tray
  refreshTrayMenu()
}

// ---------------------------------------------------------------- 生命周期
// ---------------------------------------------------------------- 窗口控制 (自绘按钮)
ipcMain.on('dsh-win:minimize', event => {
  BrowserWindow.fromWebContents(event.sender)?.minimize()
})
ipcMain.on('dsh-win:maximize', event => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.on('dsh-win:close', event => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})

app.setName(APP_NAME)
app.setAppUserModelId('com.deepseekai.harness-desktop')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    loadConfig()
    try {
      const root = await ensureHarnessRoot()
      if (!root) return
      await ensureSkinInstalled()
      createWindow()
      createTray()
      await bootServer()
      if (state.pageLoader !== null && !state.quitting) await state.pageLoader.load('startup')
    } catch (err) {
      dialog.showErrorBox(APP_NAME, String(err.message))
      app.exit(1)
    }
  })

  app.on('window-all-closed', () => { /* 驻留托盘 */ })
  app.on('before-quit', () => { state.quitting = true })
  app.on('quit', () => killServer())
}
