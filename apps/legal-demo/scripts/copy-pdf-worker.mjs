// ESIGN-UNIFY-1 ES-2 (§5.4) — stage the pdfjs worker as a same-origin static
// asset. pdfjs-dist runs its parser in a Web Worker; the worker file must be a
// real URL. Bundling it via `new URL(..., import.meta.url)` fights Next's
// serverExternalPackages entry for pdfjs-dist (the SSR compile of any client
// component that imports the hook tries to resolve the asset and dies), and a
// CDN workerSrc is banned (CSP + offline discipline). So: copy the exact
// worker of the INSTALLED pdfjs-dist version into public/ before build/dev —
// the version can never drift from the API the app bundles.
//
// Wired into the app's `build` and `dev` scripts directly (not a pre* lifecycle
// hook, which pnpm config can silently disable). The copied file is
// gitignored; every build re-stages it.
import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '..', 'package.json'))

const workerSrc = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
const outDir = join(here, '..', 'public', 'pdf-worker')
mkdirSync(outDir, { recursive: true })
copyFileSync(workerSrc, join(outDir, 'pdf.worker.min.mjs'))
console.log(`pdf worker staged: ${workerSrc} -> public/pdf-worker/pdf.worker.min.mjs`)
