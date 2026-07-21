import { readDevSession } from './auth'

export interface McpCall<I = unknown> {
  toolName: string
  input?: I
}

interface McpEnvelope<O> {
  result: O
}

// Thrown on a 401 so callers/UI can bounce to sign-in distinctly from other
// failures.
export class SessionExpiredError extends Error {
  constructor(message = 'Your session expired — sign in again.') {
    super(message)
    this.name = 'SessionExpiredError'
  }
}

// Thrown on any other non-2xx. Carries the HTTP status and the server's raw
// `error` detail (undecorated) alongside the existing `Request failed (…): …`
// message, so a caller that cares — e.g. the runner's Continue button
// distinguishing a domain guard rejection (409) from a real failure — can branch
// on `status` without string-matching. `message` is unchanged for every existing
// `e instanceof Error ? e.message : String(e)` catch site.
export class McpToolError extends Error {
  status: number
  detail: string
  constructor(status: number, detail: string) {
    super(`Request failed (${status})${detail ? `: ${detail}` : ''}`)
    this.name = 'McpToolError'
    this.status = status
    this.detail = detail
  }
}

const IS_DEV = process.env.NODE_ENV !== 'production'

export async function callAttorneyMcp<O = unknown, I = unknown>(req: McpCall<I>): Promise<O> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  // PRODUCTION: send NO identity headers. The signed httpOnly cookie is attached
  // automatically on same-origin requests and is the only thing the server
  // trusts. DEV ONLY: forward the demo shim as x-actor-id / x-tenant-id so the
  // `?demo_user=` flow works without OAuth (the route accepts these headers only
  // when NODE_ENV !== 'production').
  if (IS_DEV) {
    const dev = readDevSession()
    if (dev) {
      headers['x-actor-id'] = dev.actorId
      headers['x-tenant-id'] = dev.tenantId
    }
  }

  const res = await fetch('/api/attorney/mcp', {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify(req),
  })
  if (res.status === 401) {
    // Session expired / not signed in: bounce the whole UI to sign-in. We also
    // throw so the calling component stops its own work; the redirect is what
    // the user actually sees.
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.location.href = '/'
    }
    throw new SessionExpiredError()
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
    throw new McpToolError(res.status, detail)
  }
  const data = (await res.json()) as McpEnvelope<O>
  return data.result
}
