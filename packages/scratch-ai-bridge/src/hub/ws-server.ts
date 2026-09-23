import type { Server as HttpServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { verifyUpgrade, type UpgradePolicy } from './auth'
import type { EditorHub } from './editor-hub'

/** Reason phrases for the statuses a rejected upgrade can answer with. */
const STATUS_TEXT: Record<number, string> = {
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
}

/**
 * Serve the editor WebSocket endpoint on an existing HTTP server.
 *
 * The upgrade is checked before the handshake completes, so a page that fails
 * the origin or token check never gets a socket at all.
 * @param server the HTTP server to add the endpoint to
 * @param hub the hub that will own the connection
 * @param policy the origin and token policy to enforce
 * @returns the WebSocket server, so the caller can close it
 */
export function attachEditorWebSocket(server: HttpServer, hub: EditorHub, policy: UpgradePolicy): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    const verdict = verifyUpgrade(request.url, request.headers.origin, policy)

    if (!verdict.ok) {
      console.warn(`scratch-ai-bridge: refused a WebSocket upgrade (${verdict.status}): ${verdict.message}`)
      socket.write(
        `HTTP/1.1 ${verdict.status} ${STATUS_TEXT[verdict.status]}\r\n` +
          'Connection: close\r\n' +
          'Content-Length: 0\r\n' +
          '\r\n',
      )
      socket.destroy()
      return
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  })

  wss.on('connection', (ws) => {
    const attached = hub.attach({
      send: (data) => ws.send(data),
      close: (code, reason) => ws.close(code, reason),
    })
    if (!attached) return

    ws.on('message', (data) => hub.handleMessage(decodeFrame(data)))
    ws.on('close', () => hub.handleClose())
  })

  return wss
}

/**
 * Read a WebSocket frame as UTF-8 text.
 *
 * `ws` delivers a Buffer, an ArrayBuffer, or an array of Buffers when a message
 * arrived in fragments, and only the first of those stringifies correctly on
 * its own.
 * @param data the frame as `ws` delivered it
 * @returns the frame's text
 */
function decodeFrame(data: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}
