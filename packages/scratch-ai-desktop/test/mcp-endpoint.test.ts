import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startBridge, type RunningBridge } from '@skieadmin/scratch-ai-bridge'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claudeMcpAddCommand,
  discoveryFilePath,
  isAddressInUse,
  removeDiscoveryFile,
  startOnPreferredPort,
  writeDiscoveryFile,
} from '../src/mcp-endpoint'

describe('the discovery file', () => {
  const folders: string[] = []

  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  })

  /**
   * A documents folder of its own for one test.
   * @returns the folder's path
   */
  function documentsFolder(): string {
    const folder = mkdtempSync(join(tmpdir(), 'skie-documents-'))
    folders.push(folder)
    return folder
  }

  it('lives in the app folder beside the other documents', () => {
    expect(discoveryFilePath('/home/someone/Documents')).toBe(
      join('/home/someone/Documents', 'Skie AI Editor', 'mcp-endpoint.json'),
    )
  })

  it('records the url, port, process and start time', () => {
    const path = discoveryFilePath(documentsFolder())
    const endpoint = {
      url: 'http://127.0.0.1:8610/mcp',
      port: 8610,
      pid: 1234,
      startedAt: '2026-10-05T12:00:00.000Z',
    }

    writeDiscoveryFile(path, endpoint)

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(endpoint)
  })

  it('is removed on the way out by the copy of the app that wrote it', () => {
    const path = discoveryFilePath(documentsFolder())
    writeDiscoveryFile(path, { url: 'http://127.0.0.1:8610/mcp', port: 8610, pid: 1234, startedAt: 'now' })

    removeDiscoveryFile(path, 1234)

    expect(existsSync(path)).toBe(false)
  })

  it('is left alone when another copy of the app has written its own', () => {
    const path = discoveryFilePath(documentsFolder())
    writeDiscoveryFile(path, { url: 'http://127.0.0.1:50000/mcp', port: 50000, pid: 5678, startedAt: 'now' })

    removeDiscoveryFile(path, 1234)

    expect(existsSync(path)).toBe(true)
  })

  it('is no trouble to remove when it is not there', () => {
    expect(() => removeDiscoveryFile(discoveryFilePath(documentsFolder()), 1234)).not.toThrow()
  })
})

describe('startOnPreferredPort', () => {
  const bridges: RunningBridge[] = []

  afterEach(async () => {
    await Promise.all(bridges.splice(0).map((bridge) => bridge.close()))
  })

  it('uses the usual port when it is free', async () => {
    const start = vi.fn((port: number) => Promise.resolve(port))
    const onBusy = vi.fn()

    expect(await startOnPreferredPort(start, 8610, onBusy)).toBe(8610)
    expect(onBusy).not.toHaveBeenCalled()
  })

  it('moves to a free port, and says so, when the usual one is taken', async () => {
    const holder = await startBridge({ port: 0, mcpHttp: true })
    bridges.push(holder)
    const onBusy = vi.fn()

    const moved = await startOnPreferredPort(
      (port) => startBridge({ host: '127.0.0.1', port, mcpHttp: true }),
      holder.port,
      onBusy,
    )
    bridges.push(moved)

    expect(onBusy).toHaveBeenCalledWith(holder.port)
    expect(moved.port).not.toBe(holder.port)
    expect(moved.mcpHttpUrl).toBe(`http://127.0.0.1:${moved.port}/mcp`)
  })

  it('does not hide any other failure', async () => {
    const failure = new Error('permission denied')

    await expect(startOnPreferredPort(() => Promise.reject(failure), 8610, vi.fn())).rejects.toBe(failure)
  })

  it('knows a taken port by its error code', () => {
    expect(isAddressInUse(Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }))).toBe(true)
    expect(isAddressInUse(Object.assign(new Error('listen EACCES'), { code: 'EACCES' }))).toBe(false)
    expect(isAddressInUse('EADDRINUSE')).toBe(false)
  })
})

describe('claudeMcpAddCommand', () => {
  it('registers the endpoint with Claude Code under the name "scratch"', () => {
    expect(claudeMcpAddCommand('http://127.0.0.1:8610/mcp')).toBe(
      'claude mcp add --transport http scratch http://127.0.0.1:8610/mcp',
    )
  })

  it('sends the bearer token when one is required', () => {
    expect(claudeMcpAddCommand('http://127.0.0.1:8610/mcp', 's3cret')).toBe(
      'claude mcp add --transport http scratch http://127.0.0.1:8610/mcp --header "Authorization: Bearer s3cret"',
    )
  })
})
