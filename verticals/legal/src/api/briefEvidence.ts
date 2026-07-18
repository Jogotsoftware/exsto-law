// Brief engine WP1 — EVIDENCE ASSEMBLY (design: scratchpad brief-engine-design.md
// §1–2). Pure, deterministic, read-only, tenant-scoped orchestration over the
// substrate's EXISTING readers. No AI call, no persistence, no UI, no new MCP
// tool — this is the layer WP2 (Matter Brief), WP3 (Client Brief), and WP4
// (Service Digest) all synthesize on top of via one Claude call each.
//
// assembleBriefEvidence(ctx, scope, budget) -> EvidenceBundle: a labelled,
// source-tagged list of sections in a DETERMINISTIC priority order per scope,
// each budget-clipped with an explicit `truncated` flag (never a silent cut,
// never an empty-string section — an empty source is OMITTED). Every section's
// content is neutralized against the same delimiter-forgery guard
// assistantContext.ts uses (`neutralizeDelimiters`) so a hostile client
// email/note can't fake a fence when this bundle is later embedded in a WP2
// synthesis prompt. `sourceWatermark` is the design's staleness key — the max
// action/event recorded_at seen across the scope's sources.
//
// SPLIT FOR TESTABILITY (mirrors buildBrief.ts's formatBuildBrief/
// loadBuildBriefParts split): each scope has a private DB-loading function
// (loadXMaterial) and an EXPORTED PURE builder (buildXEvidence) that turns
// already-fetched material into the EvidenceBundle. Unit tests fake the
// material directly — the material bag IS what the readers return, so no DB and
// no module mocking are needed to pin section order / budgets / truncation /
// watermark / fencing.
//
// REUSE, DON'T FORK: every render helper below that already exists
// (renderEmails/renderTasks/renderDocuments/renderMeetings/renderInvoiced/
// renderIntake/fmtDate/clip/neutralizeDelimiters/safeField from
// assistantContext.ts; oneLine from clientContext.ts) is IMPORTED, not
// reimplemented — those files only had their `export` keyword added, no
// behavior changed, so their existing (DB-gated) tests keep passing unchanged.
import type { ActionContext } from '@exsto/substrate'
import {
  clip,
  fmtDate,
  neutralizeDelimiters,
  renderDocuments,
  renderEmails,
  renderIntake,
  renderInvoiced,
  renderMeetings,
  renderTasks,
  safeField,
} from './assistantContext.js'
import { getMatter, type MatterDetail } from '../queries/matters.js'
import { getMatterHistory, type MatterHistory } from '../queries/history.js'
import { listNotesForEntity, type NoteSummary } from '../queries/notes.js'
import { listTasksByMatter, type Task } from '../queries/tasks.js'
import { listMeetingsForMatter, type MeetingSummary } from '../queries/meetings.js'
import { listMatterInvoiced, type MatterInvoicedItem } from '../queries/billing.js'
import { listMatterDraftVersions, type PendingDraftSummary } from '../queries/drafts.js'
import {
  matterCommunicationBodies,
  matterCommunications,
  type MatterCommunication,
  type MatterMessageBody,
} from './mailWorkspace.js'
import { getMatterThread, type PortalMessage } from './clientMessaging.js'
import { listMatterDocuments, type UploadedDocItem } from './documentUpload.js'
import { listEnvelopes, type EnvelopeListItem } from './esign.js'
import { listMatterResearch, type MatterResearchEntry } from './research.js'
import { getClientContext, oneLine, type ClientContext } from '../queries/clientContext.js'
import { listServiceDigestSignals, type ServiceDigestSignals } from '../queries/serviceDigest.js'

export type BriefScope =
  | { kind: 'matter'; matterEntityId: string }
  | { kind: 'client'; clientEntityId: string }
  | { kind: 'service_digest'; serviceKey: string }

export type EvidenceBudget = 'lean' | 'balanced' | 'generous'

export interface EvidenceSection {
  source: string
  label: string
  content: string
  truncated: boolean
}

export interface EvidenceBundle {
  sections: EvidenceSection[]
  // The staleness key (design §3): max action/event recorded_at seen across the
  // scope's sources. Falls back to `assembledAt` when no source carries a
  // timestamp (e.g. a service_digest scope with no signals yet).
  sourceWatermark: string
  assembledAt: string
  scope: BriefScope
  budget: EvidenceBudget
}

