import type { ChatDelta, ChatMessage, ChatResult, ChatTool, ModelInfo, ToolDefinition } from '../types'

/** The envelope protocol version this bridge speaks. */
export const PROTOCOL_VERSION = 1

/** How long a tool invocation may wait for the editor before it is abandoned. */
const DEFAULT_INVOKE_TIMEOUT_MS = 30_000

/** How often the bridge pings the attached editor. */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000

/** Pings that may go unanswered before the socket is considered dead. */
/*
 * Four missed beats is a minute of silence. The editor answers pings on its main
 * thread, which a long tool run or a heavy project redraw can occupy for a
 * while, and dropping a working connection is far worse than noticing a dead one
 * late.
 */
const MAX_MISSED_HEARTBEATS = 4

/** Message used wherever a tool call arrives with no editor to run it. */
export const EDITOR_NOT_CONNECTED = 'The Scratch editor is not connected to this bridge.'

/** WebSocket close codes the bridge uses, in the private 4000-4999 range. */
export const CLOSE_CODES = {
  EDITOR_ALREADY_ATTACHED: 4001,
  UNSUPPORTED_PROTOCOL: 4002,
  HEARTBEAT_TIMEOUT: 4003,
} as const

/** The part of a WebSocket the hub drives, so the protocol can be tested without a server. */
export interface EditorSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
}

/** A chat completion the editor asked the bridge to run on its behalf. */
export interface ChatRequestEnvelope {
  /** Correlates the reply, and names the request a `chat-cancel` refers to. */
  id: string
  provider: string
  model: string
  messages: ChatMessage[]
  /**
   * The key the user entered in the editor. When absent the bridge falls back
   * to its own environment or config file, so an operator can still keep the
   * key out of the editor entirely.
   */
  apiKey?: string
  tools?: ChatTool[]
  temperature?: number
  maxTokens?: number
}

/** How a chat handler answers the editor. */
export interface ChatResponder {
  delta(delta: ChatDelta): void
  done(result: ChatResult): void
  fail(message: string): void
}

/** How a model-listing handler answers the editor. */
export interface ModelsResponder {
  done(models: ModelInfo[]): void
  fail(message: string): void
}

/** Callbacks the bridge supplies to react to what the editor sends. */
export interface EditorHubOptions {
  invokeTimeoutMs?: number
  /** Set to 0 to disable the heartbeat. */
  heartbeatIntervalMs?: number
  onAttach?: () => void
  onDetach?: () => void
  onToolsChanged?: (tools: readonly ToolDefinition[]) => void
  onEditorEvent?: (event: string, payload: unknown) => void
  onChatRequest?: (request: ChatRequestEnvelope, responder: ChatResponder) => void
  onModelsRequest?: (provider: string, apiKey: string | undefined, responder: ModelsResponder) => void
  /** Called when the editor abandons a chat, so the provider request can be dropped. */
  onChatCancel?: (id: string) => void
}

/** A tool invocation waiting for the editor to answer. */
interface PendingInvocation {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Owns the single editor connection and the envelope protocol spoken over it.
 *
 * A browser page cannot listen on a port or speak MCP stdio, so the editor dials
 * out to this process and the hub drives it from here: MCP tool calls arrive as
 * `invoke` envelopes and come back as `result`, and the editor's own chat
 * requests go out to the providers whose API keys only this process holds.
 *
 * Only one editor may be attached, because a tool call names no editor and two
 * attached editors would make "run this in Scratch" ambiguous.
 */
export class EditorHub {
  private readonly options: EditorHubOptions
  private socket: EditorSocket | null = null
  private toolCatalogue: readonly ToolDefinition[] = []
  private readonly pending = new Map<string, PendingInvocation>()
  private nextInvocationId = 1
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private missedHeartbeats = 0

  /**
   * @param options callbacks and timings for this hub
   */
  constructor(options: EditorHubOptions = {}) {
    this.options = options
  }

