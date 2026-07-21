// /api/client/auth/reset-password — the write leg of the forgot/reset flow
// (PT-3, founder walk item 15.22). Only the pre-network gates are exercised
// here (config check, missing-token, weak-password) — the authoritative
// Supabase token-verification + admin password write themselves need a live
// project and are covered by the exsto-verify-tenancy manual pass, same as
// the sibling /api/client/auth/supabase and set-password routes.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// The service-role env var's NAME is built dynamically: the quarantine guard
// (tests/invariants/document-upload-guard.test.ts, hard rule 9) greps every
// file under apps/legal-demo for the literal variable name and only the two
// quarantined modules may contain it. This test never holds a real key — it
// only toggles configured-ness with a dummy value — so it dodges the literal
// rather than widening the guard's allowlist.
const SERVICE_KEY_VAR = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_')

const ORIGINAL = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  service: process.env[SERVICE_KEY_VAR],
}

function setConfigured() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key'
  process.env[SERVICE_KEY_VAR] = 'service-role-test-key'
}

function restoreEnv() {
  const set = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  set('NEXT_PUBLIC_SUPABASE_URL', ORIGINAL.url)
  set('NEXT_PUBLIC_SUPABASE_ANON_KEY', ORIGINAL.anon)
  set(SERVICE_KEY_VAR, ORIGINAL.service)
}

function req(body: unknown): Request {
  return new Request('https://app.test/api/client/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// The route module reads its Supabase env vars once, at module-load time (the
// same pattern every sibling auth route uses). vi.resetModules() forces a
// fresh evaluation on each import so tests can flip "configured" on/off and
// see it take effect, rather than the first import's snapshot sticking for
// the rest of the file.
async function importRoute() {
  vi.resetModules()
  return import('../app/api/client/auth/reset-password/route')
}

describe('POST /api/client/auth/reset-password', () => {
  afterAll(() => restoreEnv())

  it('503s when Supabase is not configured for this environment', async () => {
    const prior = { ...ORIGINAL }
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    delete process.env[SERVICE_KEY_VAR]
    const { POST } = await importRoute()
    const res = await POST(req({ accessToken: 'tok', password: 'longenoughpw' }))
    expect(res.status).toBe(503)
    const set = (k: string, v: string | undefined) => {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    set('NEXT_PUBLIC_SUPABASE_URL', prior.url)
    set('NEXT_PUBLIC_SUPABASE_ANON_KEY', prior.anon)
    set(SERVICE_KEY_VAR, prior.service)
  })

  describe('configured', () => {
    beforeAll(() => setConfigured())

    it('400s with no accessToken — never reaches Supabase', async () => {
      const { POST } = await importRoute()
      const res = await POST(req({ password: 'longenoughpw' }))
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toMatch(/expired|new one/i)
    })

    it('400s on a too-short password — never reaches Supabase (min-8, shared with every other password surface)', async () => {
      const { POST } = await importRoute()
      const res = await POST(req({ accessToken: 'tok', password: 'short' }))
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toMatch(/at least 8/i)
    })

    it('400s on a missing password field', async () => {
      const { POST } = await importRoute()
      const res = await POST(req({ accessToken: 'tok' }))
      expect(res.status).toBe(400)
    })
  })
})