// ── Budgets (DEPTH_BUDGETS' idea, extended to brief sections) ───────────────
// Hard caps per tier — a Brief is read once by a synthesis call (WP2+), not
// replayed every chat turn, so these run larger than assistantContext's
// DEPTH_BUDGETS, but they are still explicit hard caps: no section grows
// unbounded. `sectionChars` is the generic safety-net clip applied to every
// already-item-capped list section; a few sources get their own knob because
// item count alone doesn't bound their size (intake/transcript text, research
// answers, per-message communication bodies).
interface EvidenceBudgetConfig {
  sectionChars: number
  matterCoreChars: number
  intakeChars: number
  transcriptChars: number
  commMessages: number
  commBodyChars: number
  commThreadItems: number
  portalItems: number
  timelineItems: number
  notesItems: number
  draftDocItems: number
  uploadedDocItems: number
  taskItems: number
  meetingItems: number
  invoicedItems: number
  envelopeItems: number
  researchItems: number
  researchChars: number
  clientMatterItems: number
  clientNotesItems: number
  clientTranscriptItems: number
  clientMessageItems: number
  digestItems: number
}

const EVIDENCE_BUDGETS: Record<EvidenceBudget, EvidenceBudgetConfig> = {
  lean: {
    sectionChars: 2500,
    matterCoreChars: 3000,
    intakeChars: 1000,
    transcriptChars: 1500,
    commMessages: 5,
    commBodyChars: 800,
    commThreadItems: 10,
    portalItems: 10,
    timelineItems: 20,
    notesItems: 12,
    draftDocItems: 10,
    uploadedDocItems: 10,
    taskItems: 15,
    meetingItems: 8,
    invoicedItems: 10,
    envelopeItems: 5,
    researchItems: 3,
    researchChars: 1200,
    clientMatterItems: 8,
    clientNotesItems: 12,
    clientTranscriptItems: 6,
    clientMessageItems: 8,
    digestItems: 10,
  },
  balanced: {
    sectionChars: 5000,
    matterCoreChars: 6000,
    intakeChars: 2000,
    transcriptChars: 4000,
    commMessages: 10,
    commBodyChars: 1500,
    commThreadItems: 20,
    portalItems: 20,
    timelineItems: 40,
    notesItems: 25,
    draftDocItems: 20,
    uploadedDocItems: 20,
    taskItems: 30,
    meetingItems: 15,
    invoicedItems: 20,
    envelopeItems: 10,
    researchItems: 6,
    researchChars: 2500,
    clientMatterItems: 15,
    clientNotesItems: 25,
    clientTranscriptItems: 12,
    clientMessageItems: 8,
    digestItems: 25,
  },
  generous: {
    sectionChars: 10000,
    matterCoreChars: 12000,
    intakeChars: 4000,
    transcriptChars: 12000,
    commMessages: 20,
    commBodyChars: 4000,
    commThreadItems: 40,
    portalItems: 40,
    timelineItems: 80,
    notesItems: 60,
    draftDocItems: 40,
    uploadedDocItems: 40,
    taskItems: 60,
    meetingItems: 30,
    invoicedItems: 40,
    envelopeItems: 20,
    researchItems: 12,
    researchChars: 5000,
    clientMatterItems: 20,
    clientNotesItems: 60,
    clientTranscriptItems: 20,
    clientMessageItems: 8,
    digestItems: 60,
  },
}

// ── Shared section-building primitives ───────────────────────────────────────

// Clip already-rendered text to a section's char budget with the SAME clip()
// assistantContext uses, returning whether truncation happened.
function clipSection(text: string, maxChars: number): { content: string; truncated: boolean } {
  const t = text.trim()
  if (!t) return { content: '', truncated: false }
  if (t.length <= maxChars) return { content: t, truncated: false }
  return { content: clip(t, maxChars), truncated: true }
}

// Push a section unless it has no content — an empty source is OMITTED, never
// an empty-string placeholder. `itemsTruncated` lets the caller OR in a
// list-level cap (fullList.length > takenCount) that clipSection alone can't
// see. Every section's content is neutralized (fence-forgery guard) here, once,
// so no call site can forget it.
function pushSection(
  sections: EvidenceSection[],
  source: string,
  label: string,
  rawText: string,
  maxChars: number,
  itemsTruncated = false,
): void {
  const { content, truncated } = clipSection(rawText, maxChars)
  if (!content) return
  sections.push({
    source,
    label,
    content: neutralizeDelimiters(content),
    truncated: truncated || itemsTruncated,
  })
}

