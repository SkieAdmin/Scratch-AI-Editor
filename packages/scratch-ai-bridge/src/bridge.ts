import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import type { Server as McpSdkServer } from '@modelcontextprotocol/sdk/server/index.js'
import { resolveProviderSettings, type BridgeConfigFile } from './config'
import { EditorHub, type ChatRequestEnvelope, type ChatResponder, type ModelsResponder } from './hub/editor-hub'
import { attachEditorWebSocket } from './hub/ws-server'
import { log } from './log'
import {
  createMcpServer,
  describeError,
  notifyToolListChanged,
  serveMcpOverHttp,
  serveMcpOverStdio,
} from './mcp/server'
import { createProvider, isProviderId, type ProviderContext } from './providers'
import { listModels, streamChat } from './providers/openai-compatible'

/** Where the editor endpoint lives. */
export const EDITOR_PATH = '/editor'

/** Where the Streamable HTTP MCP endpoint lives. */
export const MCP_PATH = '/mcp'

/** The port the bridge listens on unless told otherwise. */
export const DEFAULT_PORT = 8610

/**
 * The bridge binds here by default. Binding to 0.0.0.0 would put a process that
 * holds API keys and drives the editor on the local network.
 */
export const DEFAULT_HOST = '127.0.0.1'

/** How the bridge identifies itself to OpenRouter when the operator sets nothing. */
const DEFAULT_OPENROUTER_REFERER = 'https://github.com/SkieAdmin'
const DEFAULT_OPENROUTER_TITLE = 'Skie AI Editor'

/** Bytes of entropy in a generated token. */
const TOKEN_BYTES = 24

/** How to start the bridge. */
export interface BridgeOptions {
  port?: number
  host?: string
  /** Shared secret the editor must present; one is generated when omitted. */
  token?: string
  /** Exact origins to allow, or empty to allow any local origin. */
  allowedOrigins?: string[]
  /** Also serve MCP over Streamable HTTP at `/mcp`. */
  mcpHttp?: boolean
  /** Serve MCP over stdio, so a client can spawn the bridge. */
  mcpStdio?: boolean
  /** Contents of the operator's config file. */
  config?: BridgeConfigFile
  /** Version reported to MCP clients. */
  version?: string
  invokeTimeoutMs?: number
}

/** A bridge that is up and listening. */
export interface RunningBridge {
  readonly port: number
  readonly host: string
  readonly token: string
  /** The URL to paste into the editor's AI settings, token included. */
  readonly editorUrl: string
  /** The Streamable HTTP MCP endpoint, or null when it is not served. */
  readonly mcpHttpUrl: string | null
  readonly hub: EditorHub
  close(): Promise<void>
}

/**
 * Start the bridge: the editor WebSocket hub, the MCP server(s) that forward
 * tool calls to it, and the provider proxy that keeps API keys in this process.
 * @param options how to start it
 * @returns the running bridge
 */
