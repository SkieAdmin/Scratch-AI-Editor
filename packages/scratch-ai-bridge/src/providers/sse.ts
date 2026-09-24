import type { ChatDelta, ChatResult, ToolCallDelta } from '../types'

/** Sentinel payload every OpenAI-compatible provider sends to end a stream. */
const SSE_DONE = '[DONE]'

/**
 * Split a byte stream into lines. Network chunks do not respect line boundaries,
 * so a partial line is held back until a later chunk completes it.
 * @param chunks the raw response body
 * @yields {string} each complete line, without its terminator
 */
async function* readLines(chunks: AsyncIterable<Uint8Array | string>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ''

  for await (const chunk of chunks) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })

    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      yield buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
  }

  if (buffer !== '') {
    yield buffer.replace(/\r$/, '')
  }
}

/**
 * Read the payload of each Server-Sent Event from a response body. Fields other
 * than `data` carry nothing the chat protocol uses, so they are skipped, as are
 * `:` keep-alive comments.
 * @param chunks the raw response body
 * @yields {string} the payload of each event, stopping at the `[DONE]` sentinel
 */
export async function* readSseData(chunks: AsyncIterable<Uint8Array | string>): AsyncGenerator<string> {
  let dataLines: string[] = []

  for await (const line of readLines(chunks)) {
    if (line === '') {
      if (dataLines.length === 0) continue
      const data = dataLines.join('\n')
      dataLines = []
      if (data === SSE_DONE) return
      yield data
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''))
    }
  }

  // A stream that ends without a trailing blank line still holds one whole event.
  if (dataLines.length > 0) {
    const data = dataLines.join('\n')
    if (data !== SSE_DONE) yield data
  }
}

/** One tool-call fragment as it appears inside a streamed delta. */
interface ChunkToolCall {
  index?: number
  id?: string
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
}

/** The delta field of a streamed chat-completion chunk. */
interface ChunkDelta {
  content?: string | null
  /** DeepSeek's reasoner reports its chain of thought here. */
  reasoning_content?: string | null
  /** OpenRouter reports the same thing under this name. */
  reasoning?: string | null
  tool_calls?: ChunkToolCall[]
}

/** One `data:` payload of an OpenAI-compatible streaming chat completion. */
export interface ChatCompletionChunk {
  choices?: {
    delta?: ChunkDelta
    finish_reason?: string | null
  }[]
  error?: {
    message?: string
  }
}

/** A tool call being assembled from fragments. */
interface PartialToolCall {
  id: string
  name: string
  argumentsText: string
}

/**
 * Folds streamed chat-completion chunks into one assistant reply.
 *
 * Tool calls arrive as indexed fragments spread over many chunks: the `index`
 * field, not the position within a chunk, says which call a fragment belongs to,
 * and a single call's `function.arguments` is a JSON string delivered a few
 * characters at a time.
 */
export class ChatStreamAccumulator {
  private contentText = ''
  private reasoningText = ''
  private finish: string | null = null
  private readonly calls = new Map<number, PartialToolCall>()

  /**
   * Fold one chunk in.
   * @param chunk a parsed `data:` payload
   * @returns the fragment this chunk contributed, or null when it carried none
   */
  add(chunk: ChatCompletionChunk): ChatDelta | null {
    const choice = chunk.choices?.[0]
    if (!choice) return null

    if (choice.finish_reason) {
      this.finish = choice.finish_reason
    }

    const delta = choice.delta
    if (!delta) return null

    const fragment: ChatDelta = {}

    if (delta.content) {
      this.contentText += delta.content
      fragment.content = delta.content
    }

    const reasoning = delta.reasoning_content ?? delta.reasoning
    if (reasoning) {
      this.reasoningText += reasoning
      fragment.reasoning = reasoning
    }

    if (delta.tool_calls && delta.tool_calls.length > 0) {
      fragment.toolCalls = delta.tool_calls.map((toolCall) => this.addToolCallFragment(toolCall))
    }

    return Object.keys(fragment).length > 0 ? fragment : null
  }

  /**
   * The assembled reply.
   * @returns content, reasoning and every tool call, in call-index order
   */
  result(): ChatResult {
    const toolCalls = [...this.calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, call]) => ({
        id: call.id === '' ? `call_${index}` : call.id,
        name: call.name,
        args: parseToolCallArguments(call.name, call.argumentsText),
        rawArguments: call.argumentsText,
      }))

    return {
      content: this.contentText,
      reasoning: this.reasoningText,
      toolCalls,
      finishReason: this.finish,
    }
  }

  /**
   * Merge one tool-call fragment into the call it belongs to.
   * @param toolCall the fragment as the provider sent it
   * @returns the merged call in the editor's shape
   */
  private addToolCallFragment(toolCall: ChunkToolCall): ToolCallDelta {
    // Providers omit `index` when the model may only call one tool at a time.
    const index = toolCall.index ?? 0

    let call = this.calls.get(index)
    if (!call) {
      call = { id: '', name: '', argumentsText: '' }
      this.calls.set(index, call)
    }

    if (toolCall.id) call.id = toolCall.id
    if (toolCall.function?.name) call.name += toolCall.function.name
    if (toolCall.function?.arguments) call.argumentsText += toolCall.function.arguments

    return {
      index,
      id: toolCall.id,
      name: toolCall.function?.name,
      argumentsFragment: toolCall.function?.arguments,
    }
  }
}

/**
 * Parse the JSON string a model assembled for a tool call. Models do emit text
 * that is not valid JSON, so name the offending tool and pass the raw text
 * through rather than losing the call.
 * @param name the tool the arguments belong to
 * @param argumentsText the assembled argument string
 * @returns the parsed arguments, or the raw text when it does not parse
 */
export function parseToolCallArguments(name: string, argumentsText: string): unknown {
  if (argumentsText === '') return {}
  try {
    return JSON.parse(argumentsText)
  } catch {
    console.warn(
      `scratch-ai-bridge: tool "${name}" produced arguments that are not valid JSON; passing them through as text`,
    )
    return argumentsText
  }
}