// clip()'s own truncation marker (assistantContext.ts) — checking for it lets a
// section that clips ONE inner field (an intake block, a research answer) OR its
// item-count/outer-char cap into its `truncated` flag WITHOUT re-implementing
// clip()'s truncation test a second time.
const TRUNCATION_SUFFIX = '…[truncated]'
function wasClipped(s: string): boolean {
  return s.endsWith(TRUNCATION_SUFFIX)
}

// The max of a set of ISO timestamps (any offset — compared numerically via
// Date.parse, not lexically, so differing TZ offsets never mis-order). Null
// input entries are ignored; returns null when nothing parses. EXPORTED (WP3):
// clientBriefEngine's computeClientWatermark needs the exact same numeric-max
// semantics for its lighter (matters-list-only, no full ClientContext) read.
export function maxTimestamp(values: Array<string | null | undefined>): string | null {
  let bestStr: string | null = null
  let bestMs = -Infinity
  for (const v of values) {
    if (!v) continue
    const ms = Date.parse(v)
    if (!Number.isFinite(ms)) continue
    if (ms > bestMs) {
      bestMs = ms
      bestStr = v
    }
  }
  return bestStr
}

// ── Matter scope ─────────────────────────────────────────────────────────────

interface MatterMaterial {
  matter: MatterDetail
  history: MatterHistory
  notes: NoteSummary[]
  commBodies: MatterMessageBody[]
  commThreads: MatterCommunication[]
  portalThread: PortalMessage[]
  draftDocs: PendingDraftSummary[]
  uploadedDocs: UploadedDocItem[]
  tasks: Task[]
  meetings: MeetingSummary[]
  invoiced: { items: MatterInvoicedItem[]; currency: string }
  envelopes: EnvelopeListItem[]
  research: MatterResearchEntry[]
}

async function loadMatterMaterial(
  ctx: ActionContext,
  matterEntityId: string,
  b: EvidenceBudgetConfig,
): Promise<MatterMaterial | null> {
  const matter = await getMatter(ctx, matterEntityId)
  if (!matter) return null

  const [
    history,
    notes,
    commBodies,
    commThreads,
    portalThread,
    draftDocs,
    uploadedDocs,
    tasks,
    meetings,
    invoiced,
    envelopesAll,
    research,
  ] = await Promise.all([
    getMatterHistory(ctx, matterEntityId),
    listNotesForEntity(ctx, matterEntityId),
    matterCommunicationBodies(ctx, matterEntityId, {
      maxMessages: b.commMessages,
      maxBodyChars: b.commBodyChars,
    }),
    matterCommunications(ctx, matterEntityId),
    getMatterThread(ctx, matterEntityId),
    listMatterDraftVersions(ctx, matterEntityId),
    listMatterDocuments(ctx, matterEntityId),
    listTasksByMatter(ctx, matterEntityId),
    listMeetingsForMatter(ctx, matterEntityId),
    listMatterInvoiced(ctx, matterEntityId),
    // eSign has no matter-scoped read today (design §2's "esign status reads" is
    // the tenant-wide `legal.esign.envelopes_list`/`legal.esign.status`) — filter
    // the existing tenant-scoped list in-process rather than forking a new query.
    listEnvelopes(ctx),
    listMatterResearch(ctx, matterEntityId),
  ])

  return {
    matter,
    history,
    notes,
    commBodies,
    commThreads,
    portalThread,
    draftDocs,
    uploadedDocs,
    tasks,
    meetings,
    invoiced,
    envelopes: envelopesAll.filter((e) => e.matterEntityId === matterEntityId),
    research,
  }
}

// The design's staleness key for a matter: max recorded_at over the matter's
// OWN actions/events (getMatterHistory) — exactly ADR/design §3's definition.
function matterWatermark(history: MatterHistory): string | null {
  return maxTimestamp([
    ...history.actions.map((a) => a.recordedAt),
    ...history.events.map((e) => e.occurredAt),
  ])
}

