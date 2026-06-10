// Streamable HTTP transport for the MCP server (spec-compliant, stateless JSON).
//
// Each POST /mcp gets a fresh transport + server bound to THIS request's principal
// (stateless mode: `sessionIdGenerator: undefined`). The tenant + actor come from
// validated request headers and are bound server-side; they are never taken from
// the JSON-RPC payload, so a client cannot pick its own tenant. In a real
// deployment the headers would be set by an authenticating gateway / the MCP auth
// flow (the DB role is still the non-owner `authenticated` role — ADR 0037).
import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { ActionContext } from '@exsto/substrate'
import { buildMcpServer } from './server.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

// Derive and validate the principal from headers. Returns null if absent/malformed.
function principalFromHeaders(req: IncomingMessage): ActionContext | null {
  const tenantId = header(req, 'x-tenant-id')
  const actorId = header(req, 'x-actor-id')
  if (!tenantId || !actorId || !UUID_RE.test(tenantId) || !UUID_RE.test(actorId)) {
    return null
  }
  return { tenantId, actorId }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw.length ? JSON.parse(raw) : undefined
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function createHttpServer(): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { status: 'ok', server: 'exsto-substrate-mcp-server' })
      return
    }

    if (req.method === 'POST' && req.url === '/mcp') {
      const ctx = principalFromHeaders(req)
      if (!ctx) {
        sendJson(res, 401, {
          error: 'Missing or invalid x-tenant-id / x-actor-id headers (must be UUIDs).',
        })
        return
      }

      let body: unknown
      try {
        body = await readJsonBody(req)
      } catch {
        sendJson(res, 400, { error: 'Request body must be valid JSON.' })
        return
      }

      // Stateless: one transport + server per request, bound to this principal.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      res.on('close', () => {
        void transport.close()
      })
      const server = buildMcpServer(ctx)
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
      return
    }

    sendJson(res, 404, { error: 'Not found. MCP endpoint is POST /mcp; health is GET /health.' })
  })
}

export async function startHttpServer(
  port = Number(process.env.PORT ?? 4000),
): Promise<http.Server> {
  const server = createHttpServer()
  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => resolve())
    server.on('error', reject)
  })
  console.error(`exsto MCP server (streamable HTTP) on http://localhost:${port}/mcp`)
  return server
}
