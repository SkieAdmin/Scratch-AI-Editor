import { describe, expect, it } from 'vitest'
import { isOriginAllowed, isTokenValid, verifyUpgrade, type UpgradePolicy } from '../src'

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
