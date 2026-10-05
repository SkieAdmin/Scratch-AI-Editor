import { createServer, request as httpRequest, type Server as HttpServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpHttpSessions, PROTOCOL_VERSION, startBridge, type RunningBridge, type ToolDefinition } from '../src'
import { EditorHub } from '../src/hub/editor-hub'
import { createMcpServer } from '../src/mcp/server'
import { FakeSocket } from './test-utilities'

const TOOLS: ToolDefinition[] = [
  { name: 'green_flag', description: 'Start the project.', inputSchema: { type: 'object', properties: {} } },
]

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw-test', version: '1.0.0' } },
}

/** What a raw HTTP exchange came back with. */
interface RawResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

/**
 * Send one request with exactly the headers given, which `fetch` will not do
 * for `Host`.
 * @param url the endpoint
 * @param options the method, headers and JSON body to send
 * @param options.method the HTTP method
 * @param options.headers sent exactly as given, overriding the JSON defaults
 * @param options.body the request body, sent as JSON
 * @returns the response
 */
async function rawRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown },
): Promise<RawResponse> {
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname,
        method: options.method ?? 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...options.headers,
        },
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
      },
    )
    req.on('error', reject)
    if (options.body !== undefined) req.write(JSON.stringify(options.body))
    req.end()
  })
}

/**
 * Connect an MCP client the way Claude Code does.
 * @param url the MCP endpoint
 * @param headers extra headers to send with every request
 * @returns the connected client and its transport
 */
async function connectClient(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } })
  await client.connect(transport)
  return { client, transport }
}

/**
 * Attach a fake editor that announces the tool catalogue.
 * @param bridge the running bridge
 * @returns the editor's socket
 */
function attachEditor(bridge: RunningBridge): FakeSocket {
  const socket = new FakeSocket()
  bridge.hub.attach(socket)
  bridge.hub.handleMessage(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, tools: TOOLS }))
  return socket
}

describe('the MCP endpoint over Streamable HTTP', () => {
  let bridge: RunningBridge | null = null
  const clients: Client[] = []

  afterEach(async () => {
    const running = bridge
    bridge = null
    await Promise.all(clients.splice(0).map((client) => client.close()))
    await running?.close()
  })

  /**
   * Start a bridge that serves MCP over HTTP on a free port.
   * @param mcpToken the bearer token to require, if any
   * @returns the bridge and its MCP URL
   */
  async function start(mcpToken?: string): Promise<{ running: RunningBridge; url: string }> {
    const running = await startBridge({ port: 0, mcpHttp: true, mcpToken, token: 'editor-token' })
    bridge = running
    if (running.mcpHttpUrl === null) throw new Error('the bridge did not serve MCP over HTTP')
    return { running, url: running.mcpHttpUrl }
  }

  /*
   * One transport served every client, so a second `initialize`, including the
   * same client reconnecting after a restart, got HTTP 400 "Server already
   * initialized" until the app was restarted.
   */
  it('serves two clients at the same time', async () => {
    const { running, url } = await start()
    attachEditor(running)

    const first = await connectClient(url)
    const second = await connectClient(url)
    clients.push(first.client, second.client)

    expect(first.transport.sessionId).not.toBe(second.transport.sessionId)
    expect((await first.client.listTools()).tools.map((tool) => tool.name)).toEqual(['green_flag'])
    expect((await second.client.listTools()).tools.map((tool) => tool.name)).toEqual(['green_flag'])
  })

  it('routes each call to the session that made it', async () => {
    const { running, url } = await start()
    const editor = attachEditor(running)
    const first = await connectClient(url)
    const second = await connectClient(url)
    clients.push(first.client, second.client)

    const pending = second.client.callTool({ name: 'green_flag', arguments: {} })
    await vi.waitFor(() => expect(editor.sentOfType('invoke')).toHaveLength(1))
    const invoke = editor.sentOfType('invoke').at(0)
    running.hub.handleMessage(JSON.stringify({ type: 'result', id: invoke?.id, ok: true, result: { running: true } }))

    expect(await pending).toEqual({ content: [{ type: 'text', text: '{"running":true}' }] })
  })

  it('lets a client that restarted start a new session', async () => {
    const { url } = await start()
    const before = await connectClient(url)
    // A process that exits sends no DELETE; its session is simply abandoned.
    await before.transport.close()

    const after = await connectClient(url)
    clients.push(after.client)

    expect(after.transport.sessionId).toBeDefined()
    expect(after.transport.sessionId).not.toBe(before.transport.sessionId)
  })

  it('answers a session it does not know with 404, so the client starts again', async () => {
    const { url } = await start()

    const response = await rawRequest(url, {
      headers: { 'Mcp-Session-Id': 'gone', 'Mcp-Protocol-Version': '2025-06-18' },
      body: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    })

    expect(response.status).toBe(404)
  })

  it('closes a session when its client says goodbye', async () => {
    const { url } = await start()
    const { client, transport } = await connectClient(url)
    const sessionId = transport.sessionId

    await transport.terminateSession()
    await client.close()

    const response = await rawRequest(url, {
      headers: { 'Mcp-Session-Id': sessionId ?? '', 'Mcp-Protocol-Version': '2025-06-18' },
      body: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    })
    expect(response.status).toBe(404)
  })

  it('tells every session when the editor changes its tools', async () => {
    const { running, url } = await start()
    const first = await connectClient(url)
    const second = await connectClient(url)
    clients.push(first.client, second.client)

    const heard = { first: 0, second: 0 }
    first.client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      heard.first++
    })
    second.client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      heard.second++
    })

    // Each client opens its notification stream just after connecting, so
    // keep announcing until both streams are up to hear it.
    await vi.waitFor(() => {
      attachEditor(running)
      running.hub.handleClose()
      expect(heard.first).toBeGreaterThan(0)
      expect(heard.second).toBeGreaterThan(0)
    })
  })

  it('refuses a web page from another origin', async () => {
    const { url } = await start()

    const response = await rawRequest(url, { headers: { Origin: 'https://evil.example' }, body: INITIALIZE })

    expect(response.status).toBe(403)
    expect(response.body).toMatch(/Origin https:\/\/evil\.example is not allowed/)
  })

  it('refuses a Host it does not answer to, which is what DNS rebinding sends', async () => {
    const { running, url } = await start()

    const response = await rawRequest(url, { headers: { Host: `evil.example:${running.port}` }, body: INITIALIZE })

    expect(response.status).toBe(403)
    expect(response.body).toMatch(/Host evil\.example/)
  })

  it('accepts localhost as well as 127.0.0.1', async () => {
    const { running, url } = await start()

    const response = await rawRequest(url, { headers: { Host: `localhost:${running.port}` }, body: INITIALIZE })

    expect(response.status).toBe(200)
  })

  describe('with a bearer token', () => {
    it('refuses a request without it', async () => {
      const { url } = await start('s3cret')

      const response = await rawRequest(url, { body: INITIALIZE })

      expect(response.status).toBe(401)
      expect(response.headers['www-authenticate']).toMatch(/^Bearer/)
    })

    it('refuses the wrong token', async () => {
      const { url } = await start('s3cret')

      const response = await rawRequest(url, { headers: { Authorization: 'Bearer wrong' }, body: INITIALIZE })

      expect(response.status).toBe(401)
    })

    it('lets a client with the token in', async () => {
      const { url } = await start('s3cret')

      const { client } = await connectClient(url, { Authorization: 'Bearer s3cret' })
      clients.push(client)

      expect((await client.listTools()).tools).toEqual([])
    })
  })
})

