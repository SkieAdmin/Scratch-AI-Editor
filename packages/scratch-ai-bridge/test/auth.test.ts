import { describe, expect, it } from 'vitest'
import {
  allowedMcpHosts,
  isOriginAllowed,
  isTokenValid,
  verifyMcpRequest,
  verifyUpgrade,
  type McpRequestPolicy,
  type UpgradePolicy,
} from '../src'

const TOKEN = 'e5f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4'

const POLICY: UpgradePolicy = { token: TOKEN, allowedOrigins: [], path: '/editor' }

describe('isOriginAllowed', () => {
  it('allows the editor served from any port on this machine', () => {
    expect(isOriginAllowed('http://localhost:8601', [])).toBe(true)
    expect(isOriginAllowed('http://127.0.0.1:3000', [])).toBe(true)
    expect(isOriginAllowed('https://localhost', [])).toBe(true)
    expect(isOriginAllowed('http://[::1]:8601', [])).toBe(true)
  })

  it('refuses a page on the open web, which is the attack this check exists for', () => {
    expect(isOriginAllowed('https://evil.example', [])).toBe(false)
    expect(isOriginAllowed('http://localhost.evil.example', [])).toBe(false)
    expect(isOriginAllowed('https://127.0.0.1.evil.example', [])).toBe(false)
  })

  it('refuses a scheme that is not http or https', () => {
    expect(isOriginAllowed('file://', [])).toBe(false)
    expect(isOriginAllowed('null', [])).toBe(false)
  })

  it('honours an explicit allowlist instead of the local default', () => {
    expect(isOriginAllowed('https://editor.example', ['https://editor.example'])).toBe(true)
    // An allowlist replaces the default, so localhost is no longer implied.
    expect(isOriginAllowed('http://localhost:8601', ['https://editor.example'])).toBe(false)
  })

  it('allows every origin when the operator asks for the wildcard', () => {
    expect(isOriginAllowed('https://evil.example', ['*'])).toBe(true)
  })

  it('allows a request that sends no Origin, which only a non-browser client does', () => {
    expect(isOriginAllowed(undefined, [])).toBe(true)
    expect(isOriginAllowed('', [])).toBe(true)
  })
})

describe('isTokenValid', () => {
  it('accepts the exact token', () => {
    expect(isTokenValid(TOKEN, TOKEN)).toBe(true)
  })

  it('refuses a wrong, truncated, extended or absent token', () => {
    expect(isTokenValid(`${TOKEN}x`, TOKEN)).toBe(false)
    expect(isTokenValid(TOKEN.slice(0, -1), TOKEN)).toBe(false)
    expect(isTokenValid(TOKEN.toUpperCase(), TOKEN)).toBe(false)
    expect(isTokenValid('', TOKEN)).toBe(false)
    expect(isTokenValid(null, TOKEN)).toBe(false)
  })
})

describe('verifyUpgrade', () => {
  it('accepts the editor endpoint with a good token from a local page', () => {
    expect(verifyUpgrade(`/editor?token=${TOKEN}`, 'http://localhost:8601', POLICY)).toMatchObject({
      ok: true,
      status: 101,
    })
  })

  it('accepts extra query parameters alongside the token', () => {
    expect(verifyUpgrade(`/editor?v=1&token=${TOKEN}`, 'http://localhost:8601', POLICY).ok).toBe(true)
  })

  it('refuses any path other than the editor endpoint', () => {
    const verdict = verifyUpgrade(`/mcp?token=${TOKEN}`, 'http://localhost:8601', POLICY)
    expect(verdict).toMatchObject({ ok: false, status: 404 })
    expect(verdict.message).toContain('/mcp')
  })

  it('refuses a hostile origin before it looks at the token', () => {
    const verdict = verifyUpgrade(`/editor?token=${TOKEN}`, 'https://evil.example', POLICY)
    expect(verdict).toMatchObject({ ok: false, status: 403 })
    expect(verdict.message).toContain('evil.example')
  })

  it('refuses a missing or wrong token from an allowed origin', () => {
    expect(verifyUpgrade('/editor', 'http://localhost:8601', POLICY)).toMatchObject({ ok: false, status: 401 })
    expect(verifyUpgrade('/editor?token=guess', 'http://localhost:8601', POLICY)).toMatchObject({
      ok: false,
      status: 401,
    })
  })

  it('refuses a request with no target at all', () => {
    expect(verifyUpgrade(undefined, 'http://localhost:8601', POLICY)).toMatchObject({ ok: false, status: 404 })
  })
})

