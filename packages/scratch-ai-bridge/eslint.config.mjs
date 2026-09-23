import { eslintConfigScratch } from 'eslint-config-scratch'
import { globalIgnores } from 'eslint/config'
import globals from 'globals'

export default eslintConfigScratch.defineConfig(
  eslintConfigScratch.recommended,
  {
    files: ['src/**'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // This package runs in Node, so Node globals are available everywhere in it.
    files: ['*', 'src/**', 'test/**'],
    languageOptions: {
      globals: globals.node,
    },
  },
  globalIgnores(['coverage/**', 'dist/**', 'node_modules/**', 'test-results/**']),
)