// PURE — builds the Matter Brief's EvidenceBundle from already-fetched
// material. Section order (design §2, notes bumped to first-class per the
// 2026-07-17 founder addendum): core → timeline → notes → communications →
// communication threads → portal thread → drafted documents → uploaded
// documents → tasks → meetings → billing → e-signature → prior research.
export function buildMatterEvidence(
  material: MatterMaterial,
  scope: Extract<BriefScope, { kind: 'matter' }>,
  budget: EvidenceBudget,
  assembledAt: string,
): EvidenceBundle {
  const b = EVIDENCE_BUDGETS[budget]
  const sections: EvidenceSection[] = []
  const {
    matter,
    history,
    notes,
    commBodies,
    commThreads,
    portalThread,
    draftDocs,
    uploadedDocs,
    tasks,
    meetings,
    invoiced,
    envelopes,
    research,
  } = material

  // 1. Matter core — facts + intake + transcript.
  const coreLines = [
    `Matter ${safeField(matter.matterNumber)} — service: ${safeField(matter.serviceKey) || 'unspecified'}; status: ${safeField(matter.status)}; opened ${fmtDate(matter.createdAt)}.`,
    `Client: ${safeField(matter.clientName) || 'unknown'}${matter.clientEmail ? ` <${safeField(matter.clientEmail)}>` : ''}.`,
  ]
  // Inner clips (intake/transcript) can each truncate independently of the
  // outer matterCoreChars safety net — track them so the section's `truncated`
  // flag is honest even when the combined block still fits under that cap.
  let coreInnerTruncated = false
  if (matter.questionnaireResponses && Object.keys(matter.questionnaireResponses).length > 0) {
    const intake = renderIntake(matter.questionnaireResponses, b.intakeChars)
    if (intake) {
      coreLines.push(`Intake questionnaire responses:\n${intake}`)
      if (wasClipped(intake)) coreInnerTruncated = true
    }
  }
  if (matter.transcriptText) {
    const transcript = clip(matter.transcriptText, b.transcriptChars)
    coreLines.push(`Consultation call transcript:\n${transcript}`)
    if (wasClipped(transcript)) coreInnerTruncated = true
  }
  pushSection(
    sections,
    'matter',
    'Matter core',
    coreLines.join('\n\n'),
    b.matterCoreChars,
    coreInnerTruncated,
  )

  // 2. Timeline — actions + events merged newest-first (the two source arrays
  // are each already ascending; this is the one section that needs its own sort).
  const timelineAll = [
    ...history.actions.map((a) => ({
      t: a.recordedAt,
      line: `- [action] ${a.kindName} by ${safeField(a.actorName)} (${a.intentKind}${a.hasReasoningTrace ? ', reasoning trace' : ''}) — ${fmtDate(a.recordedAt)}`,
    })),
    ...history.events.map((e) => ({
      t: e.occurredAt,
      line: `- [event] ${e.kindName} — ${fmtDate(e.occurredAt)}`,
    })),
  ].sort((x, y) => (x.t < y.t ? 1 : x.t > y.t ? -1 : 0))
  pushSection(
    sections,
    'history',
    'Timeline',
    timelineAll
      .slice(0, b.timelineItems)
      .map((x) => x.line)
      .join('\n'),
    b.sectionChars,
    timelineAll.length > b.timelineItems,
  )

  // 3. Notes — FIRST-CLASS (2026-07-17 founder addendum): always attempted,
  // never budget-gated to zero. Omitted only when the matter truly has none.
  const notesText = notes
    .slice(0, b.notesItems)
    .map(
      (n) =>
        `- (${n.source}, ${fmtDate(n.createdAt)}) ${safeField(n.authorName) || n.authorType || 'unknown'}: ${n.body}`,
    )
    .join('\n')
  pushSection(sections, 'notes', 'Notes', notesText, b.sectionChars, notes.length > b.notesItems)

  // 4. Client communications (full bodies) — reuses assistantContext's renderer.
  pushSection(
    sections,
    'communications',
    'Client communications (bodies)',
    renderEmails(commBodies),
    b.sectionChars,
    commBodies.some((m) => m.truncated) || commBodies.length >= b.commMessages,
  )

  // 5. Communication threads — the broader index (every thread touching the
  // matter, not just the ones with captured bodies).
  const threadsText = commThreads
    .slice(0, b.commThreadItems)
    .map(
      (t) =>
        `- "${safeField(t.subject)}" — ${t.messageCount} message(s), last ${t.lastAt ? fmtDate(t.lastAt) : 'unknown'}: ${oneLine(t.lastPreview ?? '', 160)}`,
    )
    .join('\n')
  pushSection(
    sections,
    'communication_threads',
    'Communication threads',
    threadsText,
    b.sectionChars,
    commThreads.length > b.commThreadItems,
  )

  // 6. Portal thread — oldest-first from the reader; keep the MOST RECENT N
  // while preserving conversational order.
  const portalText = portalThread
    .slice(-b.portalItems)
    .map((m) => `- [${m.author}] ${fmtDate(m.sentAt)}: ${m.body}`)
    .join('\n')
  pushSection(
    sections,
    'portal_thread',
    'Portal thread',
    portalText,
    b.sectionChars,
    portalThread.length > b.portalItems,
  )

  // 7. Drafted documents.
  pushSection(
    sections,
    'documents',
    'Drafted documents',
    renderDocuments(draftDocs.slice(0, b.draftDocItems)),
    b.sectionChars,
    draftDocs.length > b.draftDocItems,
  )

  // 8. Uploaded documents.
  const uploadedText = uploadedDocs
    .slice(0, b.uploadedDocItems)
    .map((d) => `- ${safeField(d.originalFilename)} (${d.documentKind}) — ${fmtDate(d.uploadedAt)}`)
    .join('\n')
  pushSection(
    sections,
    'uploaded_documents',
    'Uploaded documents',
    uploadedText,
    b.sectionChars,
    uploadedDocs.length > b.uploadedDocItems,
  )

  // 9. Tasks.
  pushSection(
    sections,
    'tasks',
    'Tasks',
    renderTasks(tasks.slice(0, b.taskItems)),
    b.sectionChars,
    tasks.length > b.taskItems,
  )

  // 10. Meetings.
  pushSection(
    sections,
    'meetings',
    'Meetings',
    renderMeetings(meetings.slice(0, b.meetingItems)),
    b.sectionChars,
    meetings.length > b.meetingItems,
  )

  // 11. Billing (invoiced).
  pushSection(
    sections,
    'billing',
    `Billing invoiced (${invoiced.currency})`,
    renderInvoiced(invoiced.items.slice(0, b.invoicedItems)),
    b.sectionChars,
    invoiced.items.length > b.invoicedItems,
  )

  // 12. E-signature.
  const envText = envelopes
    .slice(0, b.envelopeItems)
    .map(
      (e) =>
        `- "${safeField(e.subject) || e.documentKind || 'envelope'}" — ${e.status} (${e.signedCount}/${e.signerCount} signed), sent ${e.sentAt ? fmtDate(e.sentAt) : 'unknown'}`,
    )
    .join('\n')
  pushSection(
    sections,
    'esign',
    'E-signature',
    envText,
    b.sectionChars,
    envelopes.length > b.envelopeItems,
  )

  // 13. Prior research — track per-answer clipping (independent of the item cap)
  // the same way the matter-core section does.
  const researchTaken = research.slice(0, b.researchItems).map((r) => {
    const answer = clip(r.answer, b.researchChars)
    return { line: `- Q: ${safeField(r.question)}\n  A: ${answer}`, clipped: wasClipped(answer) }
  })
  pushSection(
    sections,
    'research',
    'Prior research',
    researchTaken.map((x) => x.line).join('\n'),
    b.sectionChars,
    research.length > b.researchItems || researchTaken.some((x) => x.clipped),
  )

  const watermark = matterWatermark(history)
  return {
    sections,
    sourceWatermark: watermark ?? assembledAt,
    assembledAt,
    scope,
    budget,
  }
}

