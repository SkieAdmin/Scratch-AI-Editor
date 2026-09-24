import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLOSE_CODES,
  EDITOR_NOT_CONNECTED,
  EditorHub,
  PROTOCOL_VERSION,
  type ChatRequestEnvelope,
  type ChatResponder,
  type ChatResult,
  type ToolDefinition,
} from '../src'
import { FakeSocket } from './test-utilities'

const TOOLS: ToolDefinition[] = [
  {
    name: 'create_sprite',
    description: 'Add a sprite to the project.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
]

/**
 * Build the `hello` envelope an editor sends on connecting.
 * @param protocolVersion the version to claim
 * @returns the envelope as JSON text
 */
const hello = (protocolVersion = PROTOCOL_VERSION): string =>
  JSON.stringify({ type: 'hello', protocolVersion, tools: TOOLS })

/**
 * Attach a socket to a hub and announce the tool catalogue.
 * @param hub the hub to attach to
 * @returns the attached socket
 */
function attachEditor(hub: EditorHub): FakeSocket {
  const socket = new FakeSocket()
  hub.attach(socket)
  hub.handleMessage(hello())
  return socket
}

describe('EditorHub attachment', () => {
  it('reports the tool catalogue the editor announced', () => {
    const onToolsChanged = vi.fn()
    const hub = new EditorHub({ heartbeatIntervalMs: 0, onToolsChanged })

    attachEditor(hub)

    expect(hub.attached).toBe(true)
    expect(hub.tools).toEqual(TOOLS)
    expect(onToolsChanged).toHaveBeenCalledWith(TOOLS)
  })

  it('keeps serving the catalogue after the editor disconnects', () => {
    const hub = new EditorHub({ heartbeatIntervalMs: 0 })
    attachEditor(hub)

    hub.handleClose()

    expect(hub.attached).toBe(false)
    // An MCP client should still see what Scratch can do while the tab is closed.
    expect(hub.tools).toEqual(TOOLS)
  })

  it('rejects a second editor and keeps the first one attached', () => {
    const hub = new EditorHub({ heartbeatIntervalMs: 0 })
    const first = attachEditor(hub)

    const second = new FakeSocket()
    expect(hub.attach(second)).toBe(false)

    expect(second.closes).toEqual([
      {
        code: CLOSE_CODES.EDITOR_ALREADY_ATTACHED,
        reason: 'Another Scratch editor is already attached to this bridge.',
      },
    ])
    expect(first.closes).toEqual([])
    expect(hub.attached).toBe(true)
  })

  it('closes an editor that speaks a different protocol version', () => {
    const hub = new EditorHub({ heartbeatIntervalMs: 0 })
    const socket = new FakeSocket()
    hub.attach(socket)

    hub.handleMessage(hello(PROTOCOL_VERSION + 1))

    expect(socket.closes[0].code).toBe(CLOSE_CODES.UNSUPPORTED_PROTOCOL)
    expect(hub.tools).toEqual([])
  })

  it('answers a ping from the editor with a pong', () => {
    const hub = new EditorHub({ heartbeatIntervalMs: 0 })
    const socket = attachEditor(hub)

    hub.handleMessage(JSON.stringify({ type: 'ping' }))

    expect(socket.lastSent()).toEqual({ type: 'pong' })
  })

  it('discards malformed and unknown envelopes without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const hub = new EditorHub({ heartbeatIntervalMs: 0 })
    const socket = attachEditor(hub)

    hub.handleMessage('not json at all')
    hub.handleMessage(JSON.stringify({ type: 'nonsense' }))

    expect(warn).toHaveBeenCalledTimes(2)
    expect(socket.sent).toEqual([])
    warn.mockRestore()
  })

  it('forwards editor events to the bridge', () => {
    const onEditorEvent = vi.fn()
    const hub = new EditorHub({ heartbeatIntervalMs: 0, onEditorEvent })
    attachEditor(hub)

    hub.handleMessage(JSON.stringify({ type: 'event', event: 'project-changed', payload: { targets: 3 } }))

    expect(onEditorEvent).toHaveBeenCalledWith('project-changed', { targets: 3 })
  })
})

