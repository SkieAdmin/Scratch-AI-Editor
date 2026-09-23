// Copies the built editor and the sandboxed preload into place for packaging.
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const GUI_BUILD = join(PACKAGE_ROOT, '..', 'scratch-gui', 'build')
const RENDERER = join(PACKAGE_ROOT, 'renderer')

/**
 * The editor build also emits standalone, player, blocks-only and
 * compatibility-testing pages. Those are development examples the app never
 * loads, and together they outweigh everything it does load.
 */
const UNUSED_BUNDLES = [
  'blocksonly.js',
  'blocks-only.html',
  'compatibilitytesting.js',
  'compatibility-testing.html',
  'guistandalone.js',
  'player.js',
  'player.html',
  'standalone.html',
]

/**
 * Decide whether a file belongs in the app.
 *
 * Source maps roughly triple the installer's size and are only useful with
 * devtools open against a source checkout, so they stay out too.
 * @param {string} source the file being considered
 * @returns {boolean} true to copy it
 */
const isShippable = (source) => !source.endsWith('.map') && !UNUSED_BUNDLES.some((name) => source.endsWith(name))

/**
 * Report the total size of a directory tree.
 * @param {string} directory the tree to measure
 * @returns {Promise<number>} its size in bytes
 */
async function treeSize(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return treeSize(path)
      return (await stat(path)).size
    }),
  )
  return sizes.reduce((total, size) => total + size, 0)
}

await stat(GUI_BUILD).catch(() => {
  throw new Error(
    `The editor bundle is missing at ${GUI_BUILD}. ` +
      'Run `npm run build:dev --workspace @scratch/scratch-gui` first.',
  )
})

await rm(RENDERER, { force: true, recursive: true })
await mkdir(RENDERER, { recursive: true })
await cp(GUI_BUILD, RENDERER, { recursive: true, filter: isShippable })

// Electron loads the preload in a sandbox, where only CommonJS works, so it is
// copied verbatim rather than compiled with the rest of the main process.
await cp(join(PACKAGE_ROOT, 'src', 'preload.cjs'), join(PACKAGE_ROOT, 'dist', 'preload.cjs'))

const megabytes = Math.round((await treeSize(RENDERER)) / 1024 / 1024)
process.stdout.write(`Staged the editor into renderer/ (${megabytes} MB) and copied the preload.\n`)
