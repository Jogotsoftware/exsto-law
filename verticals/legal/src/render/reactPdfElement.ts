import { createRequire } from 'node:module'

// The single `createElement` used to build @react-pdf/renderer element trees
// (the invoice PDF and the draft/document PDF). It is bound to the SAME React
// instance react-pdf's reconciler uses — this is load-bearing, not incidental.
//
// Why: @react-pdf/renderer is externalized from the Next server bundle
// (apps/legal-demo/next.config.mjs → serverExternalPackages), so at runtime it is
// require()'d natively and reconciles the tree with the node_modules copy of
// React (18.3.1, whose elements are tagged Symbol.for('react.element')). But this
// vertical is transpiled INTO the Next server bundle, where a bare
// `import { createElement } from 'react'` resolves to Next's own vendored server
// React — a React 19 build whose elements are tagged
// Symbol.for('react.transitional.element'). The two tags differ, so a tree built
// with Next's React fails react-pdf's child validation and every server-side
// render dies with "Minified React error #31 (object with keys
// {$$typeof, type, key, ref, props})". A createRequire()'d require escapes the
// bundler and reaches the externalized module graph, so React is resolved through
// react-pdf itself — guaranteeing element creation and reconciliation share one
// React. Outside Next (workers, tests) this resolves the same single react@18.3.1
// the store dedupes to, so behaviour is unchanged there.
//
// CRITICAL — resolve LAZILY, on the first render, never at module load. This
// module is pulled in by EVERY route that imports @exsto/legal (auth, MCP, etc.),
// not just the two that render a PDF. Next's function tracer cannot follow the
// createRequire below, so @react-pdf/renderer is bundled only into the functions
// that visibly use it — a route like /api/auth/google/init imports @exsto/legal
// for an unrelated handler and does NOT ship react-pdf. Resolving at module load
// therefore threw MODULE_NOT_FOUND there and 500'd the whole route (the "Sign in
// with Google" button). Deferring to the first h() call keeps the resolution on
// the invoice/draft routes, where react-pdf is present.
let cachedCreateElement: typeof import('react').createElement | undefined

function reactPdfCreateElement(): typeof import('react').createElement {
  if (!cachedCreateElement) {
    const requireHere = createRequire(import.meta.url)
    const react = requireHere(
      requireHere.resolve('react', { paths: [requireHere.resolve('@react-pdf/renderer')] }),
    ) as typeof import('react')
    cachedCreateElement = react.createElement
  }
  return cachedCreateElement
}

// A thin wrapper so callers keep writing `h(...)`; the real (react-pdf) createElement
// is resolved + cached on the first invocation. Module load does no resolution.
export const h: typeof import('react').createElement = ((
  ...args: Parameters<typeof import('react').createElement>
) => reactPdfCreateElement()(...args)) as typeof import('react').createElement