describe('EditorHub tool invocation', () => {
  it('sends an invoke and resolves with the editor result', async () => {
    const hub = new EditorHub({ heartbeatIntervalMs: 0 })
    const socket = attachEditor(hub)

    const pending = hub.invoke('create_sprite', { name: 'Cat' })

    const invoke = socket.sentOfType('invoke')[0]
    expect(invoke).toMatchObject({ type: 'invoke', name: 'create_sprite', args: { name: 'Cat' } })

    hub.handleMessage(JSON.stringify({ type: 'result', id: invoke.id, ok: true, result: { id: 'sprite-1' } }))

    await expect(pending).resolves.toEqual({ id: 'sprite-1' })
  })

  it('rejects with the message the editor reported', async () => {
    const hub = new EditorHub({ heartbeatIntervalMs: 0 })
    const socket = attachEditor(hub)

    const pending = hub.invoke('create_sprite', {})
    const { id } = socket.sentOfType('invoke')[0]
    hub.handleMessage(JSON.stringify({ type: 'result', id, ok: false, error: 'No costume by that name.' }))

    await expect(pending).rejects.toThrow('No costume by that name.')
  })

  it('keeps concurrent invocations apart by id', async () => {
    const hub = new EditorHub({ heartbeatIntervalMs: 0 })
    const socket = attachEditor(hub)

    const first = hub.invoke('a', {})
    const second = hub.invoke('b', {})
    const ids = socket.sentOfType('invoke').map((envelope) => envelope.id)
    expect(new Set(ids).size).toBe(2)

    // Answer them out of order.
    hub.handleMessage(JSON.stringify({ type: 'result', id: ids[1], ok: true, result: 'second' }))
    hub.handleMessage(JSON.stringify({ type: 'result', id: ids[0], ok: true, result: 'first' }))

    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
  })

  it('rejects when no editor is attached', async () => {
    const hub = new EditorHub({ heartbeatIntervalMs: 0 })
    await expect(hub.invoke('create_sprite', {})).rejects.toThrow(EDITOR_NOT_CONNECTED)
  })

  it('rejects everything still waiting when the editor disconnects', async () => {
    const hub = new EditorHub({ heartbeatIntervalMs: 0 })
    attachEditor(hub)

    const pending = hub.invoke('create_sprite', {})
    hub.handleClose()

    await expect(pending).rejects.toThrow('The Scratch editor disconnected before answering.')
  })
})

describe('EditorHub timeouts and heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('rejects an invocation the editor never answers', async () => {
    const hub = new EditorHub({ heartbeatIntervalMs: 0, invokeTimeoutMs: 30_000 })
    attachEditor(hub)

    const pending = hub.invoke('create_sprite', {})
    const assertion = expect(pending).rejects.toThrow(
      'The Scratch editor did not answer the tool "create_sprite" within 30000ms.',
    )

    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })

  it('ignores a result that arrives after the timeout', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const hub = new EditorHub({ heartbeatIntervalMs: 0, invokeTimeoutMs: 1000 })
    const socket = attachEditor(hub)

    const pending = hub.invoke('create_sprite', {})
    const assertion = expect(pending).rejects.toThrow('within 1000ms')
    await vi.advanceTimersByTimeAsync(1000)
    await assertion

    const { id } = socket.sentOfType('invoke')[0]
    hub.handleMessage(JSON.stringify({ type: 'result', id, ok: true, result: 'late' }))

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('most likely timed out'))
  })

  it('pings the editor and drops the socket after two unanswered beats', () => {
    const hub = new EditorHub({ heartbeatIntervalMs: 1000 })
    const socket = new FakeSocket()
    hub.attach(socket)

    vi.advanceTimersByTime(1000)
    vi.advanceTimersByTime(1000)
    expect(socket.sentOfType('ping')).toHaveLength(2)
    expect(socket.closes).toEqual([])

    vi.advanceTimersByTime(1000)
    expect(socket.closes).toEqual([
      { code: CLOSE_CODES.HEARTBEAT_TIMEOUT, reason: 'The editor stopped answering heartbeats.' },
    ])
  })

  it('keeps the socket while the editor answers its pings', () => {
    const hub = new EditorHub({ heartbeatIntervalMs: 1000 })
    const socket = new FakeSocket()
    hub.attach(socket)

    for (let beat = 0; beat < 6; beat++) {
      vi.advanceTimersByTime(1000)
      hub.handleMessage(JSON.stringify({ type: 'pong' }))
    }

    expect(socket.sentOfType('ping')).toHaveLength(6)
    expect(socket.closes).toEqual([])
  })
})

