import type { EditorSocket } from '../src/hub/editor-hub'

/** A close the hub asked for. */
export interface RecordedClose {
  code?: number
  reason?: string
}

/** An in-memory stand-in for a WebSocket, so hub tests need no server. */
export class FakeSocket implements EditorSocket {
  readonly sent: Record<string, unknown>[] = []
  readonly closes: RecordedClose[] = []

  /**
   * Record an outgoing envelope.
   * @param data the JSON text the hub sent
   */
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }

  /**
   * Record a close request.
   * @param code the WebSocket status the hub asked to close with
   * @param reason the text the hub gave for closing
   */
  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason })
  }

  /**
   * Every envelope of one type the hub sent.
   * @param type the envelope type to filter for
   * @returns the matching envelopes, oldest first
   */
  sentOfType(type: string): Record<string, unknown>[] {
    return this.sent.filter((envelope) => envelope.type === type)
  }

  /**
   * The most recent envelope the hub sent.
   * @returns the last envelope
   */
  lastSent(): Record<string, unknown> {
    const last = this.sent.at(-1)
    if (!last) throw new Error('FakeSocket.lastSent: the hub has not sent anything')
    return last
  }
}

/**
 * Turn strings into the async iterable of byte chunks that the SSE reader takes,
 * so a test can choose exactly where the chunk boundaries fall.
 * @param chunks the pieces of the stream, in order
 * @yields {Uint8Array} each piece, encoded as UTF-8
 */
// eslint-disable-next-line @typescript-eslint/require-await -- an async generator is what the reader consumes
export async function* streamOf(chunks: string[]): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder()
  for (const chunk of chunks) {
    yield encoder.encode(chunk)
  }
}

/**
 * Collect everything an async iterable yields.
 * @param source the iterable to drain
 * @returns its values, in order
 */
export async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) {
    values.push(value)
  }
  return values
}
