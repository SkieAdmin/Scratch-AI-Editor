import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Where an outside tool can find the running app's MCP endpoint. */
export interface McpEndpoint {
  url: string
  port: number
  /** The app's process id, so a reader can tell a live endpoint from a stale file. */
  pid: number
  /** When the app started, as an ISO 8601 timestamp. */
  startedAt: string
}

/**
 * The folder the app keeps its own files in, beside the user's other documents.
 * @param documentsPath the OS documents directory
 * @returns the app's folder
 */
export function appDirectory(documentsPath: string): string {
  return join(documentsPath, 'Skie AI Editor')
}

/**
 * Where the running app announces its MCP endpoint.
 * @param documentsPath the OS documents directory
 * @returns where the file goes, inside the app folder
 */
export function discoveryFilePath(documentsPath: string): string {
  return join(appDirectory(documentsPath), 'mcp-endpoint.json')
}

/**
 * Announce the endpoint, so a tool can find it without asking the user.
 * @param path where the file goes, from discoveryFilePath
 * @param endpoint what to announce
 */
export function writeDiscoveryFile(path: string, endpoint: McpEndpoint): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(endpoint, null, 2)}\n`, 'utf8')
}

/**
 * Withdraw the announcement on the way out, unless another copy of the app has
 * written its own since.
 * @param path where the file goes, from discoveryFilePath
 * @param pid the process id this copy of the app wrote
 */
export function removeDiscoveryFile(path: string, pid: number): void {
  let current: unknown
  try {
    current = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // Already gone, or not ours to judge.
    return
  }
  if (current !== null && typeof current === 'object' && (current as Partial<McpEndpoint>).pid === pid) {
    rmSync(path, { force: true })
  }
}

/**
 * Whether a listen failed because something else holds the port.
 * @param error what the listen threw
 * @returns true for EADDRINUSE
 */
export function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
}

/**
 * Start a server on its usual port, or on any free port when that one is taken.
 *
 * MCP clients are registered once against a fixed URL, so the usual port is
 * what makes the app reachable after every restart. A second copy of the app,
 * or another program on that port, must still not stop the app from opening.
 * @param start starts the server on the given port, 0 meaning any free one
 * @param port the usual port
 * @param onBusy told when the usual port was taken and a free one is used instead
 * @returns whatever `start` returned
 */
export async function startOnPreferredPort<T>(
  start: (port: number) => Promise<T>,
  port: number,
  onBusy: (port: number) => void,
): Promise<T> {
  try {
    return await start(port)
  } catch (error) {
    if (!isAddressInUse(error)) throw error
    onBusy(port)
    return start(0)
  }
}

/**
 * The command that registers this app's endpoint with Claude Code.
 * @param url the MCP endpoint
 * @param token the bearer token clients must send, if one is required
 * @returns the command line to run
 */
export function claudeMcpAddCommand(url: string, token?: string): string {
  const header = token ? ` --header "Authorization: Bearer ${token}"` : ''
  return `claude mcp add --transport http scratch ${url}${header}`
}
