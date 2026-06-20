// Beta feedback (in-app chat): "contacts are showing as no name. that is why we
// have clients fill out their contact info at intake. it should create a contact
// and client and matter all linked together." Before this fix, intake wrote only
// the direct client_of (contact→matter) link; the CRM's contact detail/list read
// matter_has_client / the client-parent chain, so intake contacts showed zero
// matters and never appeared as clients. This pins the fixed behaviour:
//   - matter.open now also creates (or reuses) a client-parent account and writes
//     contact_of + matter_of, so contact + client + matter are all linked.
//   - getContact / listContacts surface the matter via the direct client_of link
//     (covers the existing rows that predate the client parent, too).
//   - a second matter for the same contact reuses the same client (no fork).
// DB-gated; no model key needed.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { getContact, listContacts } from '@exsto/legal'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { withSuperuser, closeDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE = '00000000-0000-0000-0001-000000000005'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const intakeCtx: ActionContext = { tenantId: TENANT, actorId: PUBLIC_INTAKE }
const attorneyCtx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

async function relExists(sourceId: string, targetId: string, kind: string): Promise<boolean> {
  return withSuperuser(async (client) => {
    const res = await client.query(
      `SELECT 1 FROM relationship r JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1 AND r.source_entity_id = $2 AND r.target_entity_id = $3
         AND rkd.kind_name = $4 AND (r.valid_to IS NULL OR r.valid_to > now())`,
      [TENANT, sourceId, targetId, kind],
    )
    return (res.rowCount ?? 0) > 0
  })
}

async function latestAttr(entityId: string, kind: string): Promise<string | null> {
  return withSuperuser(async (client) => {
    const res = await client.query<{ v: string | null }>(
      `SELECT a.value #>> '{}' AS v
       FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = $3
       ORDER BY a.valid_from DESC LIMIT 1`,
      [TENANT, entityId, kind],
    )
    return res.rows[0]?.v ?? null
  })
}

// The client-parent account a contact belongs to (via contact_of), if any.
async function clientParentOf(contactId: string): Promise<string | null> {
  return withSuperuser(async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT r.target_entity_id AS id
       FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       JOIN entity ce ON ce.id = r.target_entity_id
       JOIN entity_kind_definition cekd ON cekd.id = ce.entity_kind_id
       WHERE r.tenant_id = $1 AND r.source_entity_id = $2
         AND rkd.kind_name = 'contact_of' AND cekd.kind_name = 'client'
         AND (r.valid_to IS NULL OR r.valid_to > now())
       ORDER BY r.valid_from DESC LIMIT 1`,
      [TENANT, contactId],
    )
    return res.rows[0]?.id ?? null
  })
}

async function openMatter(
  contactId: string,
  questionnaireId: string,
  company: string,
): Promise<string> {
  const opened = await submitAction(intakeCtx, {
    actionKindName: 'matter.open',
    intentKind: 'enforcement',
    payload: {
      service_key: 'nc_llc_single_member',
      workflow_route: 'manual',
      client_entity_id: contactId,
      questionnaire_entity_id: questionnaireId,
      client_display_name: company,
    },
  })
  return (opened.effects[0] as { matterEntityId: string }).matterEntityId
}

run('intake linking — contact + client + matter all linked (live DB)', { timeout: 120_000 }, () => {
  const tag = `ilk-${Date.now()}`
  const company = `${tag} Dana Co`

  afterAll(async () => {
    await closeDbPool()
  })

  it('intake creates a fully-linked contact + client + matter, surfaced on the contact', async () => {
    const intake = await submitAction(intakeCtx, {
      actionKindName: 'intake.submit',
      intentKind: 'enforcement',
      payload: {
        client_full_name: `${tag} Dana`,
        client_email: `${tag}-dana@pilot.test`,
        client_phone: null,
        client_company_name: company,
        service_key: 'nc_llc_single_member',
        intake_form_id: null,
        intake_responses: { company_name: company },
      },
    })
    const { clientEntityId: contactId, questionnaireEntityId } = intake.effects[0] as {
      clientEntityId: string
      questionnaireEntityId: string
    }

    const matterId = await openMatter(contactId, questionnaireEntityId, company)

    // Contact + client + matter all linked: direct client_of, plus the client
    // parent wired via contact_of / matter_of.
    const clientId = await clientParentOf(contactId)
    expect(clientId).toBeTruthy()
    expect(await relExists(contactId, matterId, 'client_of')).toBe(true)
    expect(await relExists(contactId, clientId!, 'contact_of')).toBe(true)
    expect(await relExists(matterId, clientId!, 'matter_of')).toBe(true)
    expect(await latestAttr(clientId!, 'client_name')).toBe(company)

    // Read fix: the contact now shows its matter (detail + list).
    const detail = await getContact(attorneyCtx, contactId)
    expect(detail?.matters.map((m) => m.matterEntityId)).toContain(matterId)
    expect(detail?.matterCount ?? 0).toBeGreaterThanOrEqual(1)

    const list = await listContacts(attorneyCtx)
    const row = list.find((r) => r.contactEntityId === contactId)
    expect(row?.matterCount ?? 0).toBeGreaterThanOrEqual(1)

    // A second matter for the SAME contact reuses the SAME client (no fork).
    const matterId2 = await openMatter(contactId, questionnaireEntityId, company)
    expect(await relExists(matterId2, clientId!, 'matter_of')).toBe(true)
    expect(await clientParentOf(contactId)).toBe(clientId)
  })
})
