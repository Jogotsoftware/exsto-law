// CLIENT-PORTAL-UI-1 — CORRECTIVE driver (WP-C1/C2/C3). Everything fires
// through the operation core; nothing here is a bare INSERT/UPDATE.
//
//   node --import tsx --env-file=<main>/.env.local verticals/legal/demo/portal-ui1-corrective.ts c1
//   node --import tsx --env-file=<main>/.env.local verticals/legal/demo/portal-ui1-corrective.ts c2
//   node --import tsx --env-file=<main>/.env.local verticals/legal/demo/portal-ui1-corrective.ts c3
import '@exsto/legal'
import {
  amendPermissionScope,
  setEngagementTerms,
  acceptEngagement,
  getEngagementStatus,
  postClientMessage,
  scheduleClientTime,
  getPortalSchedulingAvailability,
} from '@exsto/legal'
import { withActionContext, type ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002' // Joe Pacheco (firm.super_admin)

// Founder's own portal identity (C3 positive path) and the control contact
// (C3 negative re-run). Resolved live below — these are the expected ids.
const FOUNDER_CONTACT = 'fd690e57-dc76-4a0f-9605-a26be095b1f4' // Joseph A Pacheco
const CONTROL_CONTACT = '6c9e026a-4f12-47a2-b18e-3c5216edbbe7' // Riley Cameron

const AMEND_KINDS = [
  'legal.engagement.accept',
  'legal.engagement.decline',
  'portal.notification.read',
]

const AMEND_REASON =
  'CLIENT-PORTAL-UI-1 corrective WP-C1: migration 0161 amended this allowlist with a bare in-place ' +
  'UPDATE (no linked action; row kept its 0136 provenance and 7/10 versioning columns while carrying ' +
  '7/14 kind strings). This action IS the amendment record; its handler re-points the row.'

// WP-C2 — verbatim placeholder text (guardrail included). TEST ONLY.
const PLACEHOLDER_TERMS = `⚠️ PLACEHOLDER — TEST ONLY. Not enforceable terms. Replace with attorney-authored agreement before go-live.

By accepting, you agree to engage Pacheco Law for legal services at the firm's standard hourly rate shown above, covering messages, scheduled time, and work performed. Invoices are issued as work is done. Either party may end the engagement in writing; you remain responsible for fees incurred until then. [PLACEHOLDER — firm's real engagement terms to be supplied by the attorney.]`

async function systemActor(tenantId: string): Promise<string> {
  const ctx: ActionContext = { tenantId, actorId: 'resolve' }
  return withActionContext(
    { ...ctx, actorId: '00000000-0000-0000-0000-000000000000' },
    async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT id FROM actor WHERE tenant_id=$1 AND actor_type='system' AND status='active'
       ORDER BY created_at ASC LIMIT 1`,
        [tenantId],
      )
      const id = r.rows[0]?.id
      if (!id) throw new Error(`tenant ${tenantId} has no system actor`)
      return id
    },
  )
}

async function portalActorOf(contactId: string): Promise<string> {
  const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }
  return withActionContext(ctx, async (c) => {
    const r = await c.query<{ v: string }>(
      `SELECT a.value #>> '{}' AS v FROM attribute a
       JOIN attribute_kind_definition k ON k.id=a.attribute_kind_id
       WHERE a.tenant_id=$1 AND a.entity_id=$2 AND k.kind_name='portal_actor_id'
       ORDER BY a.valid_from DESC LIMIT 1`,
      [TENANT, contactId],
    )
    if (!r.rows[0]?.v) throw new Error(`contact ${contactId} has no portal actor`)
    return r.rows[0].v
  })
}

async function actionCount(kind: string): Promise<number> {
  const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }
  return withActionContext(ctx, async (c) => {
    const r = await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM action a
       JOIN action_kind_definition k ON k.id=a.action_kind_id
       WHERE a.tenant_id=$1 AND k.kind_name=$2`,
      [TENANT, kind],
    )
    return Number(r.rows[0]?.n ?? 0)
  })
}

async function c1(): Promise<void> {
  // Every tenant whose client.portal row 0161 touched gets its amendment
  // recorded: tenant-zero as the founder's super-admin actor, others as their
  // own system actor.
  const tenants: Array<{ tenantId: string; actorId: string }> = [
    { tenantId: TENANT, actorId: ATTORNEY },
    {
      tenantId: '00000000-0000-0000-0000-000000000002',
      actorId: await systemActor('00000000-0000-0000-0000-000000000002'),
    },
    {
      tenantId: '00000000-0000-0000-00fe-000000000001',
      actorId: await systemActor('00000000-0000-0000-00fe-000000000001'),
    },
  ]
  for (const t of tenants) {
    const res = await amendPermissionScope(
      { tenantId: t.tenantId, actorId: t.actorId },
      { scopeName: 'client.portal', addActionKinds: AMEND_KINDS, reason: AMEND_REASON },
    )
    console.log(
      `C1 ${t.tenantId} scope=${res.scopeId} added=[${res.added.join(',')}] ensured=[${res.ensured.join(',')}]`,
    )
  }
}

