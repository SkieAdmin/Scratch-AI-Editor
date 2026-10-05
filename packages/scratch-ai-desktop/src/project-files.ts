import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { appDirectory } from './mcp-endpoint.ts'

/** The name a project with no usable title is saved under, as the editor's own download names it. */
const DEFAULT_PROJECT_NAME = 'Scratch Project'

/** How much of a title the editor keeps in a file name. */
const MAX_NAME_LENGTH = 100

/** The project formats the VM can open. */
const OPENABLE_EXTENSIONS = ['.sb3', '.sb2', '.sb']

/** Characters Windows refuses in a file name, besides control characters; macOS and Linux refuse fewer. */
const UNSAFE_CHARACTERS = new Set('<>:"/\\|?*')

/** The first space in the character set, below which every character is a control character. */
const FIRST_PRINTABLE = 0x20

/** Names Windows reserves for devices, whatever extension follows them. */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** What the editor sends to have a project saved. */
export interface SaveProjectRequest {
  /** The project's title, which names the file when no path is given. */
  title: string
  /** Where to write it; relative paths are inside the projects folder. */
  path?: string
}

/** A project file read for the editor. */
export interface LoadedProject {
  bytes: Uint8Array
  /** The file's name, which the editor turns into the project title. */
  name: string
  path: string
}

/**
 * Where projects are saved unless the caller names somewhere else.
 * @param documentsPath the OS documents directory
 * @returns the projects folder
 */
export function projectsDirectory(documentsPath: string): string {
  return join(appDirectory(documentsPath), 'Projects')
}

/**
 * Turn a project title into a file name every desktop platform accepts.
 * @param title what the project is called in the editor
 * @returns the file name, `.sb3` included
 */
export function projectFileName(title: string): string {
  const cleaned = [...title]
    .map((character) =>
      UNSAFE_CHARACTERS.has(character) || character.charCodeAt(0) < FIRST_PRINTABLE ? '-' : character,
    )
    .join('')
    .slice(0, MAX_NAME_LENGTH)
    .trim()
    // Windows drops trailing dots and spaces, so a name ending in them is not the name it gets.
    .replace(/[. ]+$/, '')
  const reserved = RESERVED_NAMES.test(cleaned.split('.')[0] ?? '')
  return `${cleaned === '' || reserved ? DEFAULT_PROJECT_NAME : cleaned}.sb3`
}

/**
 * Work out where a project should be saved.
 * @param directory the projects folder
 * @param request the title and, optionally, the path asked for
 * @returns the absolute path to write
 */
export function resolveSavePath(directory: string, request: SaveProjectRequest): string {
  if (request.path === undefined) return join(directory, projectFileName(request.title))

  const path = isAbsolute(request.path) ? request.path : resolve(directory, request.path)
  const extension = extname(path).toLowerCase()
  if (extension === '') return `${path}.sb3`
  if (extension !== '.sb3') {
    throw new Error(`Projects are saved as .sb3 files, but "${request.path}" names a ${extension} file.`)
  }
  return path
}

/**
 * Write a project the editor serialized.
 * @param directory the projects folder
 * @param bytes the .sb3 file's contents
 * @param request the title and, optionally, the path asked for
 * @returns where the file was written
 */
export async function saveProjectFile(
  directory: string,
  bytes: unknown,
  request: unknown,
): Promise<{ path: string }> {
  // The renderer is outside this process, so what it sent is checked here.
  if (!(bytes instanceof Uint8Array)) throw new Error('saveProjectFile: the project data must be a Uint8Array.')
  if (!isSaveProjectRequest(request)) {
    throw new Error('saveProjectFile: the request must carry a string title and, optionally, a string path.')
  }

  const path = resolveSavePath(directory, request)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
  return { path }
}

/**
 * Whether what the renderer sent is a well-formed save request.
 * @param request what arrived over IPC
 * @returns true when it has a string title, and a string path if any
 */
function isSaveProjectRequest(request: unknown): request is SaveProjectRequest {
  if (request === null || typeof request !== 'object') return false
  const { title, path } = request as Record<string, unknown>
  return typeof title === 'string' && (path === undefined || typeof path === 'string')
}

/**
 * Read a project file for the editor to open.
 * @param directory the projects folder, which relative paths are inside
 * @param requested the path the caller named
 * @returns the file's contents, name and full path
 */
export async function loadProjectFile(directory: string, requested: unknown): Promise<LoadedProject> {
  if (typeof requested !== 'string' || requested === '') {
    throw new Error('loadProjectFile: the path must be a non-empty string.')
  }
  const path = isAbsolute(requested) ? requested : resolve(directory, requested)
  if (!OPENABLE_EXTENSIONS.includes(extname(path).toLowerCase())) {
    throw new Error(`"${requested}" is not a Scratch project; open a .sb3, .sb2 or .sb file.`)
  }

  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (error) {
    const failure = error as NodeJS.ErrnoException
    throw new Error(
      failure.code === 'ENOENT'
        ? `There is no project file at ${path}.`
        : `Could not read ${path}: ${failure.message}`,
    )
  }
  // A copy of exactly the file's bytes, rather than a view into a buffer that may hold more.
  return { bytes: new Uint8Array(bytes), name: basename(path), path }
}
