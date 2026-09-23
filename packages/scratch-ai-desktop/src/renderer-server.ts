import { createReadStream, promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'

/** Media types for everything the editor bundle serves. */
const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

/** A static server that is up and listening. */
export interface RendererServer {
  readonly origin: string
  close(): Promise<void>
}

/**
 * Resolve a request path to a file inside the bundle, refusing anything that
 * climbs out of it.
 * @param root the directory being served
 * @param urlPath the request's pathname
 * @returns the absolute path to serve, or null when the request escapes the root
 */
function resolveWithinRoot(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/')
  const relative = normalize(decoded).replace(/^([/\\])+/, '')
  const resolved = join(root, relative === '' ? 'index.html' : relative)
  if (resolved !== root && !resolved.startsWith(root + sep)) return null
  return resolved
}

/**
 * Serve the built editor over loopback HTTP.
 *
 * The window could load the bundle straight off disk, but a `file://` page has
 * the opaque origin `null`, which local model servers such as Ollama and
 * LM Studio reject and which no CORS setting can allow. Serving it from
 * 127.0.0.1 gives the page a real origin that those servers can be configured
 * to accept.
 * @param root the directory holding the built editor
 * @param host the loopback address to bind
 * @returns the running server
 */
export async function startRendererServer(root: string, host: string): Promise<RendererServer> {
  const server: Server = createServer((request, response) => {
    const target = resolveWithinRoot(root, request.url ?? '/')
    if (target === null) {
      response.writeHead(403).end('Forbidden')
      return
    }

    void fs
      .stat(target)
      .then((stats) => (stats.isDirectory() ? join(target, 'index.html') : target))
      .then((file) => {
        response.writeHead(200, {
          'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        })
        createReadStream(file).pipe(response)
      })
      .catch(() => {
        response.writeHead(404).end('Not found')
      })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    // Port 0 asks the OS for a free port, so two copies of the app can run at once.
    server.listen(0, host, resolve)
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('The renderer server did not report a TCP address after listening.')
  }

  return {
    origin: `http://${host}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