describe('McpHttpSessions', () => {
  let server: HttpServer | null = null
  let sessions: McpHttpSessions | null = null

  afterEach(async () => {
    const [live, http] = [sessions, server]
    sessions = null
    server = null
    await live?.close()
    http?.closeAllConnections()
    await new Promise<void>((resolve) => (http ? http.close(() => resolve()) : resolve()))
  })

  /**
   * Serve a set of sessions with no access checks, so they can be driven directly.
   * @param idleTimeoutMs how long a session may sit idle
   * @returns the sessions and their URL
   */
  async function serve(idleTimeoutMs: number): Promise<{ live: McpHttpSessions; url: string }> {
    const hub = new EditorHub({ heartbeatIntervalMs: 0 })
    const live = new McpHttpSessions({ createServer: () => createMcpServer(hub, '0.0.0'), idleTimeoutMs })
    sessions = live
    const http = createServer((req, res) => {
      let text = ''
      req.setEncoding('utf8')
      req.on('data', (chunk: string) => (text += chunk))
      req.on('end', () => void live.handleRequest(req, res, text === '' ? undefined : JSON.parse(text)))
    })
    server = http
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
    const address = http.address()
    if (address === null || typeof address === 'string') throw new Error('no TCP address')
    return { live, url: `http://127.0.0.1:${address.port}/mcp` }
  }

  it('closes a session whose client went away without saying goodbye', async () => {
    const { live, url } = await serve(1000)
    const response = await rawRequest(url, { body: INITIALIZE })
    expect(response.status).toBe(200)
    expect(live.size).toBe(1)

    live.closeIdle(Date.now() + 500)
    expect(live.size).toBe(1)

    live.closeIdle(Date.now() + 5000)
    await vi.waitFor(() => expect(live.size).toBe(0))
  })

  it('keeps a session while its client is listening for notifications', async () => {
    const { live, url } = await serve(1000)
    const initialized = await rawRequest(url, { body: INITIALIZE })
    const sessionId = String(initialized.headers['mcp-session-id'])
    const stream = await openNotificationStream(url, sessionId)
    expect(stream.status).toBe(200)

    live.closeIdle(Date.now() + 5000)
    expect(live.size).toBe(1)

    stream.close()
    await vi.waitFor(() => {
      live.closeIdle(Date.now() + 5000)
      expect(live.size).toBe(0)
    })
  })
})

/**
 * Open the long-lived GET stream a client listens for notifications on.
 * @param url the MCP endpoint
 * @param sessionId the session to listen to
 * @returns the stream's status, and a way to hang it up
 */
async function openNotificationStream(url: string, sessionId: string): Promise<{ status: number; close(): void }> {
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Mcp-Session-Id': sessionId,
          'Mcp-Protocol-Version': '2025-06-18',
        },
      },
      (res) => resolve({ status: res.statusCode ?? 0, close: () => req.destroy() }),
    )
    req.on('error', (error: NodeJS.ErrnoException) => {
      // Hanging up the stream on purpose surfaces as a reset; only a failure to open is an error.
      if (error.code !== 'ECONNRESET') reject(error)
    })
    req.end()
  })
}
