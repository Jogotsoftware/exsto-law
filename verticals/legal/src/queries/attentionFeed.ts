// FB-H — the ATTENTION ENGINE. A DETERMINISTIC triage feed: "what are my most
// pressing matters/tasks?", inbox triage, and the things that have slipped
// through the cracks. The FEED IS CODE, not a model guess — every item is a
// tenant-scoped read of real state, ranked by a pure, unit-tested ranker. Three
// consumers ride this one engine: the get_attention_feed chat tool, the
// global-scope volatile snapshot, and the attorney home "Attention" card.
//
// Every bucket is a tenant-scoped read that REUSES an existing query where one
// exists (listDueTasks, listPendingDraftVersions, listEnvelopes, listInvoices);
// only the inbox "awaiting reply", stale-matter watermark, and parked-workflow
// buckets need their own SQL, each `WHERE tenant_id = $1` (hard rule) under
// withActionContext (RLS).
import { withActionContext, type ActionContext } from '@exsto/substrate'
import { listConnections } from '../adapters/connectionStore.js'
import { listDueTasks } from './tasks.js'
import { listPendingDraftVersions } from './drafts.js'
import { listInvoices } from './billing.js'
import { listEnvelopes } from '../api/esign.js'

// The kinds of pressing thing the feed surfaces. Ordered here roughly by the
// priority band the ranker assigns (see ATTENTION_TIER below), but the ranker,
// not this order, is the source of truth.
export type AttentionKind =
  | 'overdue_task'
  | 'awaiting_reply'
  | 'draft_pending_review'
  | 'envelope_unsigned'
  | 'invoice_unpaid'
  | 'workflow_parked'
  | 'stale_matter'
  | 'due_soon_task'

export interface AttentionItem {
  kind: AttentionKind
  // A short human label for the item ("Reply to Riley Chen", "Task: file annual report").
  title: string
  // ONE plain sentence saying why this needs attention — no platform vocabulary.
  why: string
  // An in-app path the attorney can click to act (a real /attorney/* route).
  deepLink: string
  // Rank in the final ranked list: 0 = most pressing. Assigned by rankAttentionItems.
  rank: number
  // The timestamp the item's age is measured from (ISO). Older = more pressing
  // within a tier. This is the ranker's tiebreaker and the "n days" in `why`.
  occurredAt: string
  // The primary matter/entity this item is about, when it has one — used to
  // dedupe overlapping slipped-cracks signals on the same matter, and as a
  // stable React key on the home card. Optional (inbox items may lack one).
  entityId?: string
}

// The priority BAND each kind sits in (lower = more pressing). Within a band the
// ranker breaks ties by age (older occurredAt first). This encodes the founder's
// rule: overdue tasks first, then awaiting-reply, then the review/unsigned/
// unpaid/parked/stale "slipped through the cracks" band by age, then due-soon.
const ATTENTION_TIER: Record<AttentionKind, number> = {
  overdue_task: 0,
  awaiting_reply: 1,
  draft_pending_review: 2,
  envelope_unsigned: 3,
  invoice_unpaid: 3,
  workflow_parked: 3,
  stale_matter: 3,
  due_soon_task: 4,
}

// Staleness thresholds — CONFIG, not code. v1 ships these code DEFAULTS; a
// firm_settings-style override is the documented next step (getAttentionFeed
// already takes a thresholds override, so wiring a per-firm config later is a
// read swap, no signature change and no migration needed for v1).
export interface AttentionThresholds {
  // A due-dated task is "due soon" if it falls within this many days ahead.
  dueSoonDays: number
  // A draft sitting in the review queue this many days is a slipped-cracks item.
  draftPendingDays: number
  // An envelope out for signature this many days without completing.
  envelopeUnsignedDays: number
  // An issued invoice unpaid this many days.
  invoiceUnpaidDays: number
  // A matter with no recorded activity for this many days.
  staleMatterDays: number
  // A running workflow parked on the same step this many days (a human gate it
  // is waiting on — an active instance that has not advanced is, by definition,
  // waiting on someone).
  workflowParkedDays: number
}

// Founder-specified defaults: 7d stale matter, 3d draft, 5d envelope, 14d
// invoice. dueSoon (3d) and workflowParked (7d) are chosen to match: a task due
// within 3 days is imminent; a workflow that hasn't moved in a week is stuck.
export const DEFAULT_ATTENTION_THRESHOLDS: AttentionThresholds = {
  dueSoonDays: 3,
  draftPendingDays: 3,
  envelopeUnsignedDays: 5,
  invoiceUnpaidDays: 14,
  staleMatterDays: 7,
  workflowParkedDays: 7,
}

