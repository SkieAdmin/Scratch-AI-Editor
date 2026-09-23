import { eslintConfigScratch } from 'eslint-config-scratch'
import { globalIgnores } from 'eslint/config'
import globals from 'globals'

export default eslintConfigScratch.defineConfig(
  eslintConfigScratch.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // This package runs in Node, so Node globals are available everywhere in it.
    files: ['*', 'scripts/**', 'src/**', 'test/**'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/preload.cjs'],
    languageOptions: { globals: globals.browser },
  },
  globalIgnores(['coverage/**', 'dist/**', 'node_modules/**', 'renderer/**', 'release*/**', 'test-results/**']),
)
