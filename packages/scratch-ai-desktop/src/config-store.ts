import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** What the editor's settings screen saves and reloads. */
export interface StoredConfig {
  providerId?: string
  modelId?: string
  baseUrls?: Record<string, string>
  apiKeys?: Record<string, string>
  useBridge?: boolean
  maxToolRounds?: number
}

/**
 * Where the settings live, somewhere the user can open and edit by hand.
 * @param documentsPath the OS documents directory
 * @returns the full path to the config file
 */
export function configPath(documentsPath: string): string {
  return join(documentsPath, 'Scratch3_Config.json')
}

/**
 * Read the saved settings.
 *
 * A missing or unreadable file is the normal first-run case, not an error, so
 * it yields empty settings and the editor falls back to its defaults.
 * @param path the config file to read
 * @returns whatever was stored, or an empty object
 */
export function readConfig(path: string): StoredConfig {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return {}
  }

  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn(`Ignoring ${path}: it does not contain a JSON object.`)
      return {}
    }
    return parsed
  } catch (error) {
    // The user can edit this file, so a syntax error is theirs to hear about
    // rather than a reason to refuse to start.
    console.warn(`Ignoring ${path}: ${error instanceof Error ? error.message : String(error)}`)
    return {}
  }
}

/**
 * Save the settings, creating the directory if the user has moved it.
 * @param path the config file to write
 * @param config what to store
 */
export function writeConfig(path: string, config: StoredConfig): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}
