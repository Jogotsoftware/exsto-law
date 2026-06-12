// Client-portal AUTH + AUTHORIZATION boundary (feat/client-portal-pr1).
//
// Security properties under test:
//   • resolveClientCtx gating: production no-cookie → 401; forged/tampered
//     cookie → 401; a valid cookie for a seeded client → resolves + dispatches.
//   • PER-MATTER AUTHORIZATION (critical): a cookie bound to matter A returns the
//     same 404 as an unknown tool for matter B's timeline — no oracle.
//   • ANTI-ENUMERATION: /api/client/auth/request returns 200 for an unknown
//     email and queues nothing.
//   • AUTHED ALLOWLIST: attorney/write tools are not client-portal-authed tools.
//
// DB-gated like tests/invariants: the success + authorization cases create real
// matters/contacts, so they skip (not fail) when no DB URL is wired. The pure
// cases (no-cookie 401, allowlist, anti-enumeration with an unmatchable email)
// run without a DB.
//
// Requires a prior build: the route handlers + lib are aliased to apps/legal-demo
// (the `@/` alias in vitest.config.ts), and @exsto/legal resolves to its dist.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'

const SECRET = 'test-session-secret-32-bytes-minimum!!'
const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR = '00000000-0000-0000-0001-000000000005'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const dbRun = describe.skipIf(!url)