export async function startBridge(options: BridgeOptions = {}): Promise<RunningBridge> {
  const config = options.config ?? {}
  const port = options.port ?? config.port ?? DEFAULT_PORT
  const host = options.host ?? config.host ?? DEFAULT_HOST
  const token = options.token ?? config.token ?? randomBytes(TOKEN_BYTES).toString('hex')
  const allowedOrigins = options.allowedOrigins ?? config.allowOrigin ?? []
  const serveHttpMcp = options.mcpHttp ?? config.mcpHttp ?? false
  const version = options.version ?? '0.0.0'

  const providerContext: ProviderContext = {
    settings: resolveProviderSettings(config, process.env),
    openRouterReferer: config.openRouter?.referer ?? DEFAULT_OPENROUTER_REFERER,
    openRouterTitle: config.openRouter?.title ?? DEFAULT_OPENROUTER_TITLE,
  }

  const mcpServers: McpSdkServer[] = []

  // Lets a `chat-cancel` stop the provider request the editor no longer wants.
  const inFlightChats = new Map<string, AbortController>()

  const hub = new EditorHub({
    invokeTimeoutMs: options.invokeTimeoutMs,
    onToolsChanged: (tools) => {
      log(`the editor announced ${tools.length} tools`)
      notifyToolListChanged(mcpServers)
    },
    onDetach: () => {
      log('the editor disconnected')
    },
    onChatRequest: (request, responder) => {
      const controller = new AbortController()
      inFlightChats.set(request.id, controller)
      const context = withApiKey(providerContext, request.provider, request.apiKey)
      void runChat(request, responder, context, controller.signal).finally(() => {
        inFlightChats.delete(request.id)
      })
    },
    onChatCancel: (id) => {
      inFlightChats.get(id)?.abort()
      inFlightChats.delete(id)
    },
    onModelsRequest: (provider, apiKey, responder) => {
      void runModelListing(provider, responder, withApiKey(providerContext, provider, apiKey))
    },
  })

  const httpServer = createServer()
  const wss = attachEditorWebSocket(httpServer, hub, { token, allowedOrigins, path: EDITOR_PATH })

  const httpTransport = serveHttpMcp ? await serveMcpOverHttp(pushServer(mcpServers, hub, version)) : null
  httpServer.on('request', (request, response) => {
    handleHttpRequest(request, response, httpTransport).catch((error: unknown) => {
      // An HTTP client is outside the trust boundary, so a malformed body is
      // its mistake to hear about, not a reason to take the bridge down.
      const message = describeError(error)
      log(`the ${request.method ?? 'GET'} ${request.url ?? '/'} request failed: ${message}`)
      if (!response.headersSent) {
        response.writeHead(400, { 'Content-Type': 'text/plain' })
      }
      response.end(message)
    })
  })

  const stdioTransport = options.mcpStdio ? await serveMcpOverStdio(pushServer(mcpServers, hub, version)) : null

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve))
  const boundPort = resolvePort(httpServer, port)

  return {
    port: boundPort,
    host,
    token,
    editorUrl: `ws://${host}:${boundPort}${EDITOR_PATH}?token=${token}`,
    mcpHttpUrl: httpTransport ? `http://${host}:${boundPort}${MCP_PATH}` : null,
    hub,
    async close() {
      hub.close()

      // `httpServer.close` waits for open connections to end, and the editor's
      // WebSocket lives on this same server, so the sockets have to be hung up
      // first or shutting down never finishes.
      for (const client of wss.clients) {
        client.terminate()
      }
      wss.close()

      await Promise.all(mcpServers.map((server) => server.close()))
      await stdioTransport?.close()

      httpServer.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

/**
 * Build an MCP server and remember it, so tool-list changes reach every transport.
 * @param servers the list of live servers
 * @param hub the hub to forward tool calls to
 * @param version the bridge's version
 * @returns the new server
 */
function pushServer(servers: McpSdkServer[], hub: EditorHub, version: string): McpSdkServer {
  const server = createMcpServer(hub, version)
  servers.push(server)
  return server
}

/** The subset of the Streamable HTTP transport this module drives. */
interface HttpMcpTransport {
  handleRequest(request: IncomingMessage, response: ServerResponse, body?: unknown): Promise<void>
}

/**
 * Route plain HTTP requests: MCP traffic to the Streamable HTTP transport, and a
 * health probe the editor can use to tell "bridge is down" from "token is wrong".
 * @param request the incoming request
 * @param response the response to write
 * @param transport the MCP transport, or null when HTTP MCP is off
 */
async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  transport: HttpMcpTransport | null,
): Promise<void> {
  const path = new URL(request.url ?? '/', `http://${request.headers.host ?? DEFAULT_HOST}`).pathname

  if (path === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ ok: true }))
    return
  }

  if (path !== MCP_PATH || !transport) {
    response.writeHead(404, { 'Content-Type': 'text/plain' })
    response.end(`This bridge serves no endpoint at ${path}.`)
    return
  }

  await transport.handleRequest(request, response, await readJsonBody(request))
}

/**
 * Read and decode a request body, which the MCP transport expects pre-parsed.
 * @param request the incoming request
 * @returns the decoded body, or undefined when there was none
 */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.method !== 'POST') return undefined

  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return undefined

  return JSON.parse(text)
}

/**
 * Apply a key the editor supplied, leaving the bridge's own configuration in
 * place when it did not send one.
 * @param context the bridge's resolved provider settings
 * @param provider which provider the request names
 * @param apiKey the key the editor sent, if any
 * @returns the context to serve this one request with
 */
function withApiKey(context: ProviderContext, provider: string, apiKey?: string): ProviderContext {
  if (!apiKey || !isProviderId(provider)) return context

  return {
    ...context,
    settings: {
      ...context.settings,
      [provider]: { ...context.settings[provider], apiKey },
    },
  }
}

/**
 * Run one chat completion on the editor's behalf and stream it back.
 * @param request what the editor asked for
 * @param responder how to answer it
 * @param context resolved provider settings
 * @param signal aborts the provider request when the editor abandons the turn
 */
async function runChat(
  request: ChatRequestEnvelope,
  responder: ChatResponder,
  context: ProviderContext,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const adapter = createProvider(request.provider, context)
    const result = await streamChat(
      adapter,
      {
        model: request.model,
        messages: request.messages,
        tools: request.tools,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
      },
      (delta) => responder.delta(delta),
      signal,
    )
    responder.done(result)
  } catch (error) {
    responder.fail(describeError(error))
  }
}

/**
 * List one provider's models on the editor's behalf.
 * @param provider the provider to ask
 * @param responder how to answer
 * @param context resolved provider settings
 */
async function runModelListing(
  provider: string,
  responder: ModelsResponder,
  context: ProviderContext,
): Promise<void> {
  try {
    responder.done(await listModels(createProvider(provider, context)))
  } catch (error) {
    responder.fail(describeError(error))
  }
}

/**
 * Read the port the server actually bound to, which differs from the requested
 * one when the operator asked for port 0.
 * @param server the listening server
 * @param requested the port that was asked for
 * @returns the bound port
 */
function resolvePort(server: HttpServer, requested: number): number {
  const address = server.address()
  return address !== null && typeof address === 'object' ? address.port : requested
}
