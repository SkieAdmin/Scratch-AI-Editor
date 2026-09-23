// Preload runs in a sandboxed context, where Electron requires CommonJS.
const { contextBridge } = require('electron')

/**
 * The main process passes the bridge URL, token included, as a query parameter
 * on the page it loads. Reading it here and handing it to the page through the
 * context bridge keeps the page itself free of Node access.
 */
const bridgeUrl = new URLSearchParams(window.location.search).get('aiBridge')

contextBridge.exposeInMainWorld('scratchAiDesktop', {
  bridgeUrl: bridgeUrl,
  isDesktop: true,
})