describe('allowedMcpHosts', () => {
  it('answers to the loopback names this machine uses for itself', () => {
    expect(allowedMcpHosts('127.0.0.1', 8610)).toEqual(['127.0.0.1:8610', 'localhost:8610'])
  })

  it('also answers to an address the operator bound explicitly', () => {
    expect(allowedMcpHosts('192.168.1.5', 8610)).toContain('192.168.1.5:8610')
    expect(allowedMcpHosts('::1', 8610)).toContain('[::1]:8610')
  })

  it('adds nothing for a wildcard bind, which is not a name anyone dials', () => {
    expect(allowedMcpHosts('0.0.0.0', 8610)).toEqual(['127.0.0.1:8610', 'localhost:8610'])
  })
})

describe('verifyMcpRequest', () => {
  const MCP_POLICY: McpRequestPolicy = { allowedHosts: allowedMcpHosts('127.0.0.1', 8610), allowedOrigins: [] }

  it('accepts a client such as Claude Code, which sends no Origin', () => {
    expect(verifyMcpRequest({ host: '127.0.0.1:8610' }, MCP_POLICY)).toMatchObject({ ok: true })
    expect(verifyMcpRequest({ host: 'LOCALHOST:8610' }, MCP_POLICY)).toMatchObject({ ok: true })
  })

  it('refuses a Host it does not answer to, which is what a DNS rebinding attack sends', () => {
    expect(verifyMcpRequest({ host: 'evil.example:8610' }, MCP_POLICY)).toMatchObject({ ok: false, status: 403 })
    expect(verifyMcpRequest({ host: '127.0.0.1:9999' }, MCP_POLICY)).toMatchObject({ ok: false, status: 403 })
    expect(verifyMcpRequest({}, MCP_POLICY)).toMatchObject({ ok: false, status: 403 })
  })

  it("refuses a web page other than the editor's own", () => {
    const own: McpRequestPolicy = { ...MCP_POLICY, allowedOrigins: ['http://127.0.0.1:5000'] }

    expect(verifyMcpRequest({ host: '127.0.0.1:8610', origin: 'http://127.0.0.1:5000' }, own)).toMatchObject({
      ok: true,
    })
    expect(verifyMcpRequest({ host: '127.0.0.1:8610', origin: 'https://evil.example' }, own)).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(verifyMcpRequest({ host: '127.0.0.1:8610', origin: 'http://127.0.0.1:6000' }, own)).toMatchObject({
      ok: false,
      status: 403,
    })
  })

  it('demands the bearer token when one is set', () => {
    const guarded: McpRequestPolicy = { ...MCP_POLICY, token: TOKEN }

    expect(verifyMcpRequest({ host: '127.0.0.1:8610' }, guarded)).toMatchObject({ ok: false, status: 401 })
    expect(verifyMcpRequest({ host: '127.0.0.1:8610', authorization: 'Bearer guess' }, guarded)).toMatchObject({
      ok: false,
      status: 401,
    })
    expect(verifyMcpRequest({ host: '127.0.0.1:8610', authorization: TOKEN }, guarded)).toMatchObject({
      ok: false,
      status: 401,
    })
    expect(verifyMcpRequest({ host: '127.0.0.1:8610', authorization: `Bearer ${TOKEN}` }, guarded)).toMatchObject({
      ok: true,
    })
    expect(verifyMcpRequest({ host: '127.0.0.1:8610', authorization: `bearer ${TOKEN}` }, guarded)).toMatchObject({
      ok: true,
    })
  })
})
