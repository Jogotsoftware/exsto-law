// CLIENT-PORTAL-UI-1 — prod receipts harness (scratchpad; not repo code).
// Drives the SAME operation-core code the PR ships, against prod tenant …0001.
//  R1 (WP-1): home_summary matters row-diff vs direct client_of SQL
//  R2 (WP-6 NEGATIVE): unconsented client message + booking → rejected, ZERO action rows
//  R3 (WP-3): unread count → watermark action → count decrements; no UPDATE/DELETE
import '@exsto/legal'
import {
  getPortalHomeSummary,
  listClientNotifications,
  markClientNotificationsRead,
  postClientMessage,
  scheduleClientTime,
} from '@exsto/legal'
import { withActionContext, type ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const CONTACT = process.argv[2]
if (!CONTACT) throw new Error('usage: portal-ui1-receipts.ts <clientContactId>')

async function main(): Promise<void> {
  const sysCtx: ActionContext = { tenantId: TENANT, actorId: '00000000-0000-0000-0001-000000000002' }

  // Resolve the contact's portal actor (the session would mint this).
  const actorId = await withActionContext(sysCtx, async (c) => {
    const r = await c.query<{ v: string }>(
      `SELECT a.value #>> '{}' AS v FROM attribute a
       JOIN attribute_kind_definition k ON k.id=a.attribute_kind_id
       WHERE a.tenant_id=$1 AND a.entity_id=$2 AND k.kind_name='portal_actor_id'
       ORDER BY a.valid_from DESC LIMIT 1`,
      [TENANT, CONTACT],
    )
    return r.rows[0]?.v ?? null
  })
  if (!actorId) throw new Error('contact has no portal actor')
  const clientCtx: ActionContext = { tenantId: TENANT, actorId }
  console.log(`contact=${CONTACT} portalActor=${actorId}`)

  // ── R1: home summary vs ledger row-diff ────────────────────────────────────
  const home = await getPortalHomeSummary(clientCtx, CONTACT, 'en')
  const ledgerMatters = await withActionContext(sysCtx, async (c) => {
    const r = await c.query<{ id: string; name: string; created_at: string }>(
      `SELECT m.id, m.name, to_char(m.created_at,'MM/YYYY') AS created_at
       FROM relationship rel
       JOIN relationship_kind_definition rk ON rk.id=rel.relationship_kind_id AND rk.kind_name='client_of'
       JOIN entity m ON m.id=rel.target_entity_id
       JOIN entity_kind_definition ek ON ek.id=m.entity_kind_id AND ek.kind_name='matter'
       WHERE rel.tenant_id=$1 AND rel.source_entity_id=$2
         AND (rel.valid_to IS NULL OR rel.valid_to>now())
         AND m.status IN ('active','archived')
       ORDER BY m.created_at DESC`,
      [TENANT, CONTACT],
    )
    return r.rows
  })
  const rendered = home.matters.map((m) => `${m.matterNumber}|${m.matterEntityId}`).sort()
  const ledger = ledgerMatters.map((m) => `${m.name}|${m.id}`).sort()
  const diffA = rendered.filter((x) => !ledger.includes(x))
  const diffB = ledger.filter((x) => !rendered.includes(x))
  console.log(`R1 rendered=${rendered.length} ledger=${ledger.length} diff=${diffA.length + diffB.length}`)
  for (const m of home.matters) {
    console.log(`  row: ${m.serviceLabel ?? '(no label)'} · ${m.openedAt.slice(0, 7)} · ${m.matterNumber} · chip="${m.statusLabel}"`)
  }
  if (diffA.length || diffB.length) console.log('  DIFF', { diffA, diffB })

  // ── R2: WP-6 negative — unconsented message + booking rejected, zero rows ──
  const counts = async (): Promise<{ msg: number; book: number }> =>
    withActionContext(sysCtx, async (c) => {
      const r = await c.query<{ k: string; n: string }>(
        `SELECT k.kind_name AS k, count(*) AS n FROM action a
         JOIN action_kind_definition k ON k.id=a.action_kind_id
         WHERE a.tenant_id=$1 AND k.kind_name IN ('client.message.post','booking.create')
         GROUP BY 1`,
        [TENANT],
      )
      const m = Object.fromEntries(r.rows.map((x) => [x.k, Number(x.n)]))
      return { msg: m['client.message.post'] ?? 0, book: m['booking.create'] ?? 0 }
    })

  const before = await counts()
  const matterId = ledgerMatters[0]?.id
  let msgRejected = ''
  try {
    await postClientMessage(clientCtx, {
      matterEntityId: matterId ?? CONTACT,
      body: 'receipt-negative-test (should never post)',
      clientContactId: CONTACT,
    })
    msgRejected = 'NOT REJECTED — FAIL'
  } catch (e) {
    msgRejected = e instanceof Error ? `rejected: ${e.name}: ${e.message}` : 'rejected'
  }
  let bookRejected = ''
  try {
    const start = new Date(Date.now() + 7 * 24 * 3600 * 1000)
    const end = new Date(start.getTime() + 30 * 60000)
    await scheduleClientTime(clientCtx, {
      clientContactId: CONTACT,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
    })
    bookRejected = 'NOT REJECTED — FAIL'
  } catch (e) {
    bookRejected = e instanceof Error ? `rejected: ${e.name}: ${e.message}` : 'rejected'
  }
  const after = await counts()
  console.log(`R2 message → ${msgRejected}`)
  console.log(`R2 booking → ${bookRejected}`)
  console.log(
    `R2 action rows: client.message.post ${before.msg}→${after.msg}, booking.create ${before.book}→${after.book} (must be unchanged)`,
  )

  // ── R3: WP-3 watermark cycle ────────────────────────────────────────────────
  const feed1 = await listClientNotifications(clientCtx, CONTACT)
  console.log(`R3 unread before=${feed1.unreadCount} (items=${feed1.items.length}, lastReadAt=${feed1.lastReadAt})`)
  const { readAt } = await markClientNotificationsRead(clientCtx, CONTACT)
  const feed2 = await listClientNotifications(clientCtx, CONTACT)
  console.log(`R3 watermark=${readAt} unread after=${feed2.unreadCount} (items=${feed2.items.length})`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
