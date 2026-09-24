/**
 * Wire types shared by the three halves of the bridge: the tool catalogue the
 * editor announces, the envelopes exchanged over the editor WebSocket, and the
 * chat shapes handed to the provider proxies.
 */

/** JSON Schema object describing a tool's arguments. */
export interface ToolInputSchema {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
}

/** One tool the editor is able to run against the VM. */
export interface ToolDefinition {
  name: string
  description: string
  inputSchema: ToolInputSchema
}

/** A tool call as it appears on the OpenAI chat-completions wire. */
export interface WireToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/** A chat message in OpenAI chat-completions form. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  name?: string
  tool_call_id?: string
  tool_calls?: WireToolCall[]
}

/** A tool offered to the model, in OpenAI function-calling form. */
export interface ChatTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: ToolInputSchema
  }
}

/** A finished tool call, with its arguments parsed when they are valid JSON. */
export interface ParsedToolCall {
  id: string
  name: string
  args: unknown
  /**
   * The argument text exactly as the model produced it. The editor sends this
   * back when it reports the tool's result, and a re-serialized copy would not
   * always match what the model believes it asked for.
   */
  rawArguments: string
}

/** One fragment of a tool call as it arrives mid-stream. */
export interface ToolCallDelta {
  index: number
  id?: string
  name?: string
  argumentsFragment?: string
}

/** One streamed fragment of an assistant reply. */
export interface ChatDelta {
  content?: string
  /** Chain-of-thought summary, kept apart from `content` so the UI can style it differently. */
  reasoning?: string
  toolCalls?: ToolCallDelta[]
}

/** A completed assistant reply. */
export interface ChatResult {
  content: string
  reasoning: string
  toolCalls: ParsedToolCall[]
  finishReason: string | null
}

/** A model the editor may offer in its model picker. */
export interface ModelInfo {
  id: string
  label: string
}
