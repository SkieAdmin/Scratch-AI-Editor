import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type ChatCompletionChunk,
  ChatStreamAccumulator,
  parseToolCallArguments,
  readSseData,
} from '../src/providers/sse'
import { collect, streamOf } from './test-utilities'

/**
 * Build one `data:` event.
 * @param payload the JSON text to carry
 * @returns the event, terminated by a blank line
 */
const event = (payload: string): string => `data: ${payload}\n\n`

/**
 * Build one streaming chunk carrying a delta.
 * @param delta the delta object
 * @returns the event text
 */
const deltaEvent = (delta: unknown): string => event(JSON.stringify({ choices: [{ delta }] }))

describe('readSseData', () => {
  it('yields the payload of each event', async () => {
    const stream = streamOf([event('{"a":1}'), event('{"a":2}'), 'data: [DONE]\n\n'])
    await expect(collect(readSseData(stream))).resolves.toEqual(['{"a":1}', '{"a":2}'])
  })

  it('reassembles events split across chunk boundaries', async () => {
    // The split falls inside the JSON payload and inside the terminator.
    const stream = streamOf(['data: {"a"', ':1}\n', '\ndata: {"b":2}\n\n'])
    await expect(collect(readSseData(stream))).resolves.toEqual(['{"a":1}', '{"b":2}'])
  })

  it('stops at the [DONE] sentinel and ignores anything after it', async () => {
    const stream = streamOf([event('{"a":1}'), 'data: [DONE]\n\n', event('{"a":2}')])
    await expect(collect(readSseData(stream))).resolves.toEqual(['{"a":1}'])
  })

  it('skips comments and non-data fields, and tolerates CRLF', async () => {
    const stream = streamOf([': keep-alive\r\n', 'event: message\r\n', 'data: {"a":1}\r\n', '\r\n'])
    await expect(collect(readSseData(stream))).resolves.toEqual(['{"a":1}'])
  })

  it('joins the data lines of a multi-line event', async () => {
    const stream = streamOf(['data: line one\ndata: line two\n\n'])
    await expect(collect(readSseData(stream))).resolves.toEqual(['line one\nline two'])
  })

  it('yields a final event that has no trailing blank line', async () => {
    const stream = streamOf(['data: {"a":1}'])
    await expect(collect(readSseData(stream))).resolves.toEqual(['{"a":1}'])
  })

  it('reassembles a multi-byte character split across chunks', async () => {
    // The two bytes of "é" land in different chunks.
    const encoded = new TextEncoder().encode('data: {"c":"é"}\n\n')
    // eslint-disable-next-line @typescript-eslint/require-await -- an async generator is what the reader consumes
    const split = (async function* () {
      yield encoded.slice(0, 13)
      yield encoded.slice(13)
    })()
    await expect(collect(readSseData(split))).resolves.toEqual(['{"c":"é"}'])
  })
})

