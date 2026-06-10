// Generate docs/REST_API.md from the OpenAPI spec — which is itself generated
// from the tool catalog. One source of truth: catalog -> OpenAPI -> docs.
// Run after build: node scripts/gen-docs.mjs
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildOpenApiSpec } from '../dist/openapi.js'

const here = dirname(fileURLToPath(import.meta.url))
const outPath = join(here, '..', '..', '..', 'docs', 'REST_API.md')
const spec = buildOpenApiSpec()

const lines = []
lines.push('# Exsto Substrate REST API')
lines.push('')
lines.push('> Generated from the OpenAPI spec (`GET /v1/openapi.json`), which is itself generated')
lines.push(
  '> from the tool catalog. Do not edit by hand — run `pnpm --filter @exsto/rest-api gen:docs`.',
)
lines.push('')
lines.push(spec.info.description)
lines.push('')
lines.push('## Versioning')
lines.push('All endpoints are under `/v1`. Breaking changes ship under a new version prefix.')
lines.push('')
lines.push('## Authentication & tenancy')
lines.push('Authenticate with an API key: `Authorization: Bearer <key>` or `X-API-Key: <key>`.')
lines.push(
  'The **tenant and actor are derived from the key server-side** and are never read from the',
)
lines.push(
  'request — a client cannot choose its own tenant. Writes flow through the append-only action',
)
lines.push('layer; reads are tenant-scoped. Mint a key with `scripts/create-api-key.mjs`.')
lines.push('')
lines.push('## Idempotency')
lines.push(
  'Write requests accept an optional `Idempotency-Key` header. Replaying a write with the same',
)
lines.push(
  'key returns the original response (header `idempotency-replayed: true`) instead of submitting',
)
lines.push('a second action.')
lines.push('')
lines.push('## Rate limiting')
lines.push(
  'Per-tenant fixed window. Responses carry `X-RateLimit-Limit` / `X-RateLimit-Remaining`; a 429',
)
lines.push('carries `Retry-After` (seconds).')
lines.push('')
lines.push('## Errors')
lines.push('Every error returns `{ "error": { "code", "message", "details"? } }`:')
lines.push('')
lines.push('| Status | When |')
lines.push('|---|---|')
lines.push('| 400 | Malformed JSON body |')
lines.push('| 401 | Missing/invalid API key |')
lines.push('| 403 | Tenancy/governance denied |')
lines.push('| 404 | Unknown or non-exposed operation |')
lines.push('| 405 | Non-POST on an operation path |')
lines.push('| 409 | Contestation detected |')
lines.push('| 422 | Operation understood but could not be completed |')
lines.push('| 429 | Rate limit exceeded |')
lines.push('| 500 | Unexpected server error |')
lines.push('')
lines.push('## Endpoints')
lines.push('')
lines.push(
  'Each operation maps 1:1 to a substrate tool of the same name (`entity.create` -> `POST /v1/entity/create`), delegating to the same operation core as the MCP adapter.',
)
lines.push('')
lines.push('| Method & path | Operation | Mode | Summary |')
lines.push('|---|---|---|---|')
const paths = spec.paths
for (const p of Object.keys(paths).sort()) {
  const op = paths[p].post
  const mode = op['x-exsto-mode']
  lines.push(`| \`POST ${p}\` | \`${op.operationId}\` | ${mode} | ${op.summary} |`)
}
lines.push('')
lines.push('Interactive docs: `GET /v1/docs` (Redoc over `/v1/openapi.json`).')
lines.push('')

writeFileSync(outPath, lines.join('\n'))
console.log(`Wrote ${outPath} (${Object.keys(paths).length} endpoints).`)