function withSecret() {
  const prior = process.env.OAUTH_STATE_SECRET
  process.env.OAUTH_STATE_SECRET = SECRET
  return () => {
    if (prior === undefined) delete process.env.OAUTH_STATE_SECRET
    else process.env.OAUTH_STATE_SECRET = prior
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Pure (no DB): authed allowlist excludes attorney/write tools.
// ───────────────────────────────────────────────────────────────────────────
describe('client portal AUTHED tool allowlist (no DB)', () => {
  // The first dynamic import('@exsto/legal/mcp') cold-loads the whole vertical
  // (primitives/handlers/tools) and can exceed the 5s default under full-suite
  // parallel load — it's import cost, not logic. Warm it once here.
  beforeAll(async () => {
    await import('@exsto/legal/mcp')
  }, 30_000)

  it('exposes exactly the two read-only client tools', async () => {
    const { CLIENT_PORTAL_AUTHED_TOOLS } = await import('@exsto/legal/mcp')
    expect([...CLIENT_PORTAL_AUTHED_TOOLS].sort()).toEqual(
      ['legal.client.matter_timeline', 'legal.client.matters'].sort(),
    )
  })

  it('excludes attorney/research/write tools', async () => {
    const { isClientPortalAuthedTool } = await import('@exsto/legal/mcp')
    for (const blocked of [
      'legal.research.ask',
      'legal.draft.generate',
      'legal.settings.update',
      'legal.integration.connect',
      'legal.matter.history',
      'legal.matter.get',
      'legal.matter.list',
      'legal.booking.submit',
      'legal.mail.reply',
    ]) {
      expect(isClientPortalAuthedTool(blocked)).toBe(false)
    }
  })

  it('every authed-allowlisted tool is registered and read-mode', async () => {
    await import('@exsto/legal/mcp')
    const { findTool } = await import('@exsto/mcp-tools')
    const { CLIENT_PORTAL_AUTHED_TOOLS } = await import('@exsto/legal/mcp')
    for (const name of CLIENT_PORTAL_AUTHED_TOOLS) {
      const tool = findTool(name) as { mode?: string } | undefined
      expect(tool, `${name} should resolve`).toBeTruthy()
      expect(tool!.mode, `${name} should be read-mode`).toBe('read')
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Pure (no DB): production cookie gating on the authed route.
// ───────────────────────────────────────────────────────────────────────────
describe('/api/client/portal/mcp resolveClientCtx — cookie gating (no DB)', () => {
  let restore: () => void
  // Warm the route module (cold-loads the vertical via side-effect import) once.
  beforeAll(async () => {
    restore = withSecret()
    await import('@/app/api/client/portal/mcp/route')
  }, 30_000)
  afterAll(() => restore())

  function mcpRequest(headers: Record<string, string>): Request {
    return new Request('https://app.test/api/client/portal/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ toolName: 'legal.client.matters' }),
    })
  }

  it('rejects with 401 when there is no cookie', async () => {
    const { POST } = await import('@/app/api/client/portal/mcp/route')
    const res = await POST(mcpRequest({}))
    expect(res.status).toBe(401)
  })

  it('rejects with 401 for a forged/tampered cookie', async () => {
    const { POST } = await import('@/app/api/client/portal/mcp/route')
    const { signClientSession, CLIENT_SESSION_COOKIE_NAME } = await import('@/lib/clientSession')
    const token = signClientSession({
      clientContactId: randomUUID(),
      tenantId: TENANT,
      matterIds: [randomUUID()],
      email: 'x@y.test',
      displayName: 'X',
    })
    const tampered = token.slice(0, token.indexOf('.')) + '.deadbeef'
    const res = await POST(
      mcpRequest({ cookie: `${CLIENT_SESSION_COOKIE_NAME}=${encodeURIComponent(tampered)}` }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 (not 401) for a non-allowlisted tool name even before auth — no oracle', async () => {
    const { POST } = await import('@/app/api/client/portal/mcp/route')
    const res = await POST(
      new Request('https://app.test/api/client/portal/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toolName: 'legal.research.ask' }),
      }),
    )
    expect(res.status).toBe(404)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Pure (no DB): anti-enumeration on the request route for an unmatchable email.
// An email with no '@' can never match a contact and never hits the DB, so this
// runs without a DB and proves the neutral 200 + no-queue path.
// ───────────────────────────────────────────────────────────────────────────
describe('/api/client/auth/request — anti-enumeration (no DB)', () => {
  let restore: () => void
  beforeAll(() => {
    restore = withSecret()
  })
  afterAll(() => restore())

  it('returns a neutral 200 for an obviously-unknown (malformed) email', async () => {
    const { POST } = await import('@/app/api/client/auth/request/route')
    const res = await POST(
      new Request('https://app.test/api/client/auth/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { message?: string }
    expect(body.message).toMatch(/if that email is on file/i)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// DB-gated: resolve a real client, prove the success path + per-matter authz +
// anti-enumeration (unknown but well-formed email queues nothing).
// ───────────────────────────────────────────────────────────────────────────
dbRun('client portal auth + authorization (live DB)', { timeout: 90_000 }, () => {
  let restore: () => void
  const ctx = { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR }

  // Two independently-owned matters: client A owns matter A; client B owns B.
  let clientAContactId = ''
  let matterAId = ''
  let matterBId = ''
  let clientAEmail = ''

  function farFutureSlot() {
    const daysAhead = 60 + Math.floor(Math.random() * 200000)
    const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
    start.setUTCHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 2) * 30, 0, 0)
    const end = new Date(start.getTime() + 30 * 60 * 1000)
    return { startIso: start.toISOString(), endIso: end.toISOString() }
  }

  beforeAll(async () => {
    restore = withSecret()
    const { submitBooking, findClientContactByEmail } = await import('@exsto/legal')

    clientAEmail = `portal-a-${randomUUID().slice(0, 8)}@example.test`
    const slotA = farFutureSlot()
    const resA = await submitBooking(ctx, {
      clientFullName: 'Portal Client A',
      clientEmail: clientAEmail,
      attributionSource: 'client-portal-test',
      serviceKey: 'something_else',
      intakeResponses: { matter_description: 'portal A' },
      scheduledAtIso: slotA.startIso,
      scheduledEndIso: slotA.endIso,
    })
    matterAId = (resA.effects[0] as { matterEntityId: string }).matterEntityId

    const slotB = farFutureSlot()
    const resB = await submitBooking(ctx, {
      clientFullName: 'Portal Client B',
      clientEmail: `portal-b-${randomUUID().slice(0, 8)}@example.test`,
      attributionSource: 'client-portal-test',
      serviceKey: 'something_else',
      intakeResponses: { matter_description: 'portal B' },
      scheduledAtIso: slotB.startIso,
      scheduledEndIso: slotB.endIso,
    })
    matterBId = (resB.effects[0] as { matterEntityId: string }).matterEntityId

    const contact = await findClientContactByEmail(clientAEmail)
    clientAContactId = contact!.clientContactId
  })

  afterAll(async () => {
    restore()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  function cookieFor(contactId: string, matterIds: string[]): Promise<string> {
    return import('@/lib/clientSession').then(
      ({ signClientSession, CLIENT_SESSION_COOKIE_NAME }) => {
        const token = signClientSession({
          clientContactId: contactId,
          tenantId: TENANT,
          matterIds,
          email: clientAEmail,
          displayName: 'Portal Client A',
        })
        return `${CLIENT_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`
      },
    )
  }

  function call(toolName: string, input: unknown, cookie?: string): Promise<Response> {
    return import('@/app/api/client/portal/mcp/route').then(({ POST }) =>
      POST(
        new Request('https://app.test/api/client/portal/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(cookie ? { cookie } : {}),
          },
          body: JSON.stringify({ toolName, input }),
        }),
      ),
    )
  }

  it('resolves findClientContactByEmail for a real client and the matter is client_of', async () => {
    const { resolveClientMatterIds } = await import('@exsto/legal')
    expect(clientAContactId).toBeTruthy()
    const ids = await resolveClientMatterIds(TENANT, clientAContactId)
    expect(ids).toContain(matterAId)
    expect(ids).not.toContain(matterBId)
  })

  it('a valid cookie for client A returns A’s timeline (200)', async () => {
    const cookie = await cookieFor(clientAContactId, [matterAId])
    const res = await call('legal.client.matter_timeline', { matterEntityId: matterAId }, cookie)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result?: { timeline?: { matterNumber: string } } }
    expect(body.result?.timeline?.matterNumber).toBeTruthy()
  })

  it('AUTHORIZATION: client A’s cookie returns 404 (no oracle) for matter B’s timeline', async () => {
    const cookie = await cookieFor(clientAContactId, [matterAId])
    const res = await call('legal.client.matter_timeline', { matterEntityId: matterBId }, cookie)
    // Same 404 as an unknown tool: cross-matter access is indistinguishable from
    // "no such tool" — the response is no oracle for matter B's existence.
    expect(res.status).toBe(404)
  })

  it('the matter switcher (legal.client.matters) lists only the client’s own matters', async () => {
    const cookie = await cookieFor(clientAContactId, [matterAId])
    const res = await call('legal.client.matters', {}, cookie)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      result?: { matters?: Array<{ matterEntityId: string }> }
    }
    const ids = (body.result?.matters ?? []).map((m) => m.matterEntityId)
    expect(ids).toContain(matterAId)
    expect(ids).not.toContain(matterBId)
  })

  it('ANTI-ENUMERATION: request for an unknown (well-formed) email returns 200 and queues nothing', async () => {
    const { POST } = await import('@/app/api/client/auth/request/route')
    const unknownEmail = `definitely-not-a-client-${randomUUID().slice(0, 8)}@nope.test`
    const res = await POST(
      new Request('https://app.test/api/client/auth/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: unknownEmail }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { message?: string }
    expect(body.message).toMatch(/if that email is on file/i)

    // Nothing was queued: no worker_job rows reference this address.
    const pg = (await import('pg')).default
    const db = new pg.Pool({ connectionString: url })
    try {
      const jobs = await db.query(
        `SELECT count(*)::int AS n FROM worker_job
         WHERE tenant_id = $1 AND payload::text LIKE '%' || $2 || '%'`,
        [TENANT, unknownEmail],
      )
      expect(jobs.rows[0].n).toBe(0)
    } finally {
      await db.end()
    }
  })
})
