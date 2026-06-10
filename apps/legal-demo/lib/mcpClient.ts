export interface McpCall<I = unknown> {
  toolName: string
  input?: I
}

interface McpEnvelope<O> {
  result: O
}

export async function callClientMcp<O = unknown, I = unknown>(req: McpCall<I>): Promise<O> {
  const res = await fetch('/api/client/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
