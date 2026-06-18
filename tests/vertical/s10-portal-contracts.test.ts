// S10 — Client Portal & Accounts · contract checklist (HELD round)
//
// This worker is HELD pending its dependencies (S5 booking-confirm + confirmation
// email, S6/Contract J documents, S9 first-class-account auth). Per Joe's ruling
// (2026-06-18) it merges NO portal feature yet — so this file does two things and
// stays green:
//
//   1. STANDING INVARIANTS (run now): the security guarantees S10 must never break
//      — the signed-in allowlist stays default-deny, no write/admin/research tool is
//      client-callable, and S8's esign-portal tools remain the only signing surface.
//   2. SEAM PINS (run now): assert today's reality — the tools S10 will add are NOT
//      yet allowlisted. When S10 lands, these flip from `.not.` to membership and the
//      `it.todo` receipts below become real DB-gated tests.
//
// See docs/workers/S10-client-portal-plan.md.
import { describe, it, expect } from 'vitest'
import {
  CLIENT_PORTAL_TOOLS,
  CLIENT_PORTAL_AUTHED_TOOLS,
  isClientPortalAuthedTool,
} from '@exsto/legal/mcp'
import '@exsto/legal/mcp' // register tools (side effect) so the allowlist resolves

// Tool names S10 will introduce (kept here so the seam is one edit away).
const S10_BOOKING_CONFIRM = 'legal.booking.confirm' // WP10.2
const S10_DOCUMENTS = 'legal.client.documents' // WP10.3 — list released docs
const S10_DOCUMENT_GET = 'legal.client.document_get' // WP10.3 — render/download one

describe('S10 standing invariants (run now — must never regress)', () => {
  it('no write/admin/research tool is ever client-callable (authed or public)', () => {
    for (const blocked of [
      'legal.research.ask',
      'legal.draft.generate',
      'legal.settings.update',
      'legal.integration.connect',
      'legal.matter.history',
      'legal.mail.reply',
    ]) {
      expect(isClientPortalAuthedTool(blocked)).toBe(false)
      expect(CLIENT_PORTAL_TOOLS.has(blocked)).toBe(false)
    }
  })

  it('keeps S8 as the only signing surface (consume, do not reimplement)', () => {
    for (const sign of [
      'legal.esign.portal.list',
      'legal.esign.portal.load',
      'legal.esign.portal.sign',
      'legal.esign.portal.decline',
    ]) {
      expect(isClientPortalAuthedTool(sign)).toBe(true)
    }
  })
})

describe('S10 seam pins (run now — flip to membership when S10 lands)', () => {
  it('booking-confirm is NOT yet client-callable (WP10.2 blocked on S5)', () => {
    expect(isClientPortalAuthedTool(S10_BOOKING_CONFIRM)).toBe(false)
  })

  it('document view/download is NOT yet client-callable (WP10.3 blocked on S6/J)', () => {
    expect(isClientPortalAuthedTool(S10_DOCUMENTS)).toBe(false)
    expect(isClientPortalAuthedTool(S10_DOCUMENT_GET)).toBe(false)
  })

  it('document tools, once added, must be added to the AUTHED list only (never public)', () => {
    // Standing guard: even after S10 lands, released-doc access is signed-in only.
    expect(CLIENT_PORTAL_TOOLS.has(S10_DOCUMENTS)).toBe(false)
    expect(CLIENT_PORTAL_TOOLS.has(S10_DOCUMENT_GET)).toBe(false)
  })
})

// ── Receipts: become real DB-gated tests once dependencies merge ───────────────
describe('S10 receipts (HELD — enable when S5/S6/S9 land)', () => {
  // R10.1 — WP10.1 / fix #21
  it.todo(
    'a single-use token from a booking creates a tenant-scoped client_account linked to that booking’s client_contact',
  )
  // R10.2 — WP10.2
  it.todo('a booking transitions to confirmed via a portal action through the core (no direct substrate write)')
  // R10.3 — WP10.3 (released-docs-only)
  it.todo('a signed-in client views one RELEASED document and completes a signature')
  it.todo('an unreleased document is invisible to the client (withheld, never enumerated)')
  // Cross-cutting isolation (extends client-portal-{policy,auth}.test.ts)
  it.todo('a client cannot see another client’s matters, documents, or signing requests (cross-client RLS)')
  it.todo('a client of firm A cannot reach any record of firm B (cross-tenant RLS)')
})
