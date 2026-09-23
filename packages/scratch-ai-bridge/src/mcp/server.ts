import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { EditorHub } from '../hub/editor-hub'

/** The name MCP clients see for this server. */
export const MCP_SERVER_NAME = 'scratch-ai-bridge'

/**
 * Build an MCP server that forwards every tool call to the attached editor.
 *
 * The tool catalogue is whatever the editor announced, so it is registered
 * dynamically rather than declared here: the low-level `Server` takes the JSON
 * Schema the editor sent as-is, where the higher-level `McpServer.registerTool`
 * would want a Zod shape known at build time.
 * @param hub the hub holding the editor connection
 * @param version the bridge's version, reported to the client
 * @returns the configured server, not yet connected to a transport
 */
export function createMcpServer(hub: EditorHub, version: string): Server {
  const server = new Server({ name: MCP_SERVER_NAME, version }, { capabilities: { tools: { listChanged: true } } })

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: hub.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await hub.invoke(request.params.name, request.params.arguments ?? {})
      return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? null) }] }
    } catch (error) {
      // A tool error is an answer, not a protocol failure: the model should see
      // why the call did not work and be able to try something else.
      return { content: [{ type: 'text' as const, text: describeError(error) }], isError: true }
    }
  })

  return server
}

/**
 * Serve an MCP server over stdio, so a client such as Claude Desktop can spawn
 * the bridge as a child process.
 * @param server the server to connect
 * @returns the connected transport
 */
export async function serveMcpOverStdio(server: Server): Promise<StdioServerTransport> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  return transport
}

/**
 * Serve an MCP server over Streamable HTTP, for clients that attach to a URL
 * rather than spawning a process.
 * @param server the server to connect
 * @returns the connected transport, ready to handle requests
 */
export async function serveMcpOverHttp(server: Server): Promise<StreamableHTTPServerTransport> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
  await server.connect(transport)
  return transport
}

/**
 * Tell connected MCP clients that the editor changed which tools it offers.
 * @param servers every live MCP server
 */
export function notifyToolListChanged(servers: readonly Server[]): void {
  for (const server of servers) {
    // A client can disconnect between the editor's `hello` and this notification.
    void server.notification({ method: 'notifications/tools/list_changed' }).catch((error: unknown) => {
      console.warn(`scratch-ai-bridge: could not announce the tool list change: ${describeError(error)}`)
    })
  }
}

/**
 * Describe a thrown value for a client that can only read text.
 * @param error the thrown value
 * @returns its message
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
