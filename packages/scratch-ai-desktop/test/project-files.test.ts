import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadProjectFile,
  projectFileName,
  projectsDirectory,
  resolveSavePath,
  saveProjectFile,
} from '../src/project-files'

describe('where projects go', () => {
  it('keeps them in the app folder beside the other documents', () => {
    expect(projectsDirectory('/home/someone/Documents')).toBe(
      join('/home/someone/Documents', 'Skie AI Editor', 'Projects'),
    )
  })

  it('names the file after the title', () => {
    expect(projectFileName("Maria's Jungle Game")).toBe("Maria's Jungle Game.sb3")
  })

  it('replaces the characters a file name cannot hold', () => {
    expect(projectFileName('Cats: a/b <test>?')).toBe('Cats- a-b -test--.sb3')
  })

  it('falls back to the editor default for a title no platform can use', () => {
    expect(projectFileName('')).toBe('Scratch Project.sb3')
    expect(projectFileName('   ')).toBe('Scratch Project.sb3')
    expect(projectFileName('CON')).toBe('Scratch Project.sb3')
    expect(projectFileName('nul.backup')).toBe('Scratch Project.sb3')
    expect(projectFileName('...')).toBe('Scratch Project.sb3')
  })

  it('replaces control characters too', () => {
    expect(projectFileName('line\none\ttab')).toBe('line-one-tab.sb3')
  })

  it('drops the trailing dots and spaces Windows would drop anyway', () => {
    expect(projectFileName('The End. ')).toBe('The End.sb3')
  })

  it('keeps no more of a long title than the editor does', () => {
    expect(projectFileName('x'.repeat(150))).toBe(`${'x'.repeat(100)}.sb3`)
  })

  it('saves to the projects folder unless told otherwise', () => {
    expect(resolveSavePath('/projects', { title: 'Game' })).toBe(join('/projects', 'Game.sb3'))
  })

  it('reads a relative path as inside the projects folder, adding the extension', () => {
    expect(resolveSavePath('/projects', { title: 'Game', path: 'tests/run1' })).toBe(
      resolve('/projects', 'tests', 'run1.sb3'),
    )
  })

  it('refuses to save a project under another file type', () => {
    expect(() => resolveSavePath('/projects', { title: 'Game', path: 'notes.txt' })).toThrow(/\.sb3 files/)
  })
})

describe('saving and opening project files', () => {
  const folders: string[] = []

  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  })

  /**
   * A projects folder of its own for one test.
   * @returns the folder's path
   */
  function projectsFolder(): string {
    const folder = mkdtempSync(join(tmpdir(), 'skie-projects-'))
    folders.push(folder)
    return join(folder, 'Projects')
  }

  it('writes the bytes, creating the folder, and opens them again', async () => {
    const directory = projectsFolder()
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])

    const { path } = await saveProjectFile(directory, bytes, { title: 'Jungle' })
    const loaded = await loadProjectFile(directory, 'Jungle.sb3')

    expect(path).toBe(join(directory, 'Jungle.sb3'))
    expect(new Uint8Array(readFileSync(path))).toEqual(bytes)
    expect(loaded).toEqual({ bytes, name: 'Jungle.sb3', path })
  })

  it('opens a file by its absolute path too', async () => {
    const directory = projectsFolder()
    const { path } = await saveProjectFile(directory, new Uint8Array([1]), { title: 'Elsewhere', path: 'a/b' })

    expect((await loadProjectFile('/somewhere/else', path)).name).toBe('b.sb3')
  })

  it('says so when there is no such file', async () => {
    await expect(loadProjectFile(projectsFolder(), 'missing.sb3')).rejects.toThrow(/no project file at/)
  })

  it('refuses to open a file that is not a Scratch project', async () => {
    await expect(loadProjectFile(projectsFolder(), 'notes.txt')).rejects.toThrow(/not a Scratch project/)
  })

  it('checks what the editor sent before writing anything', async () => {
    const directory = projectsFolder()

    await expect(saveProjectFile(directory, 'not bytes', { title: 'Game' })).rejects.toThrow(/Uint8Array/)
    await expect(saveProjectFile(directory, new Uint8Array([1]), { title: 7 })).rejects.toThrow(/string title/)
    await expect(saveProjectFile(directory, new Uint8Array([1]), null)).rejects.toThrow(/string title/)
    expect(existsSync(directory)).toBe(false)
  })
})
