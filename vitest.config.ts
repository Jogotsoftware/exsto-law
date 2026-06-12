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
      '@exsto/mcp-tools': pkg('mcp-tools'),
      // More-specific subpath must precede '@exsto/legal' so Vite's prefix match
      // doesn't rewrite '@exsto/legal/mcp' to '<legal>/dist/index.js/mcp'.
      '@exsto/legal/mcp': fileURLToPath(
        new URL('./verticals/legal/dist/mcp/index.js', import.meta.url),
      ),
      '@exsto/legal': fileURLToPath(new URL('./verticals/legal/dist/index.js', import.meta.url)),
      // legal-demo uses the `@/` path alias for app-local imports. Route-handler
      // tests import those files, so map `@/` to the app root here too. No other
      // workspace uses `@/`, so this is safe globally.
      '@/': fileURLToPath(new URL('./apps/legal-demo/', import.meta.url)),
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
