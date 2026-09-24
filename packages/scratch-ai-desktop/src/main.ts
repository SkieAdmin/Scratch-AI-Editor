import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startBridge, type RunningBridge } from '@skieadmin/scratch-ai-bridge'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { configPath, readConfig, writeConfig, type StoredConfig } from './config-store.ts'
import { createLogger, type LogLevel, type Logger } from './logger.ts'
import { startRendererServer, type RendererServer } from './renderer-server.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Everything stays on loopback; nothing this app runs should be reachable from the network. */
const LOOPBACK = '127.0.0.1'

/** How long a clean shutdown gets before the process exits regardless. */
const SHUTDOWN_GRACE_MS = 3000

const WINDOW_DEFAULTS = { width: 1280, height: 860, minWidth: 1024, minHeight: 700 }

/** The built editor, copied next to the compiled main process by `npm run stage`. */
const RENDERER_ROOT = join(HERE, '..', 'renderer')

let bridge: RunningBridge | null = null
let renderer: RendererServer | null = null
let settingsPath = ''
let logger: Logger | null = null

/**
 * Start the MCP bridge and the loopback server that hosts the editor.
 *
 * The bridge lives in this process rather than as a separate program the user
 * has to start, which is the point of the desktop build: the assistant works
 * the moment the app opens, and provider API keys never reach the page.
 * @returns the URL to load in the window
 */
async function startServices(): Promise<string> {
  logger = createLogger(app.getPath('documents'))
  logger.log('Information', `Skie AI Editor ${app.getVersion()} starting`)

  settingsPath = configPath(app.getPath('documents'))

  // The renderer asks for the saved settings synchronously while its store is
  // being built, so this cannot be a promise-returning channel.
  ipcMain.on('scratch-ai:read-config', (event) => {
    event.returnValue = readConfig(settingsPath)
  })
  ipcMain.handle('scratch-ai:write-config', (_event, config: StoredConfig) => {
    writeConfig(settingsPath, config)
  })
  ipcMain.on('scratch-ai:log', (_event, level: LogLevel, message: string) => {
    logger?.log(level, message)
  })

  renderer = await startRendererServer(RENDERER_ROOT, LOOPBACK)

  bridge = await startBridge({
    host: LOOPBACK,
    // Port 0 asks the OS for a free port, so a second copy of the app and a
    // separately-run bridge cannot collide.
    port: 0,
    // Only this app's own window may drive the editor.
    allowedOrigins: [renderer.origin],
    mcpHttp: true,
    version: app.getVersion(),
  })

  const target = new URL(renderer.origin)
  // The page reads these back through the preload bridge; they are not secrets
  // to the page itself, which is the only origin allowed to use them.
  target.searchParams.set('aiBridge', bridge.editorUrl)
  return target.toString()
}

/**
 * Build the application menu.
 *
 * Electron's default menu has no entry that shuts the bridge down, so the app
 * gets its own File menu whose Exit runs the same path as closing the window.
 */
function buildMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '&File',
        submenu: [{ label: 'E&xit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }],
      },
      {
        label: '&Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: '&View',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: '&Help',
        submenu: [
          {
            label: 'Open logs folder',
            click: () => {
              if (logger) void shell.openPath(logger.directory)
            },
          },
        ],
      },
    ]),
  )
}

/**
 * Create the app window.
 * @param url the editor URL to load
 */
function createWindow(url: string): void {
  const window = new BrowserWindow({
    ...WINDOW_DEFAULTS,
    backgroundColor: '#e5f0ff',
    show: false,
    title: 'Scratch 3 AI-Editor',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(HERE, 'preload.cjs'),
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => window.show())

  // Anything that wants its own window is an outbound link, so hand it to the
  // real browser rather than opening an unrestricted Electron window.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('https://')) void shell.openExternal(target)
    return { action: 'deny' }
  })

  // Keep the window on the editor; a navigation anywhere else is a link.
  window.webContents.on('will-navigate', (event, target) => {
    if (renderer !== null && target.startsWith(renderer.origin)) return
    event.preventDefault()
    if (target.startsWith('https://')) void shell.openExternal(target)
  })

  void window.loadURL(url)
}

/**
 * Shut the services down, ignoring errors so quitting is never blocked.
 */
async function stopServices(): Promise<void> {
  // Clear the handles before awaiting, so a second quit cannot close them twice.
  const closing = [bridge?.close(), renderer?.close()].filter((pending) => pending !== undefined)
  bridge = null
  renderer = null
  await Promise.allSettled(closing)
}

app.on('window-all-closed', () => {
  // macOS apps normally stay open with no windows; every other platform quits.
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  logger?.log('Information', 'Skie AI Editor shutting down')
  void stopServices()

  // A socket that refuses to close must not strand the user in an app that
  // will not exit, so the process leaves anyway shortly after.
  const forceExit = setTimeout(() => {
    logger?.log('Warning', 'Shutdown took too long; exiting anyway')
    app.exit(0)
  }, SHUTDOWN_GRACE_MS)
  forceExit.unref()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && renderer !== null && bridge !== null) {
    const target = new URL(renderer.origin)
    target.searchParams.set('aiBridge', bridge.editorUrl)
    createWindow(target.toString())
  }
})

app
  .whenReady()
  .then(startServices)
  .then((url) => {
    buildMenu()
    createWindow(url)
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    logger?.log('Error', `Startup failed: ${message}`)
    dialog.showErrorBox('Skie AI Editor could not start', message)
    app.exit(1)
  })
