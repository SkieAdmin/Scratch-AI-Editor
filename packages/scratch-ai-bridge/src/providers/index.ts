import type { ModelInfo } from '../types'
import { joinUrl, parseOpenAiModels, type ProviderAdapter } from './openai-compatible'

/** Identifiers shared with the editor's `lib/ai/constants.js`. */
export const PROVIDER_IDS = {
  DEEPSEEK: 'deepseek',
  OPENROUTER: 'openrouter',
  LM_STUDIO: 'lmstudio',
  OLLAMA: 'ollama',
} as const

export type ProviderId = (typeof PROVIDER_IDS)[keyof typeof PROVIDER_IDS]

/** Providers reachable over the public internet, which therefore need an API key. */
export const REMOTE_PROVIDER_IDS: ProviderId[] = [PROVIDER_IDS.DEEPSEEK, PROVIDER_IDS.OPENROUTER]

/** Base URLs used when the operator has not overridden them. */
export const DEFAULT_BASE_URLS: Record<ProviderId, string> = {
  [PROVIDER_IDS.DEEPSEEK]: 'https://api.deepseek.com',
  [PROVIDER_IDS.OPENROUTER]: 'https://openrouter.ai/api/v1',
  [PROVIDER_IDS.LM_STUDIO]: 'http://127.0.0.1:1234/v1',
  [PROVIDER_IDS.OLLAMA]: 'http://127.0.0.1:11434',
}

/** Environment variable holding each remote provider's API key. */
export const API_KEY_ENV_VARS: Partial<Record<ProviderId, string>> = {
  [PROVIDER_IDS.DEEPSEEK]: 'DEEPSEEK_API_KEY',
  [PROVIDER_IDS.OPENROUTER]: 'OPENROUTER_API_KEY',
}

/** Per-provider configuration resolved from the environment and the config file. */
export interface ProviderSettings {
  apiKey?: string
  baseUrl?: string
}

/** Configuration for every provider the bridge can proxy. */
export type ProviderSettingsMap = Record<ProviderId, ProviderSettings>

/** Options that apply across providers. */
export interface ProviderContext {
  settings: ProviderSettingsMap
  /** Sent to OpenRouter as `HTTP-Referer` so usage is attributed to the editor. */
  openRouterReferer: string
  /** Sent to OpenRouter as `X-Title`. */
  openRouterTitle: string
}

/**
 * True when the identifier names a provider this bridge can proxy.
 * @param id the identifier to check
 * @returns whether it is a known provider
 */
export function isProviderId(id: string): id is ProviderId {
  return Object.values(PROVIDER_IDS).includes(id as ProviderId)
}

/**
 * Build the adapter for one provider.
 *
 * The API key never leaves this process, so a missing key is an operator
 * configuration error rather than something the editor can fix: fail loudly and
 * name the environment variable that would fix it.
 * @param id the provider to build
 * @param context resolved settings for every provider
 * @returns the adapter
 */
export function createProvider(id: string, context: ProviderContext): ProviderAdapter {
  if (!isProviderId(id)) {
    throw new Error(`Unknown AI provider "${id}". Known providers: ${Object.values(PROVIDER_IDS).join(', ')}.`)
  }

  const settings = context.settings[id]
  const baseUrl = settings.baseUrl ?? DEFAULT_BASE_URLS[id]

  switch (id) {
    case PROVIDER_IDS.DEEPSEEK:
      return createDeepSeek(baseUrl, requireApiKey(id, settings))
    case PROVIDER_IDS.OPENROUTER:
      return createOpenRouter(baseUrl, requireApiKey(id, settings), context)
    case PROVIDER_IDS.LM_STUDIO:
      return createLmStudio(baseUrl)
    case PROVIDER_IDS.OLLAMA:
      return createOllama(baseUrl)
  }
}

/**
 * Read the API key for a remote provider.
 * @param id the provider needing the key
 * @param settings that provider's resolved settings
 * @returns the configured key
 */
