function normalizePort(value, fallback) {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback
}

function createEffectiveConfig(defaults, config, env) {
  const saved = { ...defaults, ...config }
  return {
    harnessRoot: env.DSH_HARNESS_ROOT || saved.harnessRoot,
    nodePath: env.DSH_NODE || saved.nodePath,
    port: normalizePort(env.DSH_PORT ?? saved.port, defaults.port),
    autoStartServer: env.DSH_AUTO_START_SERVER
      ? env.DSH_AUTO_START_SERVER === '1'
      : saved.autoStartServer !== false,
    minimizeToTray: saved.minimizeToTray !== false,
    autoInstallSkin: saved.autoInstallSkin !== false,
  }
}

function createRestartCoordinator({ stopServer, bootServer, reloadPage }) {
  let activeRestart = null

  function restart(reason) {
    if (activeRestart !== null) return activeRestart

    const task = (async () => {
      await stopServer()
      await bootServer()
      await reloadPage(reason)
      return true
    })()
    activeRestart = task
    void task.then(
      () => { if (activeRestart === task) activeRestart = null },
      () => { if (activeRestart === task) activeRestart = null },
    )
    return task
  }

  return { restart }
}

function createTrayTemplate(mode, callbacks) {
  return [
    { label: '显示主窗口', click: callbacks.show },
    { type: 'separator' },
    { label: '在浏览器中打开', click: callbacks.open },
    ...(mode === 'owned' ? [{ label: '重启内置服务', click: callbacks.restart }] : []),
    { type: 'separator' },
    { label: '退出', click: callbacks.quit },
  ]
}

module.exports = {
  createEffectiveConfig,
  createRestartCoordinator,
  createTrayTemplate,
}
