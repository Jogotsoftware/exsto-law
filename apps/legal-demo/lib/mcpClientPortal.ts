export interface McpCall<I = unknown> {
  toolName: string
  input?: I
}

interface McpEnvelope<O> {
  result: O
}

// Thrown on a 401 so callers can distinguish "session expired / not signed in"
// from other failures; the wrapper also bounces the UI to /portal/login.
export class PortalSessionExpiredError extends Error {
  constructor(message = 'Your session expired — request a new sign-in link.') {
    super(message)
    this.name = 'PortalSessionExpiredError'
  }
}

// Wrapper over the AUTHED client portal route. The signed httpOnly
// exsto_client_session cookie is attached automatically on same-origin requests
// and is the only thing the server trusts — we send NO identity in the body or
// headers. On 401 we bounce the whole UI to the login page.
export async function callClientPortalMcp<O = unknown, I = unknown>(req: McpCall<I>): Promise<O> {
  const res = await fetch('/api/client/portal/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(req),
  })
  if (res.status === 401) {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/portal/login')) {
      window.location.href = '/portal/login'
    }
    throw new PortalSessionExpiredError()
  }
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
