// WF-FIX-2 #2 — matter_status reads are latest-OPEN-wins. A matter that carries
// STACKED matter_status rows (the pre-supersede prod state — e.g. M-MRUT7CVK had
// four simultaneously-open rows — and the transient state the one-time repair
// closes) must resolve, in BOTH the matters list and the matter detail, to the
// single latest OPEN row — never a closed decoy that happens to hold the newest
// valid_from, and never an arbitrary tied row.
//
// This is the regression proof for the read half of the fix: every matter_status
// read now filters `(valid_to IS NULL OR valid_to > now())` before
// `ORDER BY valid_from DESC LIMIT 1`. The seed below is the trap — a CLOSED row
// with the newest valid_from — which the OLD reads (valid_from DESC, no open
// filter) returned and the new reads must ignore.
//
// DB-gated (skips, never fails, without a DB URL) and therefore DELIBERATELY NOT
// in apps/legal-demo/package.json's explicit `test:unit` list — that list is the
// no-DB unit set; DB-gated vertical tests run in CI's invariants job. Seeds the
// stacked rows by direct INSERT because the fixed writers (WF-FIX-2 #1) no longer
// PRODUCE two open rows — reproducing the legacy shape is the whole point.
// Dynamic imports of @exsto/* inside the test body (booking-flow.test.ts pattern)
// so this file LOADS and skips without the package dist built — only a real DB run
// touches the workspace packages.
import { describe, it, expect, afterAll } from 'vitest'
import pg from 'pg'
import type { ActionContext } from '@exsto/substrate'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE = '00000000-0000-0000-0001-000000000005'
const ctx: ActionContext = { tenantId: TENANT, actorId: PUBLIC_INTAKE }

run('matter_status reads: latest OPEN wins (live DB)', { timeout: 120_000 }, () => {
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  it('list + detail resolve to the newest OPEN status, ignoring a newer CLOSED decoy', async () => {
    const { listMatters, getMatter } = await import('@exsto/legal')
    const { submitAction } = await import('@exsto/substrate')
    const tag = `wffix2-status-${Date.now()}`

    // A real matter via the action layer (entity + a valid action_id to hang the
    // seeded attribute rows off — FK on attribute.action_id).
    const intake = await submitAction(ctx, {
      actionKindName: 'intake.submit',
      intentKind: 'enforcement',
      payload: {
        client_full_name: `${tag} Client`,
        client_email: `${tag}@pilot.test`,
        client_phone: null,
        client_company_name: `${tag} Co`,
        service_key: 'nc_llc_single_member',
        intake_form_id: null,
        intake_responses: { note: 'status-latest-wins' },
      },
    })
    const { clientEntityId, questionnaireEntityId } = intake.effects[0] as {
      clientEntityId: string
      questionnaireEntityId: string
    }

    const opened = await submitAction(ctx, {
      actionKindName: 'matter.open',
      intentKind: 'enforcement',
      payload: {
        service_key: 'nc_llc_single_member',
        workflow_route: 'manual',
        client_entity_id: clientEntityId,
        questionnaire_entity_id: questionnaireEntityId,
        client_display_name: `${tag} Co`,
      },
    })
    const matterId = (opened.effects[0] as { matterEntityId: string }).matterEntityId
    const actionId = opened.actionId

    const kindRes = await db.query<{ id: string }>(
      `SELECT id FROM attribute_kind_definition
       WHERE tenant_id = $1 AND kind_name = 'matter_status' AND status = 'active'
       ORDER BY valid_from DESC LIMIT 1`,
      [TENANT],
    )
    const statusKindId = kindRes.rows[0].id

    // Close whatever open matter_status the open handler wrote (matter.open stamps
    // 'inquiry' at real-now), so the ONLY open rows are the ones this test controls.
    // seal_guard permits this UPDATE — only valid_to changes on an open row.
    await db.query(
      `UPDATE attribute SET valid_to = now()
       WHERE tenant_id = $1 AND entity_id = $2 AND attribute_kind_id = $3 AND valid_to IS NULL`,
      [TENANT, matterId, statusKindId],
    )

    const base = Date.now()
    const at = (msAgo: number) => new Date(base - msAgo).toISOString()
    const seed = async (
      value: string,
      validFromMsAgo: number,
      validToMsAgo: number | null,
    ): Promise<void> => {
      await db.query(
        `INSERT INTO attribute
           (id, tenant_id, action_id, entity_id, attribute_kind_id, value,
            confidence, source_type, valid_from, valid_to)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, 1.0, 'system',
                 $6::timestamptz, $7::timestamptz)`,
        [
          TENANT,
          actionId,
          matterId,
          statusKindId,
          JSON.stringify(value),
          at(validFromMsAgo),
          validToMsAgo === null ? null : at(validToMsAgo),
        ],
      )
    }

    // Two OPEN rows (older + newer) + a CLOSED decoy holding the NEWEST valid_from.
    await seed('intake_submitted', 60 * 60_000, null) // open, 1h ago (older open)
    await seed('in_review', 30 * 60_000, null) // open, 30m ago (newest OPEN → winner)
    await seed('consultation_cancelled', 10 * 60_000, 5 * 60_000) // closed 5m ago, valid_from 10m ago

    // Detail (getMatter → loadCurrentAttributes) must show the newest open row.
    const detail = await getMatter(ctx, matterId)
    expect(detail?.status).toBe('in_review')

    // List (listMatters) must agree — same matter, same current status.
    const list = await listMatters(ctx)
    const row = list.find((m) => m.matterEntityId === matterId)
    expect(row?.status).toBe('in_review')
  })
})
