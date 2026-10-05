import type { ServerResponse } from 'node:http'

/**
 * Answer an MCP HTTP request with a JSON-RPC error, in the shape the MCP SDK's
 * own transport uses, so a client reads every refusal the same way.
 * @param response the response to write
 * @param status the HTTP status
 * @param code the kind of failure, as a JSON-RPC error number
 * @param message why the request was refused
 * @param headers anything else to send, such as an authentication challenge
 */
export function writeJsonRpcError(
  response: ServerResponse,
  status: number,
  code: number,
  message: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  response.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }))
}
