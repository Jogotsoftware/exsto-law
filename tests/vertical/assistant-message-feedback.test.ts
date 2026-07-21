// FB-0 — message-level assistant feedback: a thumbs verdict + optional note on
// ONE assistant reply, plus a snapshot of the whole visible conversation saved
// as a content_blob (never inlined into the event payload).
//
// Two independent suites:
//   (1) Pure policy checks (no DB) — "portal can't list": there is no
//       portal-reachable read/list tool for this data, only the scoped submit.
//   (2) DB-gated (skipIf) — handler round-trip, blob-not-inlined, and portal
//       isolation (a portal submission is ALWAYS scoped to the caller's own
//       client_contact, regardless of anything else passed in). Skipped
//       without a DATABASE_URL (no local Docker); runs for real in CI's
//       invariants job — same convention as assistant-history-fence.test.ts.
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'
import { submitAssistantMessageFeedback, listAssistantMessageFeedback } from '@exsto/legal'
import { CLIENT_PORTAL_AUTHED_TOOLS, CLIENT_PORTAL_TOOLS } from '@exsto/legal/mcp'

describe('FB-0 message feedback — portal tool exposure (no DB)', () => {
  it('the attorney-only submit/list tools are never portal-reachable', () => {
    expect(CLIENT_PORTAL_AUTHED_TOOLS.has('legal.assistant.message_feedback_submit')).toBe(false)
    expect(CLIENT_PORTAL_AUTHED_TOOLS.has('legal.assistant.message_feedback_list')).toBe(false)
    expect(CLIENT_PORTAL_TOOLS.has('legal.assistant.message_feedback_submit')).toBe(false)
    expect(CLIENT_PORTAL_TOOLS.has('legal.assistant.message_feedback_list')).toBe(false)
  })

  it('portal can’t list: no read/list tool for message feedback is portal-reachable', () => {
    for (const name of [...CLIENT_PORTAL_AUTHED_TOOLS, ...CLIENT_PORTAL_TOOLS]) {
      const isMessageFeedbackReadTool =
        name.includes('message_feedback') && /list|get|read/.test(name)
      expect(isMessageFeedbackReadTool, `${name} must not be a portal-reachable read tool`).toBe(
        false,
      )
    }
  })

  it('the portal submit tool IS reachable via the authed allowlist (it must be, to submit)', () => {
    expect(CLIENT_PORTAL_AUTHED_TOOLS.has('legal.client.message_feedback_submit')).toBe(true)
  })
})

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
// A real, active human actor seeded by the core foundation (mirrors
// assistant-history-fence.test.ts's ATTORNEY_ACTOR).
const ATTORNEY_ACTOR = '00000000-0000-0000-0001-000000000002'

run('FB-0 message feedback (DB-gated)', { timeout: 90_000 }, () => {
  const db = new pg.Pool({ connectionString: url })
  const attorneyCtx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY_ACTOR }

  async function anyActionId(): Promise<string> {
    const r = await db.query<{ id: string }>(`SELECT id FROM action WHERE tenant_id = $1 LIMIT 1`, [
      TENANT,
    ])
    return r.rows[0]!.id
  }

  async function makeClientContact(label: string): Promise<string> {
    const id = randomUUID()
    const kind = (
      await db.query<{ id: string }>(
        `SELECT id FROM entity_kind_definition WHERE tenant_id = $1 AND kind_name = 'client_contact' LIMIT 1`,
        [TENANT],
      )
    ).rows[0]!.id
    await db.query(
      `INSERT INTO entity (id, tenant_id, action_id, entity_kind_id, name, status, metadata)
       VALUES ($1, $2, $3, $4, $5, 'active', '{}'::jsonb)`,
      [id, TENANT, await anyActionId(), kind, `fb-0 fixture contact (${label})`],
    )
    return id
  }

  afterAll(async () => {
    await db.end()
    await closeDbPool()
  })

  it('handler round-trip: records verdict + note + a transcript blob id, and the blob (not the event payload) holds the transcript', async () => {
    const secretMarker = `FB0_TRANSCRIPT_MARKER_${randomUUID()}`
    const { eventId, transcriptBlobId } = await submitAssistantMessageFeedback(attorneyCtx, {
      verdict: 'up',
      note: 'Great answer, cited the right statute.',
      surface: 'attorney',
      messageIndex: 1,
      transcript: [
        { role: 'user', content: 'What is the filing deadline?' },
        { role: 'assistant', content: `The deadline is 30 days. ${secretMarker}` },
      ],
    })
    expect(eventId).toBeTruthy()
    expect(transcriptBlobId).toBeTruthy()

    // The content_blob holds the full transcript.
    const blobRes = await db.query<{ body: string; content_type: string }>(
      `SELECT body, content_type FROM content_blob WHERE tenant_id = $1 AND id = $2`,
      [TENANT, transcriptBlobId],
    )
    expect(blobRes.rows[0]?.content_type).toBe('application/json')
    expect(blobRes.rows[0]?.body).toContain(secretMarker)

    // blob not inlined: the event's own payload never carries the transcript
    // text — only the blob id that points at it.
    const evRes = await db.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM event WHERE tenant_id = $1 AND id = $2`,
      [TENANT, eventId],
    )
    const payloadText = JSON.stringify(evRes.rows[0]?.payload ?? {})
    expect(payloadText).not.toContain(secretMarker)
    expect(payloadText).toContain(transcriptBlobId)

    // Read back through the attorney-only list.
    const list = await listAssistantMessageFeedback(attorneyCtx)
    const entry = list.find((e) => e.eventId === eventId)
    expect(entry?.verdict).toBe('up')
    expect(entry?.note).toBe('Great answer, cited the right statute.')
    expect(entry?.surface).toBe('attorney')
    expect(entry?.transcriptBlobId).toBe(transcriptBlobId)
    expect(entry?.messageIndex).toBe(1)
  })

  it('portal isolation: a portal submission is flagged surface=portal and ALWAYS scoped to the caller’s own client_contact, never a caller-supplied one', async () => {
    const ownContactId = await makeClientContact('own')
    const otherContactId = await makeClientContact('other')

    const { eventId } = await submitAssistantMessageFeedback(attorneyCtx, {
      verdict: 'down',
      surface: 'portal',
      messageIndex: 0,
      transcript: [{ role: 'assistant', content: 'Hi, how can I help?' }],
      clientContactId: ownContactId,
      // A stray/attacker-controlled contact or matter scope must be ignored —
      // the portal surface is forced onto clientContactId regardless.
      contactEntityId: otherContactId,
      matterEntityId: '00000000-0000-0000-0002-000000009999',
    })

    const list = await listAssistantMessageFeedback(attorneyCtx)
    const entry = list.find((e) => e.eventId === eventId)
    expect(entry?.surface).toBe('portal')
    expect(entry?.contactEntityId).toBe(ownContactId)
    expect(entry?.contactEntityId).not.toBe(otherContactId)
    expect(entry?.matterEntityId).toBeNull()
  })

  it('a portal submission without clientContactId is rejected outright', async () => {
    await expect(
      submitAssistantMessageFeedback(attorneyCtx, {
        verdict: 'up',
        surface: 'portal',
        messageIndex: 0,
        transcript: [],
      }),
    ).rejects.toThrow()
  })

  it('the attorney list excludes nothing — it shows both attorney- and portal-surfaced feedback', async () => {
    const list = await listAssistantMessageFeedback(attorneyCtx)
    expect(list.some((e) => e.surface === 'attorney')).toBe(true)
    expect(list.some((e) => e.surface === 'portal')).toBe(true)
  })
})
