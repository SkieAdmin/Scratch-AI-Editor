// Preload runs in a sandboxed context, where Electron requires CommonJS.
const { contextBridge, ipcRenderer } = require('electron')

/**
 * The main process passes the bridge URL, token included, as a query parameter
 * on the page it loads. Reading it here and handing it to the page through the
 * context bridge keeps the page itself free of Node access.
 */
const bridgeUrl = new URLSearchParams(window.location.search).get('aiBridge')

contextBridge.exposeInMainWorld('scratchAiDesktop', {
  bridgeUrl: bridgeUrl,
  isDesktop: true,

  // The editor's redux store is built synchronously, so the saved settings have
  // to be available before the first render rather than a tick later.
  readConfig: () => ipcRenderer.sendSync('scratch-ai:read-config'),
  writeConfig: (config) => ipcRenderer.invoke('scratch-ai:write-config', config),
})
