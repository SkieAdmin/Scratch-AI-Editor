import { afterEach, expect, it, vi } from 'vitest'
import { startBridge } from '../src'
import { FakeSocket } from './test-utilities'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('identifies the independent fork when requesting OpenRouter models', async () => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [] }))
  vi.stubGlobal('fetch', fetchMock)
  const bridge = await startBridge({ port: 0 })
  try {
    const socket = new FakeSocket()
    bridge.hub.attach(socket)
    bridge.hub.handleMessage(JSON.stringify({ type: 'models', id: '1', provider: 'openrouter' }))
    await vi.waitFor(() => {
      expect(socket.sentOfType('models-done')).toHaveLength(1)
      expect(fetchMock).toHaveBeenCalledWith('https://openrouter.ai/api/v1/models', {
        headers: {
          Authorization: 'Bearer test-key',
          'HTTP-Referer': 'https://github.com/SkieAdmin',
          'X-Title': 'Skie AI Editor',
        },
      })
    })
  } finally {
    await bridge.close()
  }
})