  /**
   * Whether an editor is currently attached.
   * @returns true while a socket is open
   */
  get attached(): boolean {
    return this.socket !== null
  }

  /**
   * The tool catalogue the editor last announced.
   *
   * It outlives the connection so an MCP client still sees what Scratch can do
   * while the editor tab is closed; calling one of those tools then fails with a
   * clear message instead of listing nothing at all.
   * @returns the tools the editor announced, or an empty list before its first greeting
   */
  get tools(): readonly ToolDefinition[] {
    return this.toolCatalogue
  }

  /**
   * Attach an editor, if none is attached already.
   * @param socket the newly opened socket
   * @returns whether the socket became the attached editor
   */
  attach(socket: EditorSocket): boolean {
    if (this.socket) {
      socket.close(CLOSE_CODES.EDITOR_ALREADY_ATTACHED, 'Another Scratch editor is already attached to this bridge.')
      return false
    }

    this.socket = socket
    this.missedHeartbeats = 0
    this.startHeartbeat()
    this.options.onAttach?.()
    return true
  }

  /**
   * Handle one envelope from the attached editor.
   * @param raw the raw JSON text
   */
  handleMessage(raw: string): void {
    let envelope: Record<string, unknown>
    try {
      envelope = JSON.parse(raw) as Record<string, unknown>
    } catch {
      console.warn('EditorHub.handleMessage: discarding an unparseable envelope from the editor')
      return
    }

    // Any traffic proves the socket is alive, not only an explicit pong.
    this.missedHeartbeats = 0

    switch (envelope.type) {
      case 'hello':
        this.handleHello(envelope)
        break
      case 'result':
        this.handleResult(envelope)
        break
      case 'event':
        this.options.onEditorEvent?.(String(envelope.event), envelope.payload)
        break
      case 'chat':
        this.handleChat(envelope)
        break
      case 'models':
        this.handleModels(envelope)
        break
      case 'chat-cancel':
        this.options.onChatCancel?.(String(envelope.id))
        break
      case 'ping':
        this.send({ type: 'pong' })
        break
      case 'pong':
        break
      default:
        console.warn(`EditorHub.handleMessage: ignoring unknown envelope type "${String(envelope.type)}"`)
    }
  }

  /** Detach the current editor and fail everything that was waiting on it. */
  handleClose(): void {
    if (!this.socket) return

    this.socket = null
    this.stopHeartbeat()

    const error = new Error('The Scratch editor disconnected before answering.')
    for (const invocation of this.pending.values()) {
      clearTimeout(invocation.timer)
      invocation.reject(error)
    }
    this.pending.clear()

    this.options.onDetach?.()
  }

