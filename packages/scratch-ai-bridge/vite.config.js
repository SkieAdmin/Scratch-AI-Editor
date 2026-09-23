/// <reference types="vitest/config" />
import dts from 'unplugin-dts/vite'
import { defineConfig } from 'vite'
import packageJson from './package.json'

// Externalize all dependencies, peerDependencies, and optionalDependencies, but not devDependencies.
// Node built-ins are externalized explicitly because this package targets Node, not a browser bundle.
const externalDeps = [
  /^node:/,
  ...[
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {}),
    ...Object.keys(packageJson.optionalDependencies || {}),
  ].map((name) => new RegExp(`^${name}(?:/.*)?$`)),
]

export default defineConfig({
  build: {
    target: 'node20',
    lib: {
      entry: {
        cli: 'src/cli.ts',
        index: 'src/index.ts',
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rolldownOptions: {
      external: externalDeps,
    },
  },
  plugins: [
    // Generate TypeScript declaration files
    dts({
      insertTypesEntry: true,
      tsconfigPath: 'tsconfig.build.json',
    }),
  ],
  test: {
    coverage: {
      exclude: ['bin/**', 'dist/**', 'node_modules/**', 'test/**', 'vite.config.js'],
    },
    reporters: [
      'default',

      // This is mainly interesting for reporting GHA test results on PRs through `publish-unit-test-result-action`,
      // but including it even outside of CI isn't expensive and might help catch configuration issues that would
      // otherwise lead to "CI only" problems.
      'junit',

      // The `github-actions` reporter is added by default if running in GHA, but not if reporters are customized.
      ...(process.env.GITHUB_ACTIONS === 'true' ? ['github-actions'] : []),
    ],
    outputFile: {
      junit: 'test-results/junit.xml',
    },
  },
})
