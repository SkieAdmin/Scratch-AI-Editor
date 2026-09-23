import { parseArgs } from 'node:util'
import packageJson from '../package.json'
import { DEFAULT_HOST, DEFAULT_PORT, startBridge, type RunningBridge } from './bridge'
import { readConfigFile, resolveProviderSettings, type BridgeConfigFile } from './config'
import { log } from './log'
import { PROVIDER_IDS, REMOTE_PROVIDER_IDS } from './providers'

const USAGE = `Usage: scratch-ai-bridge [options]

Runs the local MCP server that lets an AI client drive the Scratch editor, and
proxies chat requests so provider API keys stay in this process.

Options:
  --port <number>      Port to listen on (default: ${DEFAULT_PORT})
  --host <address>     Address to bind (default: ${DEFAULT_HOST}; 0.0.0.0 exposes
                       the bridge to your whole network)
  --token <secret>     Shared secret the editor must present; one is generated
                       and printed when this is omitted
  --allow-origin <o>   Exact browser origin allowed to connect; repeatable.
                       Defaults to any http(s) origin on localhost
  --mcp-http           Also serve MCP over Streamable HTTP at /mcp
  --no-mcp-stdio       Do not serve MCP over stdio
  --config <path>      JSON config file with ports, token and provider settings
  -h, --help           Show this message
`

/**
 * Parse the command line, start the bridge and print how to reach it.
 * @param argv the arguments after the executable and script
 * @returns the running bridge
 */
export async function runCli(argv: string[]): Promise<RunningBridge | null> {
  const { values } = parseArgs({
    args: argv,
    options: {
      'allow-origin': { type: 'string', multiple: true },
      config: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      host: { type: 'string' },
      'mcp-http': { type: 'boolean' },
      'no-mcp-stdio': { type: 'boolean' },
      port: { type: 'string' },
      token: { type: 'string' },
    },
  })

  if (values.help) {
    process.stderr.write(USAGE)
    return null
  }

  const config: BridgeConfigFile = values.config ? readConfigFile(values.config) : {}
  const mcpStdio = values['no-mcp-stdio'] !== true

  const bridge = await startBridge({
    allowedOrigins: values['allow-origin'],
    config,
    host: values.host,
    mcpHttp: values['mcp-http'],
    mcpStdio,
    port: values.port === undefined ? undefined : parsePort(values.port),
    token: values.token,
    version: packageJson.version,
  })

  printBanner(bridge, config, mcpStdio)
  return bridge
}

/**
 * Parse and range-check a `--port` value.
 * @param value the raw flag value
 * @returns the port number
 */
function parsePort(value: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`--port must be a whole number between 0 and 65535, but it was "${value}".`)
  }
  return port
}

/**
 * Print where the bridge is listening, which providers have keys, and the editor
 * URL with its token, which is the only place the generated token is shown.
 * @param bridge the running bridge
 * @param config the operator's config file contents
 * @param mcpStdio whether MCP is served over stdio
 */
function printBanner(bridge: RunningBridge, config: BridgeConfigFile, mcpStdio: boolean): void {
  const settings = resolveProviderSettings(config, process.env)
  const withKeys = REMOTE_PROVIDER_IDS.filter((id) => settings[id].apiKey)
  const withoutKeys = REMOTE_PROVIDER_IDS.filter((id) => !settings[id].apiKey)

  log(`listening on ${bridge.host}:${bridge.port}`)
  log(`MCP over stdio: ${mcpStdio ? 'on' : 'off'}`)
  log(`MCP over Streamable HTTP: ${bridge.mcpHttpUrl ?? 'off'}`)
  log(`API keys loaded for: ${withKeys.length > 0 ? withKeys.join(', ') : 'none'}`)
  if (withoutKeys.length > 0) {
    log(`no API key for: ${withoutKeys.join(', ')} (local providers such as ${PROVIDER_IDS.OLLAMA} need none)`)
  }
  log('')
  log("Paste this into the editor's AI settings as the bridge URL:")
  log(`  ${bridge.editorUrl}`)
  log('')
  log('Anyone holding that token can drive your editor and spend your API credits.')
}

const bridge = await runCli(process.argv.slice(2))

if (bridge) {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void bridge.close().then(() => process.exit(0))
    })
  }
}
