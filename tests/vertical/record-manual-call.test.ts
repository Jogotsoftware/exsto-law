// Manual call entry (beta sprint Obj 8 / no-simulate non-negotiable). The old
// synthetic `simulateCall` is replaced by recordManualCall: a real transcript the
// attorney provides, projected through the same call.ingest path but with
// transcript_source='manual' and HUMAN provenance (source_type='human',
// source_ref=actorId). This test proves that provenance on the live DB. DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { submitBooking, recordManualCall } from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'
import { withSuperuser, closeDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE = '00000000-0000-0000-0001-000000000005'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const publicCtx: ActionContext = { tenantId: TENANT, actorId: PUBLIC_INTAKE }
const attorneyCtx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

function slot(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1)
  d.setUTCHours(19, 0, 0, 0)
  return { startIso: d.toISOString(), endIso: new Date(d.getTime() + 30 * 60 * 1000).toISOString() }
}

async function bookMatter(person: string, email: string, days: number): Promise<string> {
  const s = slot(days)
  const b = await submitBooking(publicCtx, {
    clientFullName: person,
    clientEmail: email,
    clientPhone: '+1 919 555 0003',
    clientCompanyName: 'Manual Call Co',
    attributionSource: 'manual-call-test',
    serviceKey: 'nc_llc_single_member',
    intakeResponses: { company_name: 'Manual Call Co' },
    scheduledAtIso: s.startIso,
    scheduledEndIso: s.endIso,
  })
  return (b.effects[0] as { matterEntityId: string }).matterEntityId
}

run('Manual call entry (live DB)', { timeout: 120_000 }, () => {
  const tag = `mcl-${Date.now()}`

  afterAll(async () => {
    await closeDbPool()
  })

  it('records a real transcript with manual source and human provenance', async () => {
    const matterId = await bookMatter(`${tag} Dana`, `${tag}-dana@manual.test`, 4)

    const res = await recordManualCall(attorneyCtx, {
      matterEntityId: matterId,
      transcriptText: 'Attorney and Dana reviewed the single-member operating agreement terms.',
    })
    const callId = (res.effects[0] as { callEntityId: string }).callEntityId
    expect(callId).toBeTruthy()

    // The call's granola_call_id attribute carries HUMAN provenance — not the
    // integration/granola provenance the webhook path writes.
    const prov = await withSuperuser(async (client) => {
      const r = await client.query<{ source_type: string; source_ref: string }>(
        `SELECT a.source_type, a.source_ref FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
         WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = 'granola_call_id'
         ORDER BY a.valid_from DESC LIMIT 1`,
        [TENANT, callId],
      )
      return r.rows[0]
    })
    expect(prov?.source_type).toBe('human')
    expect(prov?.source_ref).toBe(ATTORNEY)

    // And it's attached to the matter via call_of with a manual transcript.
    const linked = await withSuperuser(async (client) => {
      const r = await client.query<{ matched: string; src: string | null }>(
        `SELECT
           (SELECT count(*) FROM relationship rel
              JOIN relationship_kind_definition rkd ON rkd.id = rel.relationship_kind_id AND rkd.kind_name = 'call_of'
              WHERE rel.tenant_id = $1 AND rel.source_entity_id = $2 AND rel.target_entity_id = $3)::text AS matched,
           (SELECT a.value #>> '{}' FROM attribute a
              JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id AND akd.kind_name = 'transcript_source'
              JOIN relationship tr ON tr.source_entity_id = a.entity_id
              JOIN relationship_kind_definition trk ON trk.id = tr.relationship_kind_id AND trk.kind_name = 'transcript_of'
              WHERE a.tenant_id = $1 AND tr.target_entity_id = $2 LIMIT 1) AS src`,
        [TENANT, callId, matterId],
      )
      return r.rows[0]
    })
    expect(linked?.matched).toBe('1')
    expect(linked?.src).toBe('manual')
  })
})
