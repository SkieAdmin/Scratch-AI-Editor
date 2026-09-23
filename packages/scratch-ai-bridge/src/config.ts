import { readFileSync } from 'node:fs'
import { PROVIDER_IDS, type ProviderId, type ProviderSettingsMap } from './providers'

/** The JSON an operator may point `--config` at. */
export interface BridgeConfigFile {
  port?: number
  host?: string
  token?: string
  allowOrigin?: string[]
  mcpHttp?: boolean
  providers?: Partial<Record<ProviderId, { apiKey?: string; baseUrl?: string }>>
  openRouter?: { referer?: string; title?: string }
}

/**
 * Read and decode a bridge config file.
 * @param path the file the operator named
 * @returns its contents
 */
export function readConfigFile(path: string): BridgeConfigFile {
  const text = readFileSync(path, 'utf8')
  try {
    return JSON.parse(text) as BridgeConfigFile
  } catch (error) {
    throw new Error(`The bridge config file at ${path} is not valid JSON: ${(error as Error).message}`)
  }
}

/**
 * Resolve each provider's settings from the environment and the config file.
 *
 * The environment wins, so an operator can keep keys out of a file on disk. Keys
 * are read here and nowhere else: the editor never sends one, because a browser
 * page cannot hold a secret that the other pages in that browser cannot reach.
 * @param config the config file contents, or an empty object when none was given
 * @param env the process environment
 * @returns settings for every provider
 */
export function resolveProviderSettings(config: BridgeConfigFile, env: NodeJS.ProcessEnv): ProviderSettingsMap {
  const fromFile = config.providers ?? {}

  return {
    [PROVIDER_IDS.DEEPSEEK]: {
      apiKey: whenSet(env.DEEPSEEK_API_KEY) ?? fromFile.deepseek?.apiKey,
      baseUrl: fromFile.deepseek?.baseUrl,
    },
    [PROVIDER_IDS.OPENROUTER]: {
      apiKey: whenSet(env.OPENROUTER_API_KEY) ?? fromFile.openrouter?.apiKey,
      baseUrl: fromFile.openrouter?.baseUrl,
    },
    [PROVIDER_IDS.LM_STUDIO]: {
      baseUrl: fromFile.lmstudio?.baseUrl,
    },
    [PROVIDER_IDS.OLLAMA]: {
      baseUrl: fromFile.ollama?.baseUrl,
    },
  }
}

/**
 * Treat an empty environment variable as unset, so an exported-but-blank key
 * falls through to the config file instead of reaching the provider as `Bearer `.
 * @param value the environment variable's value
 * @returns the value, or undefined when it is absent or empty
 */
function whenSet(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}
