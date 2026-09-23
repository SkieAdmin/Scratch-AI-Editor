import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Origins a browser page may dial in from when the operator configures no
 * allowlist: the editor served from any port on the local machine.
 */
const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

/** Wildcard an operator can pass to `--allow-origin` to switch the check off. */
const ALLOW_ANY_ORIGIN = '*'

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

/** The verdict on one WebSocket upgrade attempt. */
export interface UpgradeVerdict {
  ok: boolean
  /** HTTP status to answer a rejected upgrade with. */
  status: number
  /** Human-readable reason, logged by the bridge and sent in the HTTP response. */
  message: string
}

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
