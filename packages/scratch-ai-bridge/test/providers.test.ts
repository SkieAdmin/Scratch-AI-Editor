import { describe, expect, it } from 'vitest'
import { createProvider, isProviderId, joinUrl, parseOpenAiModels, type ProviderContext } from '../src'

/**
 * Build a provider context with the given keys and base URLs.
 * @param overrides settings to apply on top of the empty defaults
 * @returns a context the provider factory accepts
 */
function contextWith(overrides: Partial<ProviderContext['settings']> = {}): ProviderContext {
  return {
    settings: {
      deepseek: {},
      openrouter: {},
      lmstudio: {},
      ollama: {},
      ...overrides,
    },
    openRouterReferer: 'https://scratch.mit.edu/',
    openRouterTitle: 'Scratch Editor',
  }
}

describe('joinUrl', () => {
  it('joins without doubling the slash', () => {
    expect(joinUrl('https://api.deepseek.com', '/chat/completions')).toBe('https://api.deepseek.com/chat/completions')
    expect(joinUrl('https://api.deepseek.com/', '/chat/completions')).toBe(
      'https://api.deepseek.com/chat/completions',
    )
  })
})

describe('createProvider', () => {
  it('refuses an unknown provider by name', () => {
    expect(() => createProvider('gpt', contextWith())).toThrow('Unknown AI provider "gpt"')
  })

  it('names the environment variable that would supply a missing key', () => {
    expect(() => createProvider('deepseek', contextWith())).toThrow('DEEPSEEK_API_KEY')
    expect(() => createProvider('openrouter', contextWith())).toThrow('OPENROUTER_API_KEY')
  })

  it('authorizes DeepSeek with the configured key', () => {
    const adapter = createProvider('deepseek', contextWith({ deepseek: { apiKey: 'sk-test' } }))

    expect(adapter.chatUrl).toBe('https://api.deepseek.com/chat/completions')
    expect(adapter.headers).toEqual({ Authorization: 'Bearer sk-test' })
  })

  it('identifies the editor to OpenRouter', () => {
    const adapter = createProvider('openrouter', contextWith({ openrouter: { apiKey: 'sk-or' } }))

    expect(adapter.chatUrl).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(adapter.modelsUrl).toBe('https://openrouter.ai/api/v1/models')
    expect(adapter.headers).toMatchObject({ 'HTTP-Referer': 'https://scratch.mit.edu/', 'X-Title': 'Scratch Editor' })
  })

  it('needs no key for the local providers', () => {
    expect(createProvider('lmstudio', contextWith()).chatUrl).toBe('http://127.0.0.1:1234/v1/chat/completions')
    expect(createProvider('ollama', contextWith()).headers).toEqual({})
  })

  it('chats to Ollama over its OpenAI-compatible path but lists models natively', () => {
    const adapter = createProvider('ollama', contextWith())

    expect(adapter.chatUrl).toBe('http://127.0.0.1:11434/v1/chat/completions')
    expect(adapter.modelsUrl).toBe('http://127.0.0.1:11434/api/tags')
  })

  it('honours a configured base URL', () => {
    const adapter = createProvider('lmstudio', contextWith({ lmstudio: { baseUrl: 'http://192.168.1.9:1234/v1' } }))
    expect(adapter.chatUrl).toBe('http://192.168.1.9:1234/v1/chat/completions')
  })
})

describe('model listing', () => {
  it('reads an OpenAI-compatible listing', () => {
    expect(parseOpenAiModels('lmstudio', { data: [{ id: 'qwen3-8b' }, { id: 'llama-3.1-8b' }] })).toEqual([
      { id: 'qwen3-8b', label: 'qwen3-8b' },
      { id: 'llama-3.1-8b', label: 'llama-3.1-8b' },
    ])
  })

  it('complains when the listing has no data array', () => {
    expect(() => parseOpenAiModels('lmstudio', { models: [] })).toThrow('lmstudio')
  })

  it("reads Ollama's native tag listing", () => {
    const adapter = createProvider('ollama', contextWith())
    const models = adapter.parseModels({ models: [{ name: 'llama3:8b', model: 'llama3:8b' }, { name: 'qwen3' }] })

    expect(models).toEqual([
      { id: 'llama3:8b', label: 'llama3:8b' },
      { id: 'qwen3', label: 'qwen3' },
    ])
  })
})

describe('isProviderId', () => {
  it('recognises exactly the four supported providers', () => {
    expect(['deepseek', 'openrouter', 'lmstudio', 'ollama'].every(isProviderId)).toBe(true)
    expect(isProviderId('anthropic')).toBe(false)
  })
})
