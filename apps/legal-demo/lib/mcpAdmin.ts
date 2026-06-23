// Client wrapper for the admin-console MCP route (/admin/api/mcp). The admin
// session is an httpOnly cookie attached automatically on same-origin requests —
// the only thing the server trusts. On 401 the whole console bounces to the admin
// sign-in page.
export interface AdminMcpCall<I = unknown> {
  toolName: string
  input?: I
}

interface McpEnvelope<O> {
  result: O
}

export class AdminSessionExpiredError extends Error {
  constructor(message = 'Your admin session expired — sign in again.') {
    super(message)
    this.name = 'AdminSessionExpiredError'
  }
}

export async function callAdminMcp<O = unknown, I = unknown>(req: AdminMcpCall<I>): Promise<O> {
  const res = await fetch('/admin/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(req),
  })
  if (res.status === 401) {
    if (typeof window !== 'undefined' && window.location.pathname !== '/admin') {
      window.location.href = '/admin'
    }
    throw new AdminSessionExpiredError()
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

export interface AdminSession {
  email: string
  displayName: string
  actorId: string
  tenantId: string
}

// Ask the server whether we have a valid admin session (httpOnly cookie can't be
// read client-side). Returns null when not signed in.
export async function fetchAdminSession(): Promise<AdminSession | null> {
  try {
    const res = await fetch('/admin/api/auth/me', { credentials: 'same-origin' })
    if (!res.ok) return null
    return (await res.json()) as AdminSession
  } catch {
    return null
  }
}

export async function adminLogout(): Promise<void> {
  try {
    await fetch('/admin/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  } catch {
    // ignore
  }
}
