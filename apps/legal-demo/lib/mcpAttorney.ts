import { readSession } from './auth'

export interface McpCall<I = unknown> {
  toolName: string
  input?: I
}

interface McpEnvelope<O> {
  result: O
}

export async function callAttorneyMcp<O = unknown, I = unknown>(req: McpCall<I>): Promise<O> {
  const session = readSession()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (session) {
    headers['x-actor-id'] = session.actorId
    headers['x-tenant-id'] = session.tenantId
  }
  const res = await fetch('/api/attorney/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.text()
      const parsed = body ? JSON.parse(body) : null
      detail = parsed?.error ?? body
    } catch {
      // ignore
    }
    throw new Error(`Request failed (${res.status})${detail ? `: ${detail}` : ''}`)
  }
  const data = (await res.json()) as McpEnvelope<O>
  return data.result
}
