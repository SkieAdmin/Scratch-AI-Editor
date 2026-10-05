import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The port the MCP endpoint listens on unless the settings name another. */
export const DEFAULT_MCP_PORT = 8610

/**
 * What the settings file holds: what the editor's settings screen saves and
 * reloads, plus the shell's own settings, which the user edits by hand.
 */
export interface StoredConfig {
  providerId?: string
  modelId?: string
  baseUrls?: Record<string, string>
  apiKeys?: Record<string, string>
  useBridge?: boolean
  maxToolRounds?: number
  /** The port the MCP endpoint listens on. */
  mcpPort?: number
  /** A bearer token MCP clients must send; none is required when absent. */
  mcpToken?: string
}

/** Settings only the shell reads. The editor never sends them, so its saves must keep them. */
const SHELL_SETTINGS = ['mcpPort', 'mcpToken'] as const

/**
 * Merge what the editor saved into the settings already on disk.
 *
 * The editor writes back only the fields it knows about, so writing its
 * object as-is would erase the shell's own settings every time the user
 * pressed Save in the editor.
 * @param stored the settings currently on disk
 * @param fromEditor what the editor asked to save
 * @returns the settings to write
 */
export function keepShellSettings(stored: StoredConfig, fromEditor: StoredConfig): StoredConfig {
  const merged: StoredConfig = { ...fromEditor }
  for (const key of SHELL_SETTINGS) {
    if (stored[key] !== undefined && merged[key] === undefined) {
      Object.assign(merged, { [key]: stored[key] })
    }
  }
  return merged
}

/**
 * The port the MCP endpoint should listen on.
 * @param config the saved settings
 * @param warn told when the saved port is unusable, so the user can fix the file
 * @returns the configured port, or the default when none or a bad one is set
 */
export function resolveMcpPort(config: StoredConfig, warn: (message: string) => void): number {
  const port = config.mcpPort
  if (port === undefined) return DEFAULT_MCP_PORT
  if (Number.isInteger(port) && port > 0 && port <= 65535) return port

  warn(`Ignoring mcpPort ${JSON.stringify(port)} in the settings file: it must be a whole number from 1 to 65535.`)
  return DEFAULT_MCP_PORT
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
