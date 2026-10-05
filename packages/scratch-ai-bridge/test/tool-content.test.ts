import { describe, expect, it } from 'vitest'
import { isToolContent } from '../src'

describe('isToolContent', () => {
  it('recognises a picture with its caption, which is how the editor returns a capture', () => {
    expect(
      isToolContent({
        content: [
          { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
          { type: 'text', text: '{"width":480}' },
        ],
      }),
    ).toBe(true)
  })

  it('leaves every other result to be sent as JSON text', () => {
    expect(isToolContent({ id: 'sprite-id', name: 'Cat' })).toBe(false)
    expect(isToolContent({ content: 'a field that happens to share the name' })).toBe(false)
    expect(isToolContent({ content: [] })).toBe(false)
    expect(isToolContent({ content: [{ type: 'image', data: 'iVBORw0KGgo=' }] })).toBe(false)
    expect(isToolContent({ content: [{ type: 'audio', data: 'UklGRg==', mimeType: 'audio/wav' }] })).toBe(false)
    expect(isToolContent([{ type: 'text', text: 'an array is not a result object' }])).toBe(false)
    expect(isToolContent(null)).toBe(false)
  })
})
