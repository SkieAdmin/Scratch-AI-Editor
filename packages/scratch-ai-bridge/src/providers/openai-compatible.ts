import type { ChatDelta, ChatMessage, ChatResult, ChatTool, ModelInfo } from '../types'
import { ChatStreamAccumulator, readSseData, type ChatCompletionChunk } from './sse'

/**
 * Everything the shared client needs to talk to one provider. The four supported
 * providers differ only in URLs, headers and how they list models, so each one
 * supplies those and reuses the streaming code below.
 */
export interface ProviderAdapter {
  /** Identifier shared with the editor, e.g. `deepseek`. */
  readonly id: string
  /** Absolute URL of the OpenAI-compatible chat-completions endpoint. */
  readonly chatUrl: string
  /** Absolute URL of the model-listing endpoint. */
  readonly modelsUrl: string
  /** Headers added to every request, including authorization. */
  readonly headers: Readonly<Record<string, string>>
  /**
   * Turn the provider's model-listing payload into the editor's shape.
   * @param payload the decoded JSON body
   */
  parseModels(payload: unknown): ModelInfo[]
}

/** A chat completion to run against a provider. */
export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  tools?: ChatTool[]
  temperature?: number
  maxTokens?: number
}

/**
 * Join a configured base URL to an endpoint path without doubling the slash.
 * @param baseUrl the provider's base URL, with or without a trailing slash
 * @param path the endpoint path, with a leading slash
 * @returns the joined URL
 */
export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

/**
 * Run a streaming chat completion and report each fragment as it arrives.
 * @param adapter the provider to call
 * @param request the completion to run
 * @param onDelta called with every fragment the model streams
 * @param signal aborts the request when the editor cancels
 * @returns the assembled reply
 */
export async function streamChat(
  adapter: ProviderAdapter,
  request: ChatRequest,
  onDelta: (delta: ChatDelta) => void,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    stream: true,
  }
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools
    body.tool_choice = 'auto'
  }
  if (request.temperature !== undefined) body.temperature = request.temperature
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens

  const response = await fetch(adapter.chatUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...adapter.headers },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    throw new Error(`${adapter.id} rejected the chat request (HTTP ${response.status}): ${await response.text()}`)
  }
  if (!response.body) {
    throw new Error(`${adapter.id} answered the chat request with no body to stream.`)
  }

  const accumulator = new ChatStreamAccumulator()
  const chunks = response.body as unknown as AsyncIterable<Uint8Array>

  for await (const data of readSseData(chunks)) {
    const chunk = parseChunk(adapter.id, data)
    if (!chunk) continue
    if (chunk.error) {
      throw new Error(`${adapter.id} reported an error mid-stream: ${chunk.error.message ?? 'no message given'}`)
    }
    const delta = accumulator.add(chunk)
    if (delta) onDelta(delta)
  }

  return accumulator.result()
}

/**
 * List the models a provider offers.
 * @param adapter the provider to ask
 * @returns the models, in the order the provider returned them
 */
export async function listModels(adapter: ProviderAdapter): Promise<ModelInfo[]> {
  const response = await fetch(adapter.modelsUrl, { headers: adapter.headers })

  if (!response.ok) {
    throw new Error(`${adapter.id} rejected the model listing (HTTP ${response.status}): ${await response.text()}`)
  }

  return adapter.parseModels(await response.json())
}

/**
 * Decode one `data:` payload.
 * @param providerId the provider that sent it, for the warning
 * @param data the payload text
 * @returns the chunk, or null when the payload was not JSON
 */
function parseChunk(providerId: string, data: string): ChatCompletionChunk | null {
  try {
    return JSON.parse(data) as ChatCompletionChunk
  } catch {
    console.warn(`scratch-ai-bridge: discarding a non-JSON stream payload from ${providerId}: ${data.slice(0, 120)}`)
    return null
  }
}

/** The `{data: [{id}]}` body that OpenAI-compatible `/models` endpoints return. */
interface OpenAiModelList {
  data?: { id?: unknown }[]
}

/**
 * Parse an OpenAI-compatible model listing.
 * @param providerId the provider that produced it, for the error message
 * @param payload the decoded JSON body
 * @returns the models it named
 */
export function parseOpenAiModels(providerId: string, payload: unknown): ModelInfo[] {
  const list = payload as OpenAiModelList
  if (!Array.isArray(list.data)) {
    throw new Error(`${providerId} returned a model listing without a "data" array.`)
  }
  return list.data
    .filter((entry): entry is { id: string } => typeof entry.id === 'string')
    .map((entry) => ({ id: entry.id, label: entry.id }))
}