describe('EditorHub chat proxying', () => {
  it('streams deltas and a result back to the editor', () => {
    const captured: { request: ChatRequestEnvelope; responder: ChatResponder }[] = []
    const hub = new EditorHub({
      heartbeatIntervalMs: 0,
      onChatRequest: (request, responder) => {
        captured.push({ request, responder })
      },
    })
    const socket = attachEditor(hub)

    hub.handleMessage(
      JSON.stringify({
        type: 'chat',
        id: '7',
        provider: 'deepseek',
        model: 'deepseek-reasoner',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    )

    const chat = captured[0]
    expect(chat.request.id).toBe('7')
    expect(chat.request.provider).toBe('deepseek')
    expect(chat.request.model).toBe('deepseek-reasoner')

    chat.responder.delta({ reasoning: 'thinking' })
    chat.responder.done({ content: 'hello', reasoning: 'thinking', toolCalls: [], finishReason: 'stop' })

    expect(socket.sentOfType('chat-delta')).toEqual([
      { type: 'chat-delta', id: '7', delta: { reasoning: 'thinking' } },
    ])
    expect(socket.sentOfType('chat-done')).toEqual([
      {
        type: 'chat-done',
        id: '7',
        ok: true,
        result: { content: 'hello', reasoning: 'thinking', toolCalls: [], finishReason: 'stop' },
      },
    ])
  })

  it('reads the request out of the fields the editor writes', () => {
    const captured: ChatRequestEnvelope[] = []
    const hub = new EditorHub({
      heartbeatIntervalMs: 0,
      onChatRequest: (request) => {
        captured.push(request)
      },
    })
    attachEditor(hub)

    // Exactly the envelope the editor's BridgeClient puts on the wire.
    hub.handleMessage(
      JSON.stringify({
        type: 'chat',
        id: '3',
        provider: 'deepseek',
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'add a cat' }],
        tools: [{ type: 'function', function: { name: 'create_sprite' } }],
      }),
    )

    expect(captured[0]).toMatchObject({
      id: '3',
      provider: 'deepseek',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'add a cat' }],
    })
    expect(captured[0].tools).toHaveLength(1)
  })

  it('round-trips a chat result, tool calls and their raw arguments included', () => {
    const responders: ChatResponder[] = []
    const hub = new EditorHub({
      heartbeatIntervalMs: 0,
      onChatRequest: (_request, responder) => {
        responders.push(responder)
      },
    })
    const socket = attachEditor(hub)

    hub.handleMessage(JSON.stringify({ type: 'chat', id: '9', provider: 'ollama', model: 'llama3', messages: [] }))

    const result: ChatResult = {
      content: '',
      reasoning: '',
      finishReason: 'tool_calls',
      toolCalls: [{ id: 'call_a', name: 'create_sprite', args: { name: 'Cat' }, rawArguments: '{"name":"Cat"}' }],
    }
    responders[0].done(result)

    expect(socket.sentOfType('chat-done')).toEqual([{ type: 'chat-done', id: '9', ok: true, result }])
  })

  it('passes a cancellation on so the provider request can be stopped', () => {
    const onChatCancel = vi.fn()
    const hub = new EditorHub({ heartbeatIntervalMs: 0, onChatCancel })
    attachEditor(hub)

    hub.handleMessage(JSON.stringify({ type: 'chat-cancel', id: '7' }))

    expect(onChatCancel).toHaveBeenCalledWith('7')
  })

  it('reports a chat failure to the editor', () => {
    const hub = new EditorHub({
      heartbeatIntervalMs: 0,
      onChatRequest: (_request, responder) => responder.fail('No API key configured for deepseek.'),
    })
    const socket = attachEditor(hub)

    hub.handleMessage(JSON.stringify({ type: 'chat', id: '1', provider: 'deepseek', model: 'x', messages: [] }))

    expect(socket.sentOfType('chat-done')).toEqual([
      { type: 'chat-done', id: '1', ok: false, error: 'No API key configured for deepseek.' },
    ])
  })

  it('tells the editor when the bridge proxies no chat at all', () => {
    const hub = new EditorHub({ heartbeatIntervalMs: 0 })
    const socket = attachEditor(hub)

    hub.handleMessage(JSON.stringify({ type: 'chat', id: '1', provider: 'deepseek', model: 'x', messages: [] }))

    expect(socket.lastSent()).toMatchObject({ type: 'chat-done', ok: false })
  })
})
