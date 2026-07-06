/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output bundles all deps (incl. workspace packages) into a
  // self-contained server directory. Netlify-plugin-nextjs uses this output
  // directly, avoiding the ESM/CJS package.json inheritance issues that
  // plague pnpm-workspace monorepos.
  output: 'standalone',
  // Tell Next where the monorepo root is so workspace files are traced.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  // The legal vertical reads prompts + templates from disk at runtime via
  // `readFileSync(resolve(here, '..', '..', 'templates', ...))`. Next's
  // tracer can't follow dynamic paths so the .md/.json files don't get
  // bundled into the serverless function. Force-include them.
  outputFileTracingIncludes: {
    '/api/**/*': ['../../verticals/legal/templates/**/*'],
  },
  transpilePackages: [
    '@exsto/legal',
    '@exsto/mcp-tools',
    '@exsto/primitives',
    '@exsto/shared',
    '@exsto/substrate',
  ],
  // pdf-parse pulls in pdfjs-dist, whose ESM throws "Object.defineProperty called
  // on non-object" when webpack bundles it into the server runtime. Externalize it
  // (and mammoth) so they're require()'d natively at runtime — the documented fix,
  // and the same approach used for pg / the Anthropic SDK. Powers the document
  // upload in the Templates importer and the assistant chat's attach-a-file.
  //
  // @react-pdf/renderer must NOT be webpack-bundled: bundled, its react-reconciler
  // binds to Next's vendored server React, whose shared internals lack the field
  // the reconciler reads — every server-side invoice render (Settings preview,
  // View/Download, email attachment) dies with "Cannot read properties of
  // undefined (reading 'S')" (diegomura/react-pdf#2966, #3285). Listing it here
  // is necessary but NOT sufficient: the externals check resolves the package
  // FROM THIS APP, and with pnpm's strict node_modules a dependency of
  // @exsto/legal alone isn't resolvable here, so Next silently fell back to
  // bundling. That's why @react-pdf/renderer is also a direct dependency in this
  // app's package.json — remove it there and this entry stops working again.
  serverExternalPackages: [
    'pg',
    '@anthropic-ai/sdk',
    'pdf-parse',
    'pdfjs-dist',
    'mammoth',
    '@react-pdf/renderer',
    // The Stripe server SDK (used by the payments adapter / API routes) is a
    // Node-native library; require() it at runtime rather than webpack-bundling
    // it into the serverless function (same rationale as pg / the Anthropic SDK).
    'stripe',
  ],
  eslint: { ignoreDuringBuilds: true },
}

export default nextConfig
