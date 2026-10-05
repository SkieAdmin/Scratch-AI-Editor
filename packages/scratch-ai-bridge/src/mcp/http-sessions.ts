import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { writeJsonRpcError } from './http-errors'

/**
 * How long a session may sit with no open request before it is closed. A
 * connected client keeps a stream open for notifications, so this only reaps
 * sessions whose client went away without saying goodbye.
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000

/** How often idle sessions are looked for, at most. */
const MAX_SWEEP_INTERVAL_MS = 60 * 1000

/** How to run the sessions. */
export interface McpHttpSessionsOptions {
  /** Build the MCP server for one new session. */
  createServer: () => Server
  /** Close a session after it has had no open request for this long. */
  idleTimeoutMs?: number
  /** Told when a session opens or closes. */
  onSessionsChanged?: (event: 'opened' | 'closed', sessionId: string, openSessions: number) => void
}

/** One client's session. */
interface Session {
  readonly transport: StreamableHTTPServerTransport
  readonly server: Server
  /** Requests whose response is still open, including a client's notification stream. */
  openRequests: number
  /** When the last request arrived or finished. */
  lastActive: number
}

/**
 * Serves MCP over Streamable HTTP to any number of clients at once.
 *
 * A Streamable HTTP transport holds exactly one session and answers a second
 * `initialize` with "Server already initialized", so one transport shared by
 * every client locks out all but the first, including that same client after a
 * restart. Each `initialize` therefore gets its own transport and server, and
 * later requests are routed to them by their `Mcp-Session-Id` header.
 */
export class McpHttpSessions {
  private readonly options: McpHttpSessionsOptions
  private readonly sessions = new Map<string, Session>()
  private readonly sweepTimer: ReturnType<typeof setInterval>

  /**
   * @param options how to build and expire sessions
   */
  constructor(options: McpHttpSessionsOptions) {
    this.options = options
    const idleTimeoutMs = this.idleTimeoutMs
    this.sweepTimer = setInterval(() => this.closeIdle(), Math.min(idleTimeoutMs, MAX_SWEEP_INTERVAL_MS))
    // A sweep is housekeeping; it must never be the reason the process stays up.
    this.sweepTimer.unref()
  }

  /**
   * The server behind every open session, so a change can be announced to all of them.
   * @returns the servers, one per session
   */
  get servers(): Server[] {
    return [...this.sessions.values()].map((session) => session.server)
  }

  /**
   * How many sessions are open.
   * @returns the session count
   */
  get size(): number {
    return this.sessions.size
  }

  /**
   * Handle one request to the MCP endpoint.
   * @param request the incoming request
   * @param response the response to write
   * @param body the request body, already parsed as JSON, or undefined when there was none
   */
  async handleRequest(request: IncomingMessage, response: ServerResponse, body: unknown): Promise<void> {
    const sessionId = request.headers['mcp-session-id']

    if (Array.isArray(sessionId)) {
      writeJsonRpcError(response, 400, -32000, 'Bad Request: send one Mcp-Session-Id header, not several.')
      return
    }

    if (sessionId !== undefined) {
      const session = this.sessions.get(sessionId)
      if (!session) {
        // The MCP spec has a client that receives 404 for its session start a
        // new one, which is how a client recovers after the bridge restarts.
        writeJsonRpcError(response, 404, -32001, 'Session not found. Start a new session with an initialize request.')
        return
      }
      await this.forward(session, request, response, body)
      return
    }

    if (request.method === 'POST' && containsInitialize(body)) {
      await this.open(request, response, body)
      return
    }

    writeJsonRpcError(
      response,
      400,
      -32000,
      'Bad Request: start a session with an initialize request, then send its Mcp-Session-Id header.',
    )
  }

  /**
   * Close every session whose client has been gone longer than the idle timeout.
   * @param now the current time, in milliseconds since the epoch
   */
  closeIdle(now = Date.now()): void {
    for (const session of this.sessions.values()) {
      if (session.openRequests === 0 && now - session.lastActive >= this.idleTimeoutMs) {
        void session.server.close()
      }
    }
  }

  /** Close every session. */
  async close(): Promise<void> {
    clearInterval(this.sweepTimer)
    await Promise.all([...this.sessions.values()].map((session) => session.server.close()))
    this.sessions.clear()
  }

  /**
   * The idle timeout in force.
   * @returns the timeout, in milliseconds
   */
  private get idleTimeoutMs(): number {
    return this.options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  }

  /**
   * Start a session for an `initialize` request.
   * @param request the incoming request
   * @param response the response to write
   * @param body the parsed initialize request
   */
  private async open(request: IncomingMessage, response: ServerResponse, body: unknown): Promise<void> {
    const server = this.options.createServer()
    const session: Session = {
      transport: new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          this.sessions.set(sessionId, session)
          this.options.onSessionsChanged?.('opened', sessionId, this.sessions.size)
        },
      }),
      server,
      openRequests: 0,
      lastActive: Date.now(),
    }

    // Set before connecting: the server chains its own close handling onto this one.
    session.transport.onclose = () => {
      const sessionId = session.transport.sessionId
      if (sessionId !== undefined && this.sessions.delete(sessionId)) {
        this.options.onSessionsChanged?.('closed', sessionId, this.sessions.size)
      }
    }

    await server.connect(session.transport)
    await this.forward(session, request, response, body)

    // A malformed initialize is answered with an error and never gets a
    // session id, so nothing else will ever reach this server.
    if (session.transport.sessionId === undefined) {
      await server.close()
    }
  }

  /**
   * Hand a request to a session's transport, tracking how long it stays open.
   * @param session the session the request belongs to
   * @param request the incoming request
   * @param response the response to write
   * @param body the parsed request body
   */
  private async forward(
    session: Session,
    request: IncomingMessage,
    response: ServerResponse,
    body: unknown,
  ): Promise<void> {
    session.openRequests++
    session.lastActive = Date.now()
    response.once('close', () => {
      session.openRequests--
      session.lastActive = Date.now()
    })
    await session.transport.handleRequest(request, response, body)
  }
}

/**
 * Whether a request body carries an MCP `initialize` request, alone or in a batch.
 * @param body the parsed request body
 * @returns true when it starts a session
 */
function containsInitialize(body: unknown): boolean {
  const messages: unknown[] = Array.isArray(body) ? body : [body]
  return messages.some((message) => isInitializeRequest(message))
}
