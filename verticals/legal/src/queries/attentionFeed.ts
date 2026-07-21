// FB-H — the ATTENTION ENGINE. A DETERMINISTIC feed of INBOUND events that need
// the attorney's attention: the FEED IS CODE, not a model guess — every item is
// a tenant-scoped read of real state, ranked by a pure, unit-tested ranker. Three
// consumers ride this one engine: the get_attention_feed chat tool, the
// global-scope volatile snapshot, and the attorney home "Attention" card.
//
// ATTN-FIX-1 (founder directive): this feed shows ONLY inbound things — a client
// booking a meeting, sending a message, or completing a step that needs the
// attorney. Firm-self-generated state (an unsent draft, an unsigned envelope, an
// unpaid invoice, a stale-matter nudge, a parked workflow, the firm's own tasks)
// is NOT an inbound event and belongs on a Tasks surface, not here — those
// classes were removed (see PR body). Of the classes #448 built, only
// awaiting_reply (a client sent a message) is genuinely inbound and survives;
// booking / step-completion / upload / e-sign-signed are proposed follow-ups.
import { withActionContext, type ActionContext } from '@exsto/substrate'
import { listConnections } from '../adapters/connectionStore.js'

// The kinds of inbound thing the feed surfaces. New inbound kinds (client booked
// a meeting, completed a client-gated step, uploaded a requested document, signed
// an envelope) get added here as their readers land.
export type AttentionKind = 'awaiting_reply'

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
  // The primary matter/entity this item is about, when it has one — a stable
  // React key on the home card and the item's deep-link subject. Optional (a
  // matter-less inbox thread has none).
  entityId?: string
}

// The priority BAND each kind sits in (lower = more pressing). Within a band the
// ranker breaks ties by age (older occurredAt first). One inbound kind today;
// new inbound kinds slot in here (a client booking/step-completion would rank
// alongside a reply) and the by-age tiebreak keeps ordering deterministic.
const ATTENTION_TIER: Record<AttentionKind, number> = {
  awaiting_reply: 0,
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
// An item links straight to its real subject, not a generic list page. Small,
// pure, exported so the shape is unit-testable without a DB — the same reasoning
// that keeps rankAttentionItems pure and exported. An awaiting-reply item links
// to the matter's Activity tab (both portal + email threads) or the firm inbox.
export function matterActivityDeepLink(matterEntityId: string): string {
  return `/attorney/matters/${matterEntityId}/activity`
}
export function mailThreadDeepLink(gmailThreadId: string | null): string {
  return gmailThreadId ? `/attorney/mail?thread=${gmailThreadId}` : '/attorney/mail'
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
  // The resolved SENDER contact name (the actual person who wrote), or null when
  // the sender is not a known client_contact.
  senderName: string | null
  // The matter's primary client contact name — the fallback the item names when
  // the sender did not resolve to a person. Null when the thread has no matter.
  matterClientName: string | null
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

// The PERSON an item names (ATTN-FIX-1 second half): the resolved sender contact
// (the actual human who wrote), else the matter's primary client, else the
// generic "A client" — NEVER a mailbox display name (the founder bug rendered the
// firm mailbox "Pacheco Law - Legal Instruments (beta)"), a bare From address, or
// the matter code ("M-MRTHA103 sent a message"). Pure so the fallback order is
// unit-tested with fixture rows, no DB.
export function awaitingReplyDisplayName(r: AwaitingReplyThreadRow): string {
  return r.senderName?.trim() || r.matterClientName?.trim() || 'A client'
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
    const senderKey = awaitingReplyDisplayName(r).toLowerCase()
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
    const senderName = awaitingReplyDisplayName(oldest)
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
// Behind an injectable interface so feed assembly is unit-testable with plain
// fakes — no DB, no model (mirrors GetBriefToolDeps). ONE inbound bucket today;
// new inbound readers (client booked a meeting, completed a client-gated step,
// uploaded a requested document, signed an envelope) join here as they land.
export interface AttentionReaderDeps {
  awaitingReplyThreads: (ctx: ActionContext, nowMs: number) => Promise<AttentionItem[]>
}

// INBOX — a client wrote last and no one has replied. Reads the substrate's
// ingested communication record (mail.ingest for email, client.message.post for
// portal), so it works offline from Gmail and covers BOTH sources in one query.
// The last message per thread decides whether the thread qualifies, and
// isInboundClientMessage (ATTN-FIX-1) then keeps ONLY genuinely inbound client
// mail: a portal message with author = 'client', or an email whose From is NOT
// one of the firm's own sending identities — because mail.ingest stamps every
// synced message 'inbound' (handlers/mail.ts), the raw direction alone would
// count the firm's own sent reply as the client waiting. PO-2 then GROUPS the
// surviving threads by (matter, sender) so
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
      matter_client_name: string | null
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
              -- The actual SENDER contact (portal sender_entity_id, else the
              -- inbound email's From matched to a client_contact email). NULL when
              -- no known contact resolves — we NEVER fall back to the From-header
              -- display name or the bare address here (that is how the firm
              -- mailbox name leaked in); the matter's client is the fallback below.
              COALESCE(by_entity.full_name, by_email.full_name) AS sender_name,
              -- The matter's primary client contact (the client_of source), so an
              -- item always names a person even when the sender did not resolve.
              (SELECT a2.value #>> '{}'
                 FROM relationship r
                 JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
                 JOIN attribute a2 ON a2.tenant_id = $1 AND a2.entity_id = r.source_entity_id
                 JOIN attribute_kind_definition akd2 ON akd2.id = a2.attribute_kind_id AND akd2.kind_name = 'full_name'
                WHERE r.tenant_id = $1 AND r.target_entity_id = lm.matter_id AND rkd.kind_name = 'client_of'
                ORDER BY a2.valid_from DESC LIMIT 1) AS matter_client_name
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
      matterClientName: r.matter_client_name,
    }))
    return buildAwaitingReplyItems(rows, nowMs, firmAddresses)
  })
}

const DEFAULT_READERS: AttentionReaderDeps = {
  awaitingReplyThreads: readAwaitingReply,
}

export interface AttentionFeedOptions {
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

// getAttentionFeed — the engine. Runs every inbound bucket (tenant-scoped),
// concatenates, ranks deterministically, and applies the item/char caps. A
// bucket failing is non-fatal: it is logged-and-skipped so a live-read hiccup
// never blanks the whole feed.
export async function getAttentionFeed(
  ctx: ActionContext,
  opts: AttentionFeedOptions = {},
): Promise<AttentionItem[]> {
  const nowMs = opts.now ?? Date.now()
  const readers: AttentionReaderDeps = { ...DEFAULT_READERS, ...opts.readers }

  const results = await Promise.all([safe(() => readers.awaitingReplyThreads(ctx, nowMs))])

  const ranked = rankAttentionItems(results.flat(), nowMs)

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