// ── Client scope ──────────────────────────────────────────────────────────────

interface ClientMaterial {
  context: ClientContext
  // Max recorded_at across ALL of the client's matters' actions/events — one
  // getMatterHistory read per matter (design: "for client scope the max across
  // the client's matters").
  watermark: string | null
}

async function loadClientMaterial(
  ctx: ActionContext,
  clientEntityId: string,
): Promise<ClientMaterial | null> {
  const context = await getClientContext(ctx, clientEntityId)
  if (!context) return null

  const histories = await Promise.all(
    context.matters.map((m) => getMatterHistory(ctx, m.matterEntityId)),
  )
  const watermark = maxTimestamp(
    histories.flatMap((h) => [
      ...h.actions.map((a) => a.recordedAt),
      ...h.events.map((e) => e.occurredAt),
    ]),
  )
  return { context, watermark }
}

// PURE — builds the Client Brief's EvidenceBundle. Section order: client core →
// notes (client-level + every matter's, flattened — first-class) → matters
// overview (every matter, per the design's "client + all their matters") →
// transcripts → recent messages.
export function buildClientEvidence(
  material: ClientMaterial,
  scope: Extract<BriefScope, { kind: 'client' }>,
  budget: EvidenceBudget,
  assembledAt: string,
): EvidenceBundle {
  const b = EVIDENCE_BUDGETS[budget]
  const sections: EvidenceSection[] = []
  const c = material.context

  // 1. Client core.
  const contactsLine = c.contacts.length
    ? `Contacts: ${c.contacts.map((x) => `${safeField(x.fullName)} <${safeField(x.email)}>`).join('; ')}.`
    : ''
  pushSection(
    sections,
    'client',
    'Client',
    [`Client: ${safeField(c.name)}.`, contactsLine].filter(Boolean).join('\n'),
    b.sectionChars,
  )

  // 2. Notes — client-level + every matter's, flattened newest-first. FIRST-CLASS
  // (2026-07-17 founder addendum): always attempted for both brief types.
  const allNotes = [
    ...c.clientNotes.map((n) => ({ ...n, matterNumber: null as string | null })),
    ...c.matters.flatMap((m) => m.notes.map((n) => ({ ...n, matterNumber: m.matterNumber }))),
  ].sort((x, y) => (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0))
  const notesText = allNotes
    .slice(0, b.clientNotesItems)
    .map(
      (n) =>
        `- ${n.matterNumber ? `[matter ${safeField(n.matterNumber)}] ` : '[client] '}(${n.source}, ${fmtDate(n.createdAt)}): ${n.body}`,
    )
    .join('\n')
  pushSection(
    sections,
    'notes',
    'Notes',
    notesText,
    b.sectionChars,
    allNotes.length > b.clientNotesItems,
  )

  // 3. Matters overview — EVERY matter (getClientContext already includes
  // archived matters; notes are surfaced in section 2, not repeated here).
  const mattersText = c.matters
    .slice(0, b.clientMatterItems)
    .map((m) => {
      const lines = [
        `Matter ${safeField(m.matterNumber)} — service: ${m.serviceKey || '(none)'}; status: ${m.matterStatus}${m.archived ? '; ARCHIVED (completed work)' : ''}; opened ${m.openedAt}.`,
      ]
      if (m.intakeFacts) {
        lines.push(
          `  Intake: ${Object.entries(m.intakeFacts)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join('; ')}`,
        )
      }
      for (const d of m.releasedDocuments) {
        lines.push(`  Released document: ${d.documentKind} v${d.versionNumber} (${d.approvedAt})`)
      }
      return lines.join('\n')
    })
    .join('\n\n')
  pushSection(
    sections,
    'matters',
    'Matters',
    mattersText,
    b.sectionChars,
    c.matters.length > b.clientMatterItems,
  )

  // 4. Call transcripts.
  const transcriptText = c.transcripts
    .slice(0, b.clientTranscriptItems)
    .map(
      (t) =>
        `- ${t.createdAt}${t.matterNumber ? ` (matter ${safeField(t.matterNumber)})` : ''}: ${oneLine(t.excerpt, 400)}`,
    )
    .join('\n')
  pushSection(
    sections,
    'transcripts',
    'Call transcripts',
    transcriptText,
    b.sectionChars,
    c.transcripts.length > b.clientTranscriptItems,
  )

  // 5. Recent messages.
  const messageText = c.recentMessages
    .slice(0, b.clientMessageItems)
    .map(
      (m) =>
        `- ${m.at ?? ''} [${m.direction ?? '?'}] ${safeField(m.subject)}: ${oneLine(m.preview, 200)}`,
    )
    .join('\n')
  pushSection(
    sections,
    'messages',
    'Recent messages',
    messageText,
    b.sectionChars,
    c.recentMessages.length > b.clientMessageItems,
  )

  return {
    sections,
    sourceWatermark: material.watermark ?? assembledAt,
    assembledAt,
    scope,
    budget,
  }
}

