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
  serverExternalPackages: ['pg', '@anthropic-ai/sdk'],
  eslint: { ignoreDuringBuilds: true },
}

export default nextConfig
