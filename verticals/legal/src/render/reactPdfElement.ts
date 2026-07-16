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
const requireHere = createRequire(import.meta.url)
const reactFromReactPdf = requireHere(
  requireHere.resolve('react', { paths: [requireHere.resolve('@react-pdf/renderer')] }),
) as typeof import('react')

export const h: typeof import('react').createElement = reactFromReactPdf.createElement
