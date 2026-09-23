/**
 * Print a line of bridge output.
 *
 * Everything goes to stderr, including the startup banner: when MCP is served
 * over stdio, stdout is the JSON-RPC channel and any other byte written there
 * breaks the client's parser.
 * @param message the line to print
 */
export function log(message: string): void {
  process.stderr.write(`scratch-ai-bridge: ${message}\n`)
}
