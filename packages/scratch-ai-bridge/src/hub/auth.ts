import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

/**
 * Origins a browser page may dial in from when the operator configures no
 * allowlist: the editor served from any port on the local machine.
 */
const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

/** Wildcard an operator can pass to `--allow-origin` to switch the check off. */
const ALLOW_ANY_ORIGIN = '*'

/** Bind addresses that mean "every interface" rather than one name the machine answers to. */
const WILDCARD_HOSTS = new Set(['', '0.0.0.0', '::'])

/**
 * Decide whether a page at this origin may drive the editor.
 *
 * Any page the user happens to have open can open a WebSocket to 127.0.0.1, so
 * without this check a hostile site could silently drive the editor and spend
 * the user's API credits. Non-browser clients send no `Origin` at all; the
 * shared token is what holds them back, because `Origin` only says which page
 * the browser is acting for.
 * @param origin the request's `Origin` header, if it sent one
 * @param allowedOrigins exact origins the operator allowed, or `['*']`
 * @returns whether the connection may proceed
 */
export function isOriginAllowed(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (origin === undefined || origin === '') return true
  if (allowedOrigins.includes(ALLOW_ANY_ORIGIN)) return true
  if (allowedOrigins.length > 0) return allowedOrigins.includes(origin)
  return LOCAL_ORIGIN_PATTERN.test(origin)
}

/**
 * Compare a presented token against the expected one without leaking how much of
 * it matched. Both sides are hashed first so the comparison is over fixed-length
 * buffers and the token's length stays private too.
 * @param provided the token from the request, or null when it sent none
 * @param expected the bridge's token
 * @returns whether they match
 */
export function isTokenValid(provided: string | null, expected: string): boolean {
  if (provided === null) return false
  return timingSafeEqual(digest(provided), digest(expected))
}

/**
 * Hash a token to a fixed-length buffer.
 * @param value the token
 * @returns its SHA-256 digest
 */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/** What the operator allows on the editor endpoint. */
export interface UpgradePolicy {
  /** The shared secret the editor must present as `?token=`. */
  token: string
  /** Exact origins to allow, or empty to allow any local origin. */
  allowedOrigins: readonly string[]
  /** The path the editor endpoint is served at. */
  path: string
}

/** The verdict on one request to the bridge. */
export interface RequestVerdict {
  ok: boolean
  /** HTTP status to answer a rejected request with. */
  status: number
  /** Human-readable reason, logged by the bridge and sent in the HTTP response. */
  message: string
}

/** The verdict on one WebSocket upgrade attempt. */
export type UpgradeVerdict = RequestVerdict

/**
 * Check one WebSocket upgrade against the bridge's policy.
 * @param requestUrl the request target, e.g. `/editor?token=abc`
 * @param origin the request's `Origin` header, if it sent one
 * @param policy what the operator allows
 * @returns whether to accept, and why not when rejecting
 */
export function verifyUpgrade(
  requestUrl: string | undefined,
  origin: string | undefined,
  policy: UpgradePolicy,
): UpgradeVerdict {
  // Only the path and query matter; the base makes the relative target parseable.
  const url = new URL(requestUrl ?? '/', 'http://127.0.0.1')

  if (url.pathname !== policy.path) {
    return { ok: false, status: 404, message: `This bridge serves no endpoint at ${url.pathname}.` }
  }
  if (!isOriginAllowed(origin, policy.allowedOrigins)) {
    return { ok: false, status: 403, message: `Origin ${origin} is not allowed to reach this bridge.` }
  }
  if (!isTokenValid(url.searchParams.get('token'), policy.token)) {
    return { ok: false, status: 401, message: 'Missing or incorrect bridge token.' }
  }

  return { ok: true, status: 101, message: 'Accepted.' }
}

/** What the operator allows on the MCP endpoint. */
export interface McpRequestPolicy {
  /** `Host` header values the endpoint answers to, in lower case, e.g. `127.0.0.1:8610`. */
  allowedHosts: readonly string[]
  /** Exact origins to allow, or empty to allow any local origin. */
  allowedOrigins: readonly string[]
  /** The bearer token every request must carry, or undefined when none is required. */
  token?: string
}

/**
 * The `Host` header values the MCP endpoint answers to.
 *
 * A DNS rebinding attack points a hostile name at 127.0.0.1, but the browser
 * still sends that hostile name as `Host`, so only the names this machine uses
 * for itself get through. A bridge bound to one specific address can also be
 * reached by that address.
 * @param host the address the bridge is bound to
 * @param port the port it listens on
 * @returns the allowed values, in lower case
 */
export function allowedMcpHosts(host: string, port: number): string[] {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
  if (WILDCARD_HOSTS.has(host)) return hosts

  const bound = (host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`).toLowerCase()
  return hosts.includes(bound) ? hosts : [...hosts, bound]
}

/**
 * Check one request to the MCP endpoint against the bridge's policy.
 *
 * Non-browser clients such as Claude Code send no `Origin`, so the origin check
 * only stops web pages; the optional token is what holds back other local
 * programs.
 * @param headers what the request sent, of which Host, Origin and Authorization are read
 * @param policy what the operator allows
 * @returns whether to accept, and why not when rejecting
 */
export function verifyMcpRequest(headers: IncomingHttpHeaders, policy: McpRequestPolicy): RequestVerdict {
  const host = headers.host?.toLowerCase()
  if (host === undefined || !policy.allowedHosts.includes(host)) {
    return {
      ok: false,
      status: 403,
      message: `Host ${headers.host ?? '(none)'} is not allowed to reach this bridge.`,
    }
  }
  if (!isOriginAllowed(headers.origin, policy.allowedOrigins)) {
    return { ok: false, status: 403, message: `Origin ${headers.origin} is not allowed to reach this bridge.` }
  }
  if (policy.token !== undefined && !isTokenValid(readBearerToken(headers.authorization), policy.token)) {
    return {
      ok: false,
      status: 401,
      message: 'Missing or incorrect MCP token. Send it as "Authorization: Bearer <token>".',
    }
  }

  return { ok: true, status: 200, message: 'Accepted.' }
}

/**
 * Read the token out of an `Authorization: Bearer <token>` header.
 * @param header the header's value, if the request sent one
 * @returns the token, or null when there is no bearer token
 */
function readBearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '')
  return match ? match[1] : null
}