describe('ChatStreamAccumulator', () => {
  it('concatenates content fragments and reports each one', () => {
    const accumulator = new ChatStreamAccumulator()

    expect(accumulator.add({ choices: [{ delta: { content: 'Hello' } }] })).toEqual({ content: 'Hello' })
    expect(accumulator.add({ choices: [{ delta: { content: ', world' } }] })).toEqual({ content: ', world' })
    accumulator.add({ choices: [{ delta: {}, finish_reason: 'stop' }] })

    expect(accumulator.result()).toEqual({
      content: 'Hello, world',
      reasoning: '',
      toolCalls: [],
      finishReason: 'stop',
    })
  })

  it('keeps DeepSeek reasoning_content apart from content', () => {
    const accumulator = new ChatStreamAccumulator()

    expect(accumulator.add({ choices: [{ delta: { reasoning_content: 'Let me ' } }] })).toEqual({
      reasoning: 'Let me ',
    })
    accumulator.add({ choices: [{ delta: { reasoning_content: 'think.' } }] })
    accumulator.add({ choices: [{ delta: { content: 'The answer is 4.' } }] })

    const result = accumulator.result()
    expect(result.reasoning).toBe('Let me think.')
    expect(result.content).toBe('The answer is 4.')
  })

  it("reads OpenRouter's reasoning field as reasoning too", () => {
    const accumulator = new ChatStreamAccumulator()
    accumulator.add({ choices: [{ delta: { reasoning: 'Hmm.' } }] })
    expect(accumulator.result().reasoning).toBe('Hmm.')
  })

  it('assembles one tool call from its fragments', () => {
    const accumulator = new ChatStreamAccumulator()

    accumulator.add({
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'create_sprite' } }] } }],
    })
    accumulator.add({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"name":' } }] } }] })
    accumulator.add({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Cat"}' } }] } }] })

    expect(accumulator.result().toolCalls).toEqual([
      { id: 'call_a', name: 'create_sprite', args: { name: 'Cat' }, rawArguments: '{"name":"Cat"}' },
    ])
  })

  it('routes interleaved fragments to the call named by their index', () => {
    const accumulator = new ChatStreamAccumulator()

    accumulator.add({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'call_a', function: { name: 'move', arguments: '{"steps"' } },
              { index: 1, id: 'call_b', function: { name: 'say', arguments: '{"text"' } },
            ],
          },
        },
      ],
    })
    // Fragments now arrive out of index order, one per chunk.
    accumulator.add({ choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: ':"hi"}' } }] } }] })
    accumulator.add({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':10}' } }] } }] })

    expect(accumulator.result().toolCalls).toEqual([
      { id: 'call_a', name: 'move', args: { steps: 10 }, rawArguments: '{"steps":10}' },
      { id: 'call_b', name: 'say', args: { text: 'hi' }, rawArguments: '{"text":"hi"}' },
    ])
  })

  it('assembles a tool name that itself arrives in fragments', () => {
    const accumulator = new ChatStreamAccumulator()

    accumulator.add({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'create_' } }] } }] })
    accumulator.add({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'sprite' } }] } }] })

    expect(accumulator.result().toolCalls[0].name).toBe('create_sprite')
  })

  it('treats a fragment with no index as belonging to the first call', () => {
    const accumulator = new ChatStreamAccumulator()

    accumulator.add({ choices: [{ delta: { tool_calls: [{ id: 'call_a', function: { name: 'stop' } }] } }] })
    accumulator.add({ choices: [{ delta: { tool_calls: [{ function: { arguments: '{}' } }] } }] })

    expect(accumulator.result().toolCalls).toEqual([{ id: 'call_a', name: 'stop', args: {}, rawArguments: '{}' }])
  })

  it('keeps the argument text the model produced, even when it is not JSON', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const accumulator = new ChatStreamAccumulator()

    accumulator.add({
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'say', arguments: 'not json' } }] } }],
    })

    // The editor has to echo this text back verbatim in its next request, so it
    // survives alongside the parsed arguments rather than being re-serialised.
    expect(accumulator.result().toolCalls[0]).toEqual({
      id: 'c',
      name: 'say',
      args: 'not json',
      rawArguments: 'not json',
    })
    warn.mockRestore()
  })

  it('gives a call that never carried an id one derived from its index', () => {
    const accumulator = new ChatStreamAccumulator()
    accumulator.add({ choices: [{ delta: { tool_calls: [{ index: 2, function: { name: 'stop' } }] } }] })
    expect(accumulator.result().toolCalls[0].id).toBe('call_2')
  })

  it('reports nothing for a chunk that carried no fragment', () => {
    const accumulator = new ChatStreamAccumulator()
    expect(accumulator.add({ choices: [{ delta: {}, finish_reason: 'stop' }] })).toBeNull()
    expect(accumulator.add({ choices: [] })).toBeNull()
    expect(accumulator.result().finishReason).toBe('stop')
  })

  it('folds a whole stream read through readSseData', async () => {
    const accumulator = new ChatStreamAccumulator()
    const stream = streamOf([
      deltaEvent({ reasoning_content: 'Counting.' }),
      deltaEvent({ content: 'Two' }),
      deltaEvent({ content: ' sprites.' }),
      'data: [DONE]\n\n',
    ])

    const fragments = []
    for await (const data of readSseData(stream)) {
      const fragment = accumulator.add(JSON.parse(data) as ChatCompletionChunk)
      if (fragment) fragments.push(fragment)
    }

    expect(fragments).toEqual([{ reasoning: 'Counting.' }, { content: 'Two' }, { content: ' sprites.' }])
    expect(accumulator.result().content).toBe('Two sprites.')
  })
})

describe('parseToolCallArguments', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses assembled JSON arguments', () => {
    expect(parseToolCallArguments('move', '{"steps":10}')).toEqual({ steps: 10 })
  })

  it('treats an empty argument string as no arguments', () => {
    expect(parseToolCallArguments('stop', '')).toEqual({})
  })

  it('names the tool and passes the text through when the model emits invalid JSON', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(parseToolCallArguments('move', '{"steps":')).toBe('{"steps":')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('move'))
  })
})