const MS_PER_DAY = 86_400_000

function daysSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.floor((nowMs - t) / MS_PER_DAY)
}

// "3 days ago" / "today" / "yesterday" — plain, for the `why` sentence.
function agoPhrase(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function ymd(nowMs: number, offsetDays = 0): string {
  return new Date(nowMs + offsetDays * MS_PER_DAY).toISOString().slice(0, 10)
}

// ── The PURE ranker ─────────────────────────────────────────────────────────
// Deterministic: sort by (tier asc, age desc, then a stable kind+link tiebreak
// so equal-age items never reorder run-to-run). Assigns each item its final
// `rank` (0-based position). Exported and unit-tested in isolation — no DB, no
// clock beyond the injected `nowMs`.
export function rankAttentionItems(
  items: AttentionItem[],
  nowMs: number = Date.now(),
): AttentionItem[] {
  const sorted = [...items].sort((a, b) => {
    const ta = ATTENTION_TIER[a.kind]
    const tb = ATTENTION_TIER[b.kind]
    if (ta !== tb) return ta - tb
    // Older first within a band (more pressing). Missing timestamps sort last.
    const aa = Date.parse(a.occurredAt)
    const ab = Date.parse(b.occurredAt)
    const va = Number.isFinite(aa) ? aa : nowMs
    const vb = Number.isFinite(ab) ? ab : nowMs
    if (va !== vb) return va - vb
    // Stable, deterministic final tiebreak so the order never depends on input
    // order or Array.sort stability across engines.
    return `${a.kind}:${a.deepLink}`.localeCompare(`${b.kind}:${b.deepLink}`)
  })
  return sorted.map((it, i) => ({ ...it, rank: i }))
}

// A one-line rendering of an item, used both to measure the char budget and by
// the model/snapshot consumers. Kept here so the cap and the read-back agree.
export function renderAttentionLine(it: AttentionItem): string {
  return `- ${it.why} → ${it.deepLink}`
}

// The compact GLOBAL-scope snapshot: the top items as plain one-liners, for
// injection into the VOLATILE half of an unscoped chat's system prompt so the
// assistant opens already knowing the landscape. Empty string when there is
// nothing pressing (the caller then injects no block at all).
export function renderAttentionSnapshot(items: AttentionItem[]): string {
  if (items.length === 0) return ''
  return items.map(renderAttentionLine).join('\n')
}

// ── Deep links (PO-2, founder walk 15.9) ────────────────────────────────────
// Every item type links straight to its real subject, not a generic list page.
// Small, pure, exported so the shape is unit-testable without a DB — the same
// reasoning that keeps rankAttentionItems pure and exported.
export function taskDeepLink(matterEntityId: string, taskId: string): string {
  return `/attorney/matters/${matterEntityId}/tasks/${taskId}`
}
export function matterActivityDeepLink(matterEntityId: string): string {
  return `/attorney/matters/${matterEntityId}/activity`
}
export function mailThreadDeepLink(gmailThreadId: string | null): string {
  return gmailThreadId ? `/attorney/mail?thread=${gmailThreadId}` : '/attorney/mail'
}
export function draftDeepLink(documentVersionId: string): string {
  return `/attorney/review/${documentVersionId}`
}
export function envelopeDeepLink(envelopeId: string): string {
  return `/attorney/esign/${envelopeId}`
}
export function invoiceDeepLink(invoiceEntityId: string): string {
  return `/attorney/billing?tab=invoices&invoiceId=${invoiceEntityId}`
}

// ── Awaiting-reply grouping + copy (PO-2) ───────────────────────────────────
// The row shape read out of the SQL in readAwaitingReply, one per THREAD whose
// last message is inbound. Pulled out as a plain type + pure function so the
// grouping/copy logic — where every founder complaint (fake matter-as-sender
// copy, duplicate rows, dead links) actually lives — is unit-testable with
// fixture rows, no DB.
export interface AwaitingReplyThreadRow {
  threadId: string
  matterId: string | null
  matterNumber: string | null
  gmailThreadId: string | null
  channel: string | null
  occurredAt: string
  // The genuinely-inbound discriminators for the thread's LAST message. Portal
  // messages carry `author` ('client' | 'attorney'); ingested email carries
  // `direction` ('inbound' | 'outbound') plus the raw From — but mail.ingest
  // stamps EVERY synced message 'inbound' (handlers/mail.ts), so `fromAddress`
  // (bare, lowercased) is what actually tells the firm's own sent mail apart
  // from a client's. isInboundClientMessage reads these three.
  author: string | null
  direction: string | null
  fromAddress: string | null
  senderName: string | null
}

// Is this thread's LAST message a genuinely INBOUND client communication the
// attorney still owes a reply to? The founder bug: the feed counted the firm's
// OWN outbound email as an inbound client message, because mail.ingest stamps
// every synced message 'inbound' (handlers/mail.ts) — so a thread the firm
// replied to last looked like the client was waiting. Exclusions:
//   (a) firm-side portal replies — author is 'attorney', never 'client';
//   (b) the firm's own ingested email — From is one of the firm's connected
//       mailbox(es) / staff sign-in addresses (firmAddresses, matched
//       case-insensitively);
//   (c) AI/assistant mail — it goes out via mail.send as 'outbound', excluded by
//       the direction test below.
// Pure + exported so the exclusion is unit-tested with fixture rows, no DB.
export function isInboundClientMessage(
  row: Pick<AwaitingReplyThreadRow, 'author' | 'direction' | 'fromAddress'>,
  firmAddresses: ReadonlySet<string>,
): boolean {
  // Portal: only a client-authored post is inbound (attorney posts are 'attorney').
  if (row.author === 'client') return true
  if (row.author != null) return false
  // Email: inbound only when stamped inbound AND not sent from a firm identity.
  if (row.direction === 'inbound') {
    const from = row.fromAddress?.trim().toLowerCase()
    return !(from && firmAddresses.has(from))
  }
  return false
}

// Groups threads by (matter, sender) — never by matter alone (several people
// can write in on one matter) and never merges unrelated threads that both
// happen to lack a matter (grouped by thread id instead, so they stay
// distinct). This is the fix for the founder-walk duplicate: two threads for
// the SAME client on the SAME matter (e.g. a portal message and an email)
// previously rendered as two pixel-identical rows because the old copy showed
// only the matter number; grouping collapses them into one row with a count.
export function buildAwaitingReplyItems(
  rows: AwaitingReplyThreadRow[],
  nowMs: number,
  firmAddresses: ReadonlySet<string> = new Set(),
): AttentionItem[] {
  const groups = new Map<string, AwaitingReplyThreadRow[]>()
  for (const r of rows) {
    // Direction filter: only genuinely inbound client communications count. An
    // outbound thread with no inbound reply pending is not an attention item.
    if (!isInboundClientMessage(r, firmAddresses)) continue
    const senderKey = (r.senderName || 'a client').trim().toLowerCase()
    const scopeKey = r.matterId ?? `thread:${r.threadId}`
    const key = `${scopeKey}::${senderKey}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(r)
    else groups.set(key, [r])
  }

  const items: AttentionItem[] = []
  for (const groupRows of groups.values()) {
    // Oldest-first: the longest-unanswered thread sets the group's age (the
    // true "how long have they been waiting" figure) and its deep link.
    const sorted = [...groupRows].sort(
      (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
    )
    const oldest = sorted[0]!
    const count = sorted.length
    const senderName = oldest.senderName || 'A client'
    const days = daysSince(oldest.occurredAt, nowMs) ?? 0
    const isPortal = sorted.every((r) => r.channel === 'portal')
    const noun = count > 1 ? `${count} messages` : isPortal ? 'a portal message' : 'a message'
    const onMatter = oldest.matterNumber ? ` on ${oldest.matterNumber}` : ''
    // The matter's Activity tab shows BOTH the portal thread and every matched
    // email thread for that matter — the real "communications thread" surface
    // (linking to the matter OVERVIEW tab showed neither, which is what made
    // clicking the old row "go to nothing"). With no matter, fall back to the
    // firm inbox scoped to that Gmail thread, or the bare inbox as a last resort.
    const deepLink = oldest.matterId
      ? matterActivityDeepLink(oldest.matterId)
      : mailThreadDeepLink(oldest.gmailThreadId)
    items.push({
      kind: 'awaiting_reply',
      title: `Reply needed: ${senderName}`,
      why: `${senderName} sent ${noun}${onMatter} ${agoPhrase(days)} and is waiting for your reply.`,
      deepLink,
      rank: 0,
      occurredAt: oldest.occurredAt,
      entityId: oldest.matterId ?? undefined,
    })
  }
  return items
}

// ── Bucket readers ──────────────────────────────────────────────────────────
// Each returns UNRANKED AttentionItems (rank filled in later by the ranker).
// Grouped behind an injectable interface so feed assembly is unit-testable with
// plain fakes — no DB, no model (mirrors GetBriefToolDeps).
export interface AttentionReaderDeps {
  overdueAndDueSoonTasks: (
    ctx: ActionContext,
    t: AttentionThresholds,
    nowMs: number,
  ) => Promise<AttentionItem[]>
  awaitingReplyThreads: (ctx: ActionContext, nowMs: number) => Promise<AttentionItem[]>
  pendingReviewDrafts: (
    ctx: ActionContext,
    t: AttentionThresholds,
    nowMs: number,
  ) => Promise<AttentionItem[]>
  unsignedEnvelopes: (
    ctx: ActionContext,
    t: AttentionThresholds,
    nowMs: number,
  ) => Promise<AttentionItem[]>
  unpaidInvoices: (
    ctx: ActionContext,
    t: AttentionThresholds,
    nowMs: number,
  ) => Promise<AttentionItem[]>
  staleMatters: (
    ctx: ActionContext,
    t: AttentionThresholds,
    nowMs: number,
  ) => Promise<AttentionItem[]>
  parkedWorkflows: (
    ctx: ActionContext,
    t: AttentionThresholds,
    nowMs: number,
  ) => Promise<AttentionItem[]>
}

// TASKS — overdue + due-soon, reusing the Calendar's task-due feed (listDueTasks).
// A wide window from the epoch to now+dueSoon captures both; done tasks drop out.
async function readTasks(
  ctx: ActionContext,
  t: AttentionThresholds,
  nowMs: number,
): Promise<AttentionItem[]> {
  const tasks = await listDueTasks(ctx, {
    fromDate: '1970-01-01',
    toDateExclusive: ymd(nowMs, t.dueSoonDays + 1),
  })
  const today = ymd(nowMs)
  const items: AttentionItem[] = []
  for (const task of tasks) {
    if (task.status === 'done') continue
    const occurredAt = `${task.dueDate}T00:00:00.000Z`
    const overdue = task.dueDate < today
    const label = task.title || 'Task'
    // Deep-link straight to the task itself (matters/[id]/tasks/[taskId]), not
    // just the matter — the founder walk flagged generic matter links as
    // "goes to nothing useful" for items that have a more specific home.
    const link = taskDeepLink(task.matterEntityId, task.taskId)
    if (overdue) {
      const days = daysSince(occurredAt, nowMs) ?? 0
      items.push({
        kind: 'overdue_task',
        title: `Overdue: ${label}`,
        why: `The task "${label}" (${task.matterNumber}) was due ${agoPhrase(days)} and is not done.`,
        deepLink: link,
        rank: 0,
        occurredAt,
        entityId: task.matterEntityId,
      })
    } else {
      items.push({
        kind: 'due_soon_task',
        title: `Due soon: ${label}`,
        why: `The task "${label}" (${task.matterNumber}) is due ${task.dueDate}.`,
        deepLink: link,
        rank: 0,
        occurredAt,
        entityId: task.matterEntityId,
      })
    }
  }
  return items
}

// INBOX — a client wrote last and no one has replied. Reads the substrate's
// ingested communication record (mail.ingest for email, client.message.post for
// portal), so it works offline from Gmail and covers BOTH sources in one query:
// a mail message is client-sent when payload.direction = 'inbound'; a portal
// message when payload.author = 'client'. The last message per thread decides
// which threads qualify; PO-2 then GROUPS those threads by (matter, sender) so
// a client who has both a portal thread and an email thread open on the same
// matter — the exact case that produced two pixel-identical "M-… sent a message"
// rows in the founder walk — surfaces as ONE row with a count, not two.
//
// PO-2 (founder walk 15.9): the old copy named only the MATTER as the sender
// ("M-MRTHA103 sent a message…") — matters don't send messages, people do. This
// resolves the ACTUAL sender's name: for a portal message that is the
// client_contact entity behind sender_entity_id (exact); for an inbound email
// there is no entity link on the message, so we match the bare From address
// against every client_contact's latest `email` attribute (same pattern
// mailWorkspace.ts's clientNameIndex uses for the inbox), falling back to the
// display name in the From header, then the bare address, only ever landing on
// the generic "A client" if literally nothing could be read.
// The firm's OWN sending identities — the addresses that, appearing as an
// ingested email's From, mean the firm sent it (NOT the client). Two sources,
// unioned + lowercased: (1) the firm's connected mailbox(es) — the Google/Gmail
// integration identity (legal_integration_connection.account_email), which is
// exactly the address `mail.ingest` records on the firm's own sent mail; (2)
// every firm staff sign-in email (actor.external_id for active human actors),
// the address an attorney replying from their own Gmail sends From. Best-effort
// on the connection read so a store hiccup never blanks the whole bucket.
async function readFirmSendingAddresses(ctx: ActionContext): Promise<Set<string>> {
  const addresses = new Set<string>()
  try {
    for (const c of await listConnections(ctx.tenantId)) {
      if ((c.provider === 'google' || c.provider === 'gmail') && c.accountEmail) {
        addresses.add(c.accountEmail.trim().toLowerCase())
      }
    }
  } catch (err) {
    console.warn(
      '[attentionFeed] firm mailbox read failed:',
      err instanceof Error ? err.message : err,
    )
  }
  await withActionContext(ctx, async (client) => {
    const res = await client.query<{ external_id: string }>(
      `SELECT external_id FROM actor
        WHERE tenant_id = $1 AND actor_type = 'human' AND status = 'active'
          AND external_id LIKE '%@%'`,
      [ctx.tenantId],
    )
    for (const r of res.rows) addresses.add(r.external_id.trim().toLowerCase())
  })
  return addresses
}

async function readAwaitingReply(ctx: ActionContext, nowMs: number): Promise<AttentionItem[]> {
  const firmAddresses = await readFirmSendingAddresses(ctx)
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      thread_id: string
      matter_id: string | null
      matter_number: string | null
      gmail_thread_id: string | null
      channel: string | null
      direction: string | null
      author: string | null
      from_address: string | null
      occurred_at: string
      sender_name: string | null
    }>(
      `WITH last_msg AS (
         SELECT t.id AS thread_id,
                t.related_entity_ids[1] AS matter_id,
                t.participants->>'gmail_thread_id' AS gmail_thread_id,
                lm.channel,
                lm.direction,
                lm.author,
                lm.sender_entity_id,
                lm.from_raw,
                lm.occurred_at
           FROM communication_thread t
           JOIN LATERAL (
                SELECT m.payload->>'direction'    AS direction,
                       m.payload->>'author'       AS author,
                       m.payload->>'channel'      AS channel,
                       m.payload->>'from'         AS from_raw,
                       m.sender_entity_id         AS sender_entity_id,
                       to_char(m.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS occurred_at
                  FROM communication_message m
                 WHERE m.tenant_id = t.tenant_id AND m.thread_id = t.id
                 ORDER BY m.occurred_at DESC
                 LIMIT 1
                ) lm ON true
          WHERE t.tenant_id = $1
            AND t.status = 'active'
            AND (lm.direction = 'inbound' OR lm.author = 'client')
       ),
       -- Every client_contact's latest email + full_name, for matching an
       -- inbound email's bare From address to a real person.
       contact_names AS (
         SELECT e.id AS entity_id,
                lower((SELECT a.value #>> '{}' FROM attribute a
                         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
                        WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'email'
                        ORDER BY a.valid_from DESC LIMIT 1)) AS email,
                (SELECT a.value #>> '{}' FROM attribute a
                   JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
                  WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'full_name'
                  ORDER BY a.valid_from DESC LIMIT 1) AS full_name
           FROM entity e
           JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'client_contact'
          WHERE e.tenant_id = $1
       )
       SELECT lm.thread_id, lm.matter_id, mt.name AS matter_number,
              lm.gmail_thread_id, lm.channel, lm.direction, lm.author,
              lower(regexp_replace(coalesce(lm.from_raw, ''), '^.*<([^>]+)>.*$', '\\1')) AS from_address,
              lm.occurred_at,
              COALESCE(
                by_entity.full_name,
                by_email.full_name,
                NULLIF(trim(split_part(lm.from_raw, '<', 1)), ''),
                lower(regexp_replace(coalesce(lm.from_raw, ''), '^.*<([^>]+)>.*$', '\\1'))
              ) AS sender_name
         FROM last_msg lm
         LEFT JOIN entity mt ON mt.tenant_id = $1 AND mt.id = lm.matter_id
         LEFT JOIN contact_names by_entity ON by_entity.entity_id = lm.sender_entity_id
         LEFT JOIN contact_names by_email
           ON by_email.email = lower(regexp_replace(coalesce(lm.from_raw, ''), '^.*<([^>]+)>.*$', '\\1'))
        ORDER BY lm.occurred_at ASC`,
      [ctx.tenantId],
    )
    const rows: AwaitingReplyThreadRow[] = res.rows.map((r) => ({
      threadId: r.thread_id,
      matterId: r.matter_id,
      matterNumber: r.matter_number,
      gmailThreadId: r.gmail_thread_id,
      channel: r.channel,
      direction: r.direction,
      author: r.author,
      fromAddress: r.from_address,
      occurredAt: r.occurred_at,
      senderName: r.sender_name,
    }))
    return buildAwaitingReplyItems(rows, nowMs, firmAddresses)
  })
}

// DRAFTS — pending in the review queue past the threshold (listPendingDraftVersions).
async function readPendingDrafts(
  ctx: ActionContext,
  t: AttentionThresholds,
  nowMs: number,
): Promise<AttentionItem[]> {
  const drafts = await listPendingDraftVersions(ctx)
  const items: AttentionItem[] = []
  for (const d of drafts) {
    const days = daysSince(d.recordedAt, nowMs)
    if (days === null || days < t.draftPendingDays) continue
    const who = d.clientName || d.matterNumber
    items.push({
      kind: 'draft_pending_review',
      title: `Review draft: ${who}`,
      why: `A ${d.channel === 'communication' ? 'message' : 'document'} draft for ${who} has been waiting for your review for ${days} days.`,
      // The specific draft's review detail page, not the generic queue —
      // "goes straight to where to act" (founder walk 15.9, bullet 1).
      deepLink: draftDeepLink(d.documentVersionId),
      rank: 0,
      occurredAt: d.recordedAt,
      entityId: d.matterEntityId,
    })
  }
  return items
}

// ENVELOPES — out for signature (or waiting on the firm) past the threshold
// (listEnvelopes; completed/declined/voided are excluded by bucket).
async function readUnsignedEnvelopes(
  ctx: ActionContext,
  t: AttentionThresholds,
  nowMs: number,
): Promise<AttentionItem[]> {
  const envelopes = await listEnvelopes(ctx)
  const items: AttentionItem[] = []
  for (const e of envelopes) {
    if (e.bucket !== 'out' && e.bucket !== 'action_needed') continue
    const days = daysSince(e.sentAt, nowMs)
    if (days === null || days < t.envelopeUnsignedDays) continue
    const label = e.subject || e.matterNumber || 'An envelope'
    const why =
      e.bucket === 'action_needed'
        ? `"${label}" has been waiting on your signature for ${days} days.`
        : `"${label}" has been out for signature for ${days} days and is not signed.`
    items.push({
      kind: 'envelope_unsigned',
      title: `Unsigned: ${label}`,
      why,
      // The specific envelope's detail page, not the generic e-sign list.
      deepLink: envelopeDeepLink(e.envelopeId),
      rank: 0,
      occurredAt: e.sentAt ?? new Date(nowMs).toISOString(),
      entityId: e.matterEntityId ?? undefined,
    })
  }
  return items
}

// INVOICES — issued and unpaid past the threshold (listInvoices). Anything not
// paid/void/draft is "unpaid"; the issue date (or created date) sets the age.
const UNPAID_INVOICE_STATUSES_EXCLUDED = new Set([
  'paid',
  'void',
  'voided',
  'draft',
  'cancelled',
  'canceled',
])

async function readUnpaidInvoices(
  ctx: ActionContext,
  t: AttentionThresholds,
  nowMs: number,
): Promise<AttentionItem[]> {
  const invoices = await listInvoices(ctx)
  const items: AttentionItem[] = []
  for (const inv of invoices) {
    if (UNPAID_INVOICE_STATUSES_EXCLUDED.has(inv.status)) continue
    const occurredAt = inv.issuedDate ?? inv.createdAt
    const days = daysSince(occurredAt, nowMs)
    if (days === null || days < t.invoiceUnpaidDays) continue
    const who = inv.clientName || inv.invoiceNumber
    items.push({
      kind: 'invoice_unpaid',
      title: `Unpaid invoice: ${who}`,
      why: `Invoice ${inv.invoiceNumber} to ${who} (${inv.currency} ${inv.total}) has been unpaid for ${days} days.`,
      // The specific invoice, opened on the Invoices tab (billing/page.tsx
      // reads ?tab= and ?invoiceId= on mount — PO-2).
      deepLink: invoiceDeepLink(inv.invoiceEntityId),
      rank: 0,
      occurredAt,
      entityId: inv.invoiceEntityId,
    })
  }
  return items
}

// STALE MATTERS — active, not completed/cancelled, with no recorded event
// activity for the threshold. Activity watermark = the latest event that
// references the matter (primary or secondary), falling back to the matter's
// creation. A completed/cancelled workflow instance excludes a matter (it is
// "done", not slipping).
async function readStaleMatters(
  ctx: ActionContext,
  t: AttentionThresholds,
  nowMs: number,
): Promise<AttentionItem[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      matter_id: string
      matter_number: string
      client_name: string | null
      created_at: string
      last_event_at: string | null
    }>(
      `SELECT m.id AS matter_id,
              m.name AS matter_number,
              (SELECT a2.value #>> '{}'
                 FROM relationship r
                 JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
                 JOIN attribute a2 ON a2.tenant_id = $1 AND a2.entity_id = r.source_entity_id
                 JOIN attribute_kind_definition akd2 ON akd2.id = a2.attribute_kind_id AND akd2.kind_name = 'full_name'
                WHERE r.tenant_id = $1 AND r.target_entity_id = m.id AND rkd.kind_name = 'client_of'
                ORDER BY a2.valid_from DESC LIMIT 1) AS client_name,
              to_char(m.created_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS created_at,
              (SELECT to_char(max(e.occurred_at), 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM')
                 FROM event e
                WHERE e.tenant_id = $1
                  AND (e.primary_entity_id = m.id OR m.id = ANY(e.secondary_entity_ids))) AS last_event_at
         FROM entity m
         JOIN entity_kind_definition ekd ON ekd.id = m.entity_kind_id
        WHERE m.tenant_id = $1
          AND ekd.kind_name = 'matter'
          AND m.status = 'active'
          AND COALESCE(m.metadata->>'demo_hidden', '') <> 'true'
          AND NOT EXISTS (
                SELECT 1 FROM workflow_instance wi
                 WHERE wi.tenant_id = $1
                   AND wi.subject_entity_id = m.id
                   AND wi.status IN ('completed', 'cancelled'))`,
      [ctx.tenantId],
    )
    const items: AttentionItem[] = []
    for (const r of res.rows) {
      const occurredAt = r.last_event_at ?? r.created_at
      const days = daysSince(occurredAt, nowMs)
      if (days === null || days < t.staleMatterDays) continue
      const who = r.client_name || r.matter_number
      items.push({
        kind: 'stale_matter',
        title: `No activity: ${who}`,
        why: `The matter for ${who} (${r.matter_number}) has had no activity for ${days} days.`,
        deepLink: `/attorney/matters/${r.matter_id}`,
        rank: 0,
        occurredAt,
        entityId: r.matter_id,
      })
    }
    return items
  })
}

// PARKED WORKFLOWS — a running instance that has not advanced past the
// threshold. An active instance stuck on one step is waiting on a human gate
// (automatic steps advance immediately; being parked for days means someone
// must act). The current step's entry time is the last state_history entry's
// `at`, falling back to the instance start.
async function readParkedWorkflows(
  ctx: ActionContext,
  t: AttentionThresholds,
  nowMs: number,
): Promise<AttentionItem[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      matter_id: string
      matter_number: string
      current_state: string
      entered_at: string | null
    }>(
      `SELECT wi.subject_entity_id AS matter_id,
              m.name AS matter_number,
              wi.current_state,
              COALESCE(
                wi.state_history -> -1 ->> 'at',
                to_char(wi.started_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM')
              ) AS entered_at
         FROM workflow_instance wi
         JOIN entity m ON m.tenant_id = $1 AND m.id = wi.subject_entity_id
        WHERE wi.tenant_id = $1
          AND wi.status = 'active'
          AND m.status = 'active'
          AND COALESCE(m.metadata->>'demo_hidden', '') <> 'true'`,
      [ctx.tenantId],
    )
    const items: AttentionItem[] = []
    for (const r of res.rows) {
      const days = daysSince(r.entered_at, nowMs)
      if (days === null || days < t.workflowParkedDays) continue
      const step = (r.current_state || 'a step').replace(/_/g, ' ')
      items.push({
        kind: 'workflow_parked',
        title: `Stuck: ${r.matter_number}`,
        why: `The matter ${r.matter_number} has been sitting at the "${step}" step for ${days} days.`,
        deepLink: `/attorney/matters/${r.matter_id}`,
        rank: 0,
        occurredAt: r.entered_at ?? new Date(nowMs).toISOString(),
        entityId: r.matter_id,
      })
    }
    return items
  })
}

const DEFAULT_READERS: AttentionReaderDeps = {
  overdueAndDueSoonTasks: readTasks,
  awaitingReplyThreads: readAwaitingReply,
  pendingReviewDrafts: readPendingDrafts,
  unsignedEnvelopes: readUnsignedEnvelopes,
  unpaidInvoices: readUnpaidInvoices,
  staleMatters: readStaleMatters,
  parkedWorkflows: readParkedWorkflows,
}

// Drop the noisiest overlap: a matter that is BOTH "no activity" and "stuck at a
// step" surfaces once (the more specific parked signal wins). Every other
// overlap (an unsigned envelope AND an unpaid invoice on one matter) is left as
// distinct real work.
function dedupeStaleUnderParked(items: AttentionItem[]): AttentionItem[] {
  const parkedMatters = new Set(
    items.filter((i) => i.kind === 'workflow_parked' && i.entityId).map((i) => i.entityId),
  )
  return items.filter(
    (i) => !(i.kind === 'stale_matter' && i.entityId && parkedMatters.has(i.entityId)),
  )
}

export interface AttentionFeedOptions {
  // Per-firm threshold overrides (config seam; defaults documented above).
  thresholds?: Partial<AttentionThresholds>
  // Injected clock for determinism in tests; defaults to now.
  now?: number
  // Cap the number of items returned (after ranking). Default: no cap.
  maxItems?: number
  // Cap the TOTAL rendered size (sum of renderAttentionLine lengths). Items are
  // kept in rank order until the budget is exhausted. Default: no cap.
  maxChars?: number
  // Injectable bucket readers (defaults hit the DB); tests pass fakes.
  readers?: Partial<AttentionReaderDeps>
}

// getAttentionFeed — the engine. Runs every bucket (tenant-scoped), concatenates,
// dedupes the stale/parked overlap, ranks deterministically, and applies the
// item/char caps. A single bucket failing is non-fatal: it is logged-and-skipped
// so a live-read hiccup (e.g. a slow envelope read) never blanks the whole feed.
export async function getAttentionFeed(
  ctx: ActionContext,
  opts: AttentionFeedOptions = {},
): Promise<AttentionItem[]> {
  const nowMs = opts.now ?? Date.now()
  const thresholds: AttentionThresholds = { ...DEFAULT_ATTENTION_THRESHOLDS, ...opts.thresholds }
  const readers: AttentionReaderDeps = { ...DEFAULT_READERS, ...opts.readers }

  const results = await Promise.all([
    safe(() => readers.overdueAndDueSoonTasks(ctx, thresholds, nowMs)),
    safe(() => readers.awaitingReplyThreads(ctx, nowMs)),
    safe(() => readers.pendingReviewDrafts(ctx, thresholds, nowMs)),
    safe(() => readers.unsignedEnvelopes(ctx, thresholds, nowMs)),
    safe(() => readers.unpaidInvoices(ctx, thresholds, nowMs)),
    safe(() => readers.staleMatters(ctx, thresholds, nowMs)),
    safe(() => readers.parkedWorkflows(ctx, thresholds, nowMs)),
  ])

  const ranked = rankAttentionItems(dedupeStaleUnderParked(results.flat()), nowMs)

  const capped =
    typeof opts.maxItems === 'number' ? ranked.slice(0, Math.max(0, opts.maxItems)) : ranked
  if (typeof opts.maxChars !== 'number') return capped

  const out: AttentionItem[] = []
  let used = 0
  for (const it of capped) {
    const cost = renderAttentionLine(it).length + 1
    if (used + cost > opts.maxChars && out.length > 0) break
    out.push(it)
    used += cost
  }
  return out
}

// A bucket read that never throws: a failure yields an empty bucket (logged) so
// the rest of the feed still assembles.
async function safe(run: () => Promise<AttentionItem[]>): Promise<AttentionItem[]> {
  try {
    return await run()
  } catch (err) {
    console.warn('[attentionFeed] bucket read failed:', err instanceof Error ? err.message : err)
    return []
  }
}
