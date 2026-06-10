// REST/OpenAPI adapter HTTP server. A thin sibling to the MCP server over the
// SAME operation core (ADR 0038): each request authenticates, derives the tenant
// from the API key, then delegates to `findTool(name).handler(ctx, input)` — the
// exact registry the MCP adapter dispatches to. This file issues NO substrate SQL.
import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { findTool } from '@exsto/mcp-tools'
import type { ActionContext } from '@exsto/substrate'
import { extractApiKey, resolvePrincipal } from './auth.js'
import { SYSTEM_TOOLS, pathToToolName } from './catalog.js'
import { buildOpenApiSpec, API_VERSION } from './openapi.js'
import { checkRateLimit } from './ratelimit.js'
import {
  claimIdempotency,
  completeIdempotency,
  releaseIdempotency,
  requestFingerprint,
} from './idempotency.js'
import { ApiError, toErrorResponse } from './errors.js'

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must be valid JSON.')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(400, 'invalid_body', 'Request body must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

const DOCS_HTML = `<!doctype html><html><head><meta charset="utf-8"/><title>Exsto REST API</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body><redoc spec-url="/${API_VERSION}/openapi.json"></redoc>
<script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script></body></html>`

async function handleToolCall(
  req: IncomingMessage,
  res: ServerResponse,
  toolPath: string,
): Promise<void> {
  // 1. Authenticate and derive the principal (tenant + actor) server-side.
  const rawKey = extractApiKey(req)
  if (!rawKey)
    throw new ApiError(
      401,
      'unauthorized',
      'Provide an API key via Authorization: Bearer or X-API-Key.',
    )
  const ctx: ActionContext = await resolvePrincipal(rawKey)

  // 2. Rate limit per tenant.
  const rate = checkRateLimit(ctx.tenantId)
  const rateHeaders = {
    'x-ratelimit-limit': String(rate.limit),
    'x-ratelimit-remaining': String(rate.remaining),
  }
  if (!rate.allowed) {
    throw new ApiError(429, 'rate_limited', 'Rate limit exceeded.', {
      retryAfterSeconds: rate.retryAfterSeconds,
    })
  }

  // 3. Resolve the operation from the catalog (system tools are not exposed).
  const toolName = pathToToolName(toolPath)
  if (SYSTEM_TOOLS.has(toolName)) {
    throw new ApiError(
      404,
      'not_found',
      `Operation ${toolName} is not available on the REST surface.`,
    )
  }
  const tool = findTool(toolName)
  if (!tool) throw new ApiError(404, 'not_found', `No such operation: ${toolName}.`)

  const input = await readJsonBody(req)
  const isWrite = tool.mode === 'write'
  const idempotencyKey = req.headers['idempotency-key']
  const idemKey =
    typeof idempotencyKey === 'string' && idempotencyKey.trim() ? idempotencyKey.trim() : null

  // 4. Durably claim the idempotency key for writes (replay / dedupe / reject).
  if (isWrite && idemKey) {
    const claim = await claimIdempotency(ctx, idemKey, requestFingerprint('POST', toolPath, input))
    if (claim.outcome === 'replay') {
      send(res, claim.status, claim.body, { ...rateHeaders, 'idempotency-replayed': 'true' })
      return
    }
    if (claim.outcome === 'in_progress') {
      throw new ApiError(
        409,
        'idempotency_in_progress',
        'A request with this Idempotency-Key is still being processed.',
      )
    }
    if (claim.outcome === 'mismatch') {
      throw new ApiError(
        422,
        'idempotency_key_reuse',
        'This Idempotency-Key was already used with a different request body.',
      )
    }
  }

  // 5. Delegate to the SAME core operation the MCP tool calls. On failure, release
  //    the claim so a retry can re-run; on success, persist the response.
  let result: unknown
  try {
    result = await tool.handler(ctx, input)
  } catch (err) {
    if (isWrite && idemKey) await releaseIdempotency(ctx, idemKey).catch(() => {})
    throw err
  }
  const body = { data: result }
  if (isWrite && idemKey) await completeIdempotency(ctx, idemKey, 200, body)
  send(res, 200, body, rateHeaders)
}

export function createRestServer(): http.Server {
  return http.createServer((req, res) => {
    void (async () => {
      try {
        const url = (req.url ?? '').split('?')[0] ?? ''

        if (req.method === 'GET' && url === '/health') {
          send(res, 200, { status: 'ok', api: API_VERSION })
          return
        }
        if (req.method === 'GET' && url === `/${API_VERSION}/openapi.json`) {
          send(res, 200, buildOpenApiSpec())
          return
        }
        if (req.method === 'GET' && url === `/${API_VERSION}/docs`) {
          res.writeHead(200, { 'content-type': 'text/html' })
          res.end(DOCS_HTML)
          return
        }

        const prefix = `/${API_VERSION}/`
        if (url.startsWith(prefix)) {
          if (req.method !== 'POST') {
            throw new ApiError(405, 'method_not_allowed', 'Operations are invoked with POST.')
          }
          await handleToolCall(req, res, url.slice(prefix.length))
          return
        }

        throw new ApiError(404, 'not_found', 'Not found.')
      } catch (err) {
        const { status, body } = toErrorResponse(err)
        const headers: Record<string, string> =
          status === 429 && err instanceof ApiError && err.details
            ? {
                'retry-after': String(
                  (err.details as { retryAfterSeconds: number }).retryAfterSeconds,
                ),
              }
            : {}
        send(res, status, body, headers)
      }
    })()
  })
}

export async function startRestServer(
  port = Number(process.env.PORT ?? 4001),
): Promise<http.Server> {
  const server = createRestServer()
  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => resolve())
    server.on('error', reject)
  })
  console.error(`exsto REST API on http://localhost:${port} (docs: /${API_VERSION}/docs)`)
  return server
}
