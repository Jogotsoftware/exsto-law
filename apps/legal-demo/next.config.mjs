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
  // @react-pdf/renderer ships the standard-14 font metrics (Helvetica AFM) and
  // fontkit's binary data as data files. Webpack-bundling it into the function
  // strips those files, so at runtime the font lookup returns undefined and the
  // render dies with "Cannot read properties of undefined (reading 'S')" — the
  // invoice-template preview 500 on Settings, and every server-rendered invoice
  // PDF. Externalize it so it (and its @react-pdf/* + fontkit subtree) is required
  // natively at runtime with its data files intact.
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