  /**
   * Ask the editor to run one tool.
   * @param name the tool to run
   * @param args its arguments
   * @returns whatever the editor returned
   */
  invoke(name: string, args: unknown): Promise<unknown> {
    if (!this.socket) {
      return Promise.reject(new Error(EDITOR_NOT_CONNECTED))
    }

    const id = String(this.nextInvocationId++)
    const timeoutMs = this.options.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`The Scratch editor did not answer the tool "${name}" within ${timeoutMs}ms.`))
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timer })
      this.send({ type: 'invoke', id, name, args })
    })
  }

  /** Stop the heartbeat and close the editor socket. */
  close(): void {
    this.stopHeartbeat()
    this.socket?.close(1001, 'The bridge is shutting down.')
    this.handleClose()
  }

  /**
   * Record the editor's tool catalogue.
   * @param envelope the editor's greeting, carrying its protocol version and tools
   */
  private handleHello(envelope: Record<string, unknown>): void {
    if (envelope.protocolVersion !== PROTOCOL_VERSION) {
      this.socket?.close(
        CLOSE_CODES.UNSUPPORTED_PROTOCOL,
        `This bridge speaks protocol version ${PROTOCOL_VERSION}, the editor speaks ` +
          `${String(envelope.protocolVersion)}.`,
      )
      return
    }

    this.toolCatalogue = Array.isArray(envelope.tools) ? (envelope.tools as ToolDefinition[]) : []
    this.options.onToolsChanged?.(this.toolCatalogue)
  }

  /**
   * Settle the invocation this result answers.
   * @param envelope the editor's answer, carrying the invocation id and its outcome
   */
  private handleResult(envelope: Record<string, unknown>): void {
    const id = String(envelope.id)
    const invocation = this.pending.get(id)

    if (!invocation) {
      console.warn(`EditorHub.handleResult: no invocation "${id}" is waiting; it most likely timed out`)
      return
    }

    this.pending.delete(id)
    clearTimeout(invocation.timer)

    if (envelope.ok) {
      invocation.resolve(envelope.result)
    } else {
      invocation.reject(new Error(describeEditorError(envelope.error, id)))
    }
  }

  /**
   * Hand a chat request to the provider proxy.
   * @param envelope the editor's request, naming the provider, model and messages
   */
  private handleChat(envelope: Record<string, unknown>): void {
    const id = String(envelope.id)
    const responder: ChatResponder = {
      delta: (delta) => this.send({ type: 'chat-delta', id, delta }),
      done: (result) => this.send({ type: 'chat-done', id, ok: true, result }),
      fail: (message) => this.send({ type: 'chat-done', id, ok: false, error: message }),
    }

    if (!this.options.onChatRequest) {
      responder.fail('This bridge is not configured to proxy chat requests.')
      return
    }

    this.options.onChatRequest(envelope as unknown as ChatRequestEnvelope, responder)
  }

  /**
   * Hand a model-listing request to the provider proxy.
   * @param envelope the editor's request, naming the provider to list models for
   */
  private handleModels(envelope: Record<string, unknown>): void {
    const id = String(envelope.id)
    const responder: ModelsResponder = {
      done: (models) => this.send({ type: 'models-done', id, ok: true, models }),
      fail: (message) => this.send({ type: 'models-done', id, ok: false, error: message }),
    }

    if (!this.options.onModelsRequest) {
      responder.fail('This bridge is not configured to list models.')
      return
    }

    const apiKey = typeof envelope.apiKey === 'string' ? envelope.apiKey : undefined
    this.options.onModelsRequest(String(envelope.provider), apiKey, responder)
  }

  /** Begin pinging the attached editor. */
  private startHeartbeat(): void {
    const interval = this.options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
    if (interval <= 0) return

    this.heartbeatTimer = setInterval(() => {
      if (this.missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
        this.socket?.close(CLOSE_CODES.HEARTBEAT_TIMEOUT, 'The editor stopped answering heartbeats.')
        return
      }
      this.missedHeartbeats++
      this.send({ type: 'ping' })
    }, interval)
  }

  /** Stop pinging. */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer === null) return
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  /**
   * Send one envelope to the attached editor.
   * @param envelope the envelope to send
   */
  private send(envelope: Record<string, unknown>): void {
    if (!this.socket) {
      console.warn(`EditorHub.send: dropping a "${String(envelope.type)}" envelope because no editor is attached`)
      return
    }
    this.socket.send(JSON.stringify(envelope))
  }
}

/**
 * Turn whatever the editor put in an envelope's `error` field into a message.
 *
 * The field crosses a JSON boundary, so it is a string in the normal case but
 * can be any shape; stringifying an object directly would yield
 * `[object Object]` and lose the reason entirely.
 * @param error the envelope's error field
 * @param id the invocation the error belongs to
 * @returns a human-readable message
 */
function describeEditorError(error: unknown, id: string): string {
  if (typeof error === 'string' && error.length > 0) return error
  if (error === null || error === undefined) return `The editor failed to run invocation "${id}".`
  return JSON.stringify(error)
}
