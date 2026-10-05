import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startBridge, type RunningBridge } from '@skieadmin/scratch-ai-bridge'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  shell,
  type BaseWindow,
  type MessageBoxOptions,
  type WebContents,
} from 'electron'
import {
  configPath,
  keepShellSettings,
  readConfig,
  resolveMcpPort,
  writeConfig,
  type StoredConfig,
} from './config-store.ts'
import { createLogger, type LogLevel, type Logger } from './logger.ts'
import {
  claudeMcpAddCommand,
  discoveryFilePath,
  removeDiscoveryFile,
  startOnPreferredPort,
  writeDiscoveryFile,
} from './mcp-endpoint.ts'
import { startRendererServer, type RendererServer } from './renderer-server.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Everything stays on loopback; nothing this app runs should be reachable from the network. */
const LOOPBACK = '127.0.0.1'

/** How long a clean shutdown gets before the process exits regardless. */
const SHUTDOWN_GRACE_MS = 3000

const WINDOW_DEFAULTS = { width: 1280, height: 860, minWidth: 1024, minHeight: 700 }

/** The widest a window capture is returned; wider ones are scaled down. */
const MAX_CAPTURE_WIDTH = 1600

/** The built editor, copied next to the compiled main process by `npm run stage`. */
const RENDERER_ROOT = join(HERE, '..', 'renderer')

let bridge: RunningBridge | null = null
let renderer: RendererServer | null = null
let settingsPath = ''
let discoveryPath = ''
let logger: Logger | null = null

/** The bearer token MCP clients must send, from the settings file, if one is set. */
let mcpToken: string | undefined

/** The port the settings asked for, when it was taken and the endpoint moved to another. */
let busyMcpPort: number | null = null

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
  discoveryPath = discoveryFilePath(app.getPath('documents'))

  // The renderer asks for the saved settings synchronously while its store is
  // being built, so this cannot be a promise-returning channel.
  ipcMain.on('scratch-ai:read-config', (event) => {
    event.returnValue = readConfig(settingsPath)
  })
  ipcMain.handle('scratch-ai:write-config', (_event, config: StoredConfig) => {
    writeConfig(settingsPath, keepShellSettings(readConfig(settingsPath), config))
  })
  ipcMain.on('scratch-ai:log', (_event, level: LogLevel, message: string) => {
    logger?.log(level, message)
  })
  ipcMain.handle('scratch-ai:capture-window', (event) => captureWindow(event.sender))

  renderer = await startRendererServer(RENDERER_ROOT, LOOPBACK)
  const rendererOrigin = renderer.origin

  const settings = readConfig(settingsPath)
  mcpToken = settings.mcpToken
  const mcpPort = resolveMcpPort(settings, (message) => logger?.log('Warning', message))

  bridge = await startOnPreferredPort(
    (port) =>
      startBridge({
        host: LOOPBACK,
        port,
        // Only this app's own window may drive the editor.
        allowedOrigins: [rendererOrigin],
        mcpHttp: true,
        mcpToken,
        version: app.getVersion(),
      }),
    mcpPort,
    (port) => {
      busyMcpPort = port
      logger?.log(
        'Warning',
        `Port ${port} is already in use, so the MCP endpoint is on a random port until the app restarts. ` +
          `Close whatever holds port ${port}, or set mcpPort in ${settingsPath}.`,
      )
    },
  )
  announceMcpEndpoint(bridge)

  const target = new URL(renderer.origin)
  // The page reads these back through the preload bridge; they are not secrets
  // to the page itself, which is the only origin allowed to use them.
  target.searchParams.set('aiBridge', bridge.editorUrl)
  return target.toString()
}

/**
 * Take a picture of the editor window for the capture_editor tool.
 *
 * `capturePage` asks the page to paint, so the picture is current even while
 * another window covers this one, where a screen grab would show stale pixels.
 * @param contents the page asking, which is the one to capture
 * @returns the picture as base64 PNG, with its size
 */
async function captureWindow(
  contents: WebContents,
): Promise<{ data: string; mimeType: string; width: number; height: number }> {
  let image = await contents.capturePage()
  if (image.isEmpty()) {
    throw new Error('The editor window could not be captured. It may be minimized; restore it and try again.')
  }
  // A high-DPI screen doubles or triples the pixels without adding anything
  // a model can see, and it multiplies the size of every reply.
  if (image.getSize().width > MAX_CAPTURE_WIDTH) {
    image = image.resize({ width: MAX_CAPTURE_WIDTH })
  }
  const { width, height } = image.getSize()
  return { data: image.toPNG().toString('base64'), mimeType: 'image/png', width, height }
}

/**
 * Log the MCP endpoint and write the discovery file, so a client can be
 * pointed at it without the user having to look it up.
 * @param running the started bridge
 */
function announceMcpEndpoint(running: RunningBridge): void {
  const url = running.mcpHttpUrl
  if (url === null) throw new Error('announceMcpEndpoint: the bridge was started without its MCP endpoint')

  logger?.log('Information', `MCP endpoint: ${url}`)
  try {
    writeDiscoveryFile(discoveryPath, {
      url,
      port: running.port,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    })
  } catch (error) {
    // Discovery is a convenience; the endpoint works without the file.
    logger?.log(
      'Warning',
      `Could not write ${discoveryPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Show the MCP endpoint, with buttons that copy what a client needs.
 * @param window the window to attach the dialog to, if there is one
 */
async function showConnectDialog(window: BaseWindow | undefined): Promise<void> {
  const url = bridge?.mcpHttpUrl
  // Nothing to connect to while the app is starting up or shutting down.
  if (!url) return

  const command = claudeMcpAddCommand(url, mcpToken)
  const moved =
    busyMcpPort === null
      ? ''
      : `\n\nPort ${busyMcpPort} was in use when the app started, so this address changes after a restart.`
  const options: MessageBoxOptions = {
    type: 'info',
    title: 'Connect an AI client',
    message: `The editor's MCP endpoint is ${url}`,
    detail:
      `To drive this editor from Claude Code, run:\n\n${command}\n\n` +
      `Other MCP clients connect to the same address over Streamable HTTP.${moved}`,
    buttons: ['Copy command', 'Copy URL', 'Close'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  }

  const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
  if (response === 0) clipboard.writeText(command)
  if (response === 1) clipboard.writeText(url)
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
            label: 'Connect an AI client...',
            click: (_item, window) => void showConnectDialog(window),
          },
          { type: 'separator' },
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
  try {
    removeDiscoveryFile(discoveryPath, process.pid)
  } catch (error) {
    logger?.log(
      'Warning',
      `Could not remove ${discoveryPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  void stopServices()

  // A socket that refuses to close must not strand the user in an app that
  // will not exit, so the process leaves anyway shortly after.
  // Not unref'd on purpose: an unreferenced timer need never fire, which is
  // exactly the case where this is the only thing left to end the process.
  setTimeout(() => {
    logger?.log('Warning', 'Shutdown took too long; exiting anyway')
    app.exit(0)
  }, SHUTDOWN_GRACE_MS)
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