async function c2(): Promise<void> {
  const before = await actionCount('legal.firm.set_engagement_terms')
  const { version } = await setEngagementTerms(
    { tenantId: TENANT, actorId: ATTORNEY },
    PLACEHOLDER_TERMS,
  )
  const after = await actionCount('legal.firm.set_engagement_terms')
  console.log(`C2 set_engagement_terms fires ${before}→${after}, terms_version=${version}`)
}

async function c3(): Promise<void> {
  const founderActor = await portalActorOf(FOUNDER_CONTACT)
  const controlActor = await portalActorOf(CONTROL_CONTACT)
  const founderCtx: ActionContext = { tenantId: TENANT, actorId: founderActor }
  const controlCtx: ActionContext = { tenantId: TENANT, actorId: controlActor }

  // 1) accept fires 0→1, binding the CONFIG rate + terms version.
  const acceptBefore = await actionCount('legal.engagement.accept')
  const accepted = await acceptEngagement(founderCtx, FOUNDER_CONTACT)
  const acceptAfter = await actionCount('legal.engagement.accept')
  console.log(
    `C3.1 accept fires ${acceptBefore}→${acceptAfter} rate=${accepted.rate} terms_version=${accepted.termsVersion} event=${accepted.consentEventId}`,
  )
  const status = await getEngagementStatus(founderCtx, FOUNDER_CONTACT)
  console.log(
    `C3.2 status accepted=${status.accepted} rate=${status.rate} terms_version=${status.termsVersion} at=${status.acceptedAt}`,
  )

  // 3) post-accept: message + client-initiated booking SUCCEED.
  const msgBefore = await actionCount('client.message.post')
  await postClientMessage(founderCtx, {
    matterEntityId: '2ce0563c-871c-4a0b-808c-1f64347d79f0', // M-MRJHEC8X (founder's)
    body: 'Corrective WP-C3: post-acceptance test message from the portal client actor.',
    clientContactId: FOUNDER_CONTACT,
  })
  const msgAfter = await actionCount('client.message.post')
  console.log(`C3.3 message ${msgBefore}→${msgAfter}`)

  const bookBefore = await actionCount('booking.create')
  const avail = await getPortalSchedulingAvailability(founderCtx, { daysOut: 21 })
  if (!avail.configured || avail.slots.length === 0) {
    console.log(
      `C3.3 booking SKIPPED — availability configured=${avail.configured} slots=${avail.slots.length} (Google adapter unreachable from this environment?)`,
    )
  } else {
    const slot = avail.slots[avail.slots.length - 1]!
    const r = await scheduleClientTime(founderCtx, {
      clientContactId: FOUNDER_CONTACT,
      startIso: slot.startIso,
      endIso: slot.endIso,
      reason: 'Corrective WP-C3 post-acceptance booking test',
    })
    const bookAfter = await actionCount('booking.create')
    console.log(
      `C3.3 booking ${bookBefore}→${bookAfter} ref=${r.bookingRef} start=${r.startIso} calendarWritten=${r.calendarWritten}`,
    )
  }

  // 4) negative re-run: the control contact (no acceptance) is still rejected.
  const negMsgBefore = await actionCount('client.message.post')
  try {
    await postClientMessage(controlCtx, {
      matterEntityId: 'aafc8e4e-2859-4e47-ae73-92c88c24b28b', // M-MRFE4IES (control's)
      body: 'should never post',
      clientContactId: CONTROL_CONTACT,
    })
    console.log('C3.4 NEGATIVE FAILED — message posted without acceptance')
  } catch (e) {
    console.log(`C3.4 negative message → rejected: ${e instanceof Error ? e.name : 'error'}`)
  }
  const negMsgAfter = await actionCount('client.message.post')
  console.log(`C3.4 message count ${negMsgBefore}→${negMsgAfter} (must be unchanged)`)
}

const mode = process.argv[2]
const run = mode === 'c1' ? c1 : mode === 'c2' ? c2 : mode === 'c3' ? c3 : null
if (!run) {
  console.error('usage: portal-ui1-corrective.ts c1|c2|c3')
  process.exit(1)
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