// ── Service Digest scope ──────────────────────────────────────────────────────

// Marks a document_version note as an AI revision the attorney ACCEPTED (see
// apps/legal-demo review reader's acceptRevision()/acceptRedlineEdits(), which
// persist the accepted instruction with this exact prefix via legal.draft.edit).
const AI_REVISION_PREFIX = 'AI revision: '

// PURE — builds the Service Digest's EvidenceBundle. Section order: accepted AI
// revision instructions → manual edit notes → revision requests (asks) — the
// three signal kinds design §2a identifies, split from listServiceDigestSignals'
// two queries by the AI_REVISION_PREFIX marker.
export function buildServiceDigestEvidence(
  material: ServiceDigestSignals,
  scope: Extract<BriefScope, { kind: 'service_digest' }>,
  budget: EvidenceBudget,
  assembledAt: string,
): EvidenceBundle {
  const b = EVIDENCE_BUDGETS[budget]
  const sections: EvidenceSection[] = []

  const accepted = material.draftNotes.filter((n) => n.note.startsWith(AI_REVISION_PREFIX))
  const edits = material.draftNotes.filter((n) => !n.note.startsWith(AI_REVISION_PREFIX))

  const acceptedText = accepted
    .slice(0, b.digestItems)
    .map(
      (n) =>
        `- [${safeField(n.matterNumber)} · ${n.documentKind} v${n.versionNumber}] ${n.note.slice(AI_REVISION_PREFIX.length)}`,
    )
    .join('\n')
  pushSection(
    sections,
    'accepted_revisions',
    'Accepted AI revision instructions',
    acceptedText,
    b.sectionChars,
    accepted.length > b.digestItems,
  )

  const editsText = edits
    .slice(0, b.digestItems)
    .map(
      (n) => `- [${safeField(n.matterNumber)} · ${n.documentKind} v${n.versionNumber}] ${n.note}`,
    )
    .join('\n')
  pushSection(
    sections,
    'edit_notes',
    'Manual edit notes',
    editsText,
    b.sectionChars,
    edits.length > b.digestItems,
  )

  const requestsText = material.revisionRequests
    .slice(0, b.digestItems)
    .map((r) => `- [${safeField(r.matterNumber)} · ${r.documentKind}] ${r.notes}`)
    .join('\n')
  pushSection(
    sections,
    'revision_requests',
    'Revision requests',
    requestsText,
    b.sectionChars,
    material.revisionRequests.length > b.digestItems,
  )

  const watermark = maxTimestamp([
    ...material.draftNotes.map((n) => n.recordedAt),
    ...material.revisionRequests.map((r) => r.recordedAt),
  ])

  return {
    sections,
    sourceWatermark: watermark ?? assembledAt,
    assembledAt,
    scope,
    budget,
  }
}

