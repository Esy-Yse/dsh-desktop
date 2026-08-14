/**
 * Reload the local Harness page after its server becomes ready.
 *
 * The Electron HTTP cache may otherwise keep old client-plugin bundles after
 * the Harness dependency tree has changed. This deliberately does not clear
 * cookies, local storage, or any Harness configuration.
 *
 * @param {{
 *   getWindow: () => { webContents: { session: { clearCache: () => Promise<void> }, }, loadURL: (url: string, options: { extraHeaders: string }) => Promise<void> } | null,
 *   getUrl: () => string,
 *   isQuitting: () => boolean,
 *   log: (line: string) => void,
 *   schedule?: (callback: () => void, delayMs: number) => unknown,
 * }} options
 * @returns {{ load: (reason: string) => Promise<boolean>, scheduleRetry: (reason: string) => boolean }}
 */
function createHarnessPageLoader(options) {
  const schedule = options.schedule ?? setTimeout
  let activeLoad = null
  let retryScheduled = false

  function load(reason) {
    if (activeLoad !== null) return activeLoad

    const task = (async () => {
      const win = options.getWindow()
      if (win === null || options.isQuitting()) return false

      const url = options.getUrl()
      try {
        await win.webContents.session.clearCache()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        options.log(`[desktop] failed to clear page cache before ${reason}: ${message}`)
      }

      if (options.getWindow() !== win || options.isQuitting()) return false

      await win.loadURL(url, {
        extraHeaders: 'Cache-Control: no-cache\r\nPragma: no-cache\r\n',
      })
      return true
    })()
    activeLoad = task
    void task.then(
      () => { if (activeLoad === task) activeLoad = null },
      () => { if (activeLoad === task) activeLoad = null },
    )
    return task
  }

  function scheduleRetry(reason) {
    if (retryScheduled || options.isQuitting()) return false
    retryScheduled = true
    schedule(() => {
      retryScheduled = false
      void load(reason).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        options.log(`[desktop] page reload failed after ${reason}: ${message}`)
      })
    }, 3000)
    return true
  }

  return { load, scheduleRetry }
}

module.exports = { createHarnessPageLoader }
