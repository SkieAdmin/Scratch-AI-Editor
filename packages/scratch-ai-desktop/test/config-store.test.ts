import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MCP_PORT, keepShellSettings, resolveMcpPort } from '../src/config-store'

describe('resolveMcpPort', () => {
  it('uses the fixed default, so a registered client finds the app after every restart', () => {
    expect(resolveMcpPort({}, vi.fn())).toBe(8610)
    expect(DEFAULT_MCP_PORT).toBe(8610)
  })

  it('honours a port set in the settings file', () => {
    expect(resolveMcpPort({ mcpPort: 9000 }, vi.fn())).toBe(9000)
  })

  it('falls back to the default, and says why, when the setting is unusable', () => {
    for (const mcpPort of [0, -1, 70000, 86.5, '8611' as unknown as number]) {
      const warn = vi.fn()

      expect(resolveMcpPort({ mcpPort }, warn)).toBe(DEFAULT_MCP_PORT)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('mcpPort'))
    }
  })
})

describe('keepShellSettings', () => {
  /*
   * The editor saves only the fields its settings screen knows, so writing its
   * object straight to disk erased the shell's own settings on every save.
   */
  it("keeps the shell's settings when the editor saves its own", () => {
    const merged = keepShellSettings(
      { providerId: 'ollama', mcpPort: 9000, mcpToken: 's3cret' },
      { providerId: 'deepseek', modelId: 'deepseek-chat' },
    )

    expect(merged).toEqual({ providerId: 'deepseek', modelId: 'deepseek-chat', mcpPort: 9000, mcpToken: 's3cret' })
  })

  it('adds nothing the file did not have', () => {
    expect(keepShellSettings({}, { providerId: 'deepseek' })).toEqual({ providerId: 'deepseek' })
  })
})
