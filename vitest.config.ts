import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/dist/index.js`, import.meta.url))

export default defineConfig({
  resolve: {
    // Root-level tests/ is not a workspace member, so @exsto/* are not linked
    // into its node_modules. Alias them to their built dist entrypoints.
    alias: {
      '@exsto/shared': pkg('shared'),
      '@exsto/substrate': pkg('substrate'),
      '@exsto/primitives': pkg('primitives'),
      '@exsto/worker-runtime': fileURLToPath(
        new URL('./workers/runtime/dist/index.js', import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    include: [
      'packages/*/src/**/*.{test,spec}.{ts,tsx}',
      'packages/*/tests/**/*.{test,spec}.{ts,tsx}',
      'apps/*/src/**/*.{test,spec}.{ts,tsx}',
      'apps/*/tests/**/*.{test,spec}.{ts,tsx}',
      'workers/*/src/**/*.{test,spec}.{ts,tsx}',
      'workers/*/tests/**/*.{test,spec}.{ts,tsx}',
      'tests/**/*.{test,spec}.{ts,tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/*/src/**', 'apps/*/src/**', 'workers/*/src/**'],
    },
  },
})