function requireApiKey(id: ProviderId, settings: ProviderSettings): string {
  if (!settings.apiKey) {
    throw new Error(
      `No API key configured for ${id}. Set ${API_KEY_ENV_VARS[id]} in the bridge's environment, ` +
        `or add providers.${id}.apiKey to the bridge config file.`,
    )
  }
  return settings.apiKey
}

/**
 * DeepSeek is OpenAI-compatible. Its `deepseek-reasoner` model streams its chain
 * of thought in a `reasoning_content` field, which the shared accumulator keeps
 * apart from `content`.
 * @param baseUrl where DeepSeek's API is reachable, so a proxy can be substituted
 * @param apiKey the secret sent as a bearer token
 * @returns an adapter pointed at DeepSeek's endpoints
 */
function createDeepSeek(baseUrl: string, apiKey: string): ProviderAdapter {
  return {
    id: PROVIDER_IDS.DEEPSEEK,
    chatUrl: joinUrl(baseUrl, '/chat/completions'),
    modelsUrl: joinUrl(baseUrl, '/models'),
    headers: { Authorization: `Bearer ${apiKey}` },
    parseModels: (payload) => parseOpenAiModels(PROVIDER_IDS.DEEPSEEK, payload),
  }
}

/**
 * OpenRouter is OpenAI-compatible and asks callers to identify themselves with
 * `HTTP-Referer` and `X-Title`, which it shows on its public app leaderboard.
 * @param baseUrl where OpenRouter's API is reachable, so a proxy can be substituted
 * @param apiKey the secret sent as a bearer token
 * @param context supplies the attribution headers
 * @returns an adapter pointed at OpenRouter's endpoints
 */
function createOpenRouter(baseUrl: string, apiKey: string, context: ProviderContext): ProviderAdapter {
  return {
    id: PROVIDER_IDS.OPENROUTER,
    chatUrl: joinUrl(baseUrl, '/chat/completions'),
    modelsUrl: joinUrl(baseUrl, '/models'),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': context.openRouterReferer,
      'X-Title': context.openRouterTitle,
    },
    parseModels: (payload) => parseOpenAiModels(PROVIDER_IDS.OPENROUTER, payload),
  }
}

/**
 * LM Studio serves an OpenAI-compatible API on the local machine and needs no key.
 * @param baseUrl the server's base URL, already including `/v1`
 * @returns the adapter
 */
function createLmStudio(baseUrl: string): ProviderAdapter {
  return {
    id: PROVIDER_IDS.LM_STUDIO,
    chatUrl: joinUrl(baseUrl, '/chat/completions'),
    modelsUrl: joinUrl(baseUrl, '/models'),
    headers: {},
    parseModels: (payload) => parseOpenAiModels(PROVIDER_IDS.LM_STUDIO, payload),
  }
}

/** The `{models: [...]}` body that Ollama's native `/api/tags` returns. */
interface OllamaTagList {
  models?: { name?: unknown; model?: unknown }[]
}

/**
 * Ollama offers both a native API and an OpenAI-compatible one. Chat goes through
 * the OpenAI-compatible path so one streaming code path serves every provider,
 * but models come from the native `/api/tags`, which reliably reports what is
 * pulled locally.
 * @param baseUrl the server's base URL, without `/v1`
 * @returns the adapter
 */
function createOllama(baseUrl: string): ProviderAdapter {
  return {
    id: PROVIDER_IDS.OLLAMA,
    chatUrl: joinUrl(baseUrl, '/v1/chat/completions'),
    modelsUrl: joinUrl(baseUrl, '/api/tags'),
    headers: {},
    parseModels: parseOllamaModels,
  }
}

/**
 * Parse Ollama's native tag listing.
 * @param payload the decoded JSON body
 * @returns the models it named
 */
function parseOllamaModels(payload: unknown): ModelInfo[] {
  const list = payload as OllamaTagList
  if (!Array.isArray(list.models)) {
    throw new Error('Ollama returned a tag listing without a "models" array.')
  }
  return list.models
    .map((entry) => {
      const id = typeof entry.model === 'string' ? entry.model : entry.name
      return typeof id === 'string' ? { id, label: id } : null
    })
    .filter((model): model is ModelInfo => model !== null)
}