// ── Entry point ────────────────────────────────────────────────────────────

// The ONE entry point WP2/WP3/WP4 synthesize on top of. Throws when a
// matter/client scope names an entity that doesn't exist (a genuine caller
// error — the MCP/UI layer resolves the id before calling this); a
// service_digest scope with zero matching signals is a VALID state (a service
// with no drafting history yet) and returns an empty-sections bundle, not an
// error.
export async function assembleBriefEvidence(
  ctx: ActionContext,
  scope: BriefScope,
  budget: EvidenceBudget = 'balanced',
): Promise<EvidenceBundle> {
  const assembledAt = new Date().toISOString()
  const b = EVIDENCE_BUDGETS[budget]

  switch (scope.kind) {
    case 'matter': {
      const material = await loadMatterMaterial(ctx, scope.matterEntityId, b)
      if (!material) throw new Error(`Matter not found: ${scope.matterEntityId}`)
      return buildMatterEvidence(material, scope, budget, assembledAt)
    }
    case 'client': {
      const material = await loadClientMaterial(ctx, scope.clientEntityId)
      if (!material) throw new Error(`Client not found: ${scope.clientEntityId}`)
      return buildClientEvidence(material, scope, budget, assembledAt)
    }
    case 'service_digest': {
      const material = await listServiceDigestSignals(ctx, scope.serviceKey)
      return buildServiceDigestEvidence(material, scope, budget, assembledAt)
    }
    default: {
      const exhaustive: never = scope
      throw new Error(`Unknown brief scope: ${JSON.stringify(exhaustive)}`)
    }
  }
}
