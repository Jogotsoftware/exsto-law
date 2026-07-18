// Brief engine WP3 — CLIENT BRIEF external-research PRIVACY GUARD (design:
// docs/design/briefs/DESIGN.md §4, founder decision 2). The founder's hard rule,
// verbatim: when the client is a business, research it externally "without
// leaking any matter content of course" — plus a quick person search on the
// client's primary contact, name-only outbound, on by default.
//
// THE GUARANTEE, and how it holds even against a careless caller:
//   1. PublicIdentifiers is a CLOSED type — clientDisplayName/companyName/
//      personName/website/linkedinUrl. It has no field that could carry a
//      matter fact, a communication, a note, or an evidence-bundle section.
//      buildBriefResearchQueries and runBriefResearch accept ONLY this type —
//      an EvidenceBundle, ClientContext, or BriefSection[] does not structurally
//      satisfy it, so passing one is a TYPE ERROR, not a runtime discipline.
//   2. extractPublicIdentifiers reads from ClientProfileFields — an equally
//      narrow shape (name + contacts' names only). It never sees matters,
//      communications, notes, or evidence. clientBriefEngine.ts's loader
//      narrows getClient()'s full ClientDetail down to exactly these two
//      fields BEFORE calling the extractor, so even though ClientDetail itself
//      carries matter numbers/statuses/billing, that data never reaches this
//      module's call boundary.
//   3. Every outbound query string is TEMPLATED (never free-text passthrough
//      of a caller-supplied string) and RECORDED: returned in
//      BriefResearchRecord.queries and persisted verbatim into the brief's
//      brief_research_json (api/briefEngine.ts's persistBrief) AND a
//      research.recorded event (recordBriefResearchEvent, provenance
//      integration:perplexity — the same audit convention api/research.ts
//      already uses for matter-scoped Perplexity calls) — so an attorney can
//      audit exactly what left the firm, from two independent surfaces.
//   4. Anything that comes BACK from research is treated as untrusted,
//      lower-confidence, attributed data — clientBriefEngine.ts fences it into
//      the evidence bundle the same way every other section is fenced
//      (neutralizeDelimiters, the «BEGIN/END MATTER DATA» guard), and the
//      synthesis prompt (CLIENT_RESEARCH_VERIFIABILITY_RULE) instructs the
//      model to include a finding ONLY if verifiable/attributable — otherwise
//      omit it, never hedge it into the brief.
import { submitAction, type ActionContext } from '@exsto/substrate'
import { clip, neutralizeDelimiters } from './assistantContext.js'
import {
  runPerplexityResearch,
  type ResearchRequest,
  type ResearchResult,
} from '../adapters/perplexity.js'
import type { EvidenceSection } from './briefEvidence.js'

// ── The closed input type ────────────────────────────────────────────────────

/**
 * The ONLY shape that may ever reach an external research call for a Client
 * Brief. Every field is a bare public identifier — nothing here can carry a
 * matter fact, a quote from a client email, a note body, or any other
 * firm-internal content. `personName` and `website`/`linkedinUrl` are
 * currently populated only when the underlying client-profile field exists
 * (website/linkedinUrl have no source field today — reserved for a future
 * client-profile attribute; `linkedinUrl` is otherwise filled by a MATCHED
 * research result, never accepted as an input).
 */
export interface PublicIdentifiers {
  /** The client's own display name, as entered on the client profile. */
  clientDisplayName: string
  /** Set ONLY when clientDisplayName is recognized as a business name (isLikelyBusinessName). */
  companyName?: string
  /** The primary contact's name — decision 2's "quick person search," name-only. */
  personName?: string
  /** Reserved: no client-profile source field exists yet. */
  website?: string
  /** Reserved: an input only in the sense of "already confidently known"; research never receives this as a search seed today. */
  linkedinUrl?: string
}

const PUBLIC_IDENTIFIER_KEYS = [
  'clientDisplayName',
  'companyName',
  'personName',
  'website',
  'linkedinUrl',
] as const

/** Defensive belt-and-suspenders: strips any key not in the closed set, in
 * case a future refactor widens the type carelessly. Also used by tests to
 * assert nothing extra rides along on a PublicIdentifiers value. */
export function sanitizePublicIdentifiers(ids: PublicIdentifiers): PublicIdentifiers {
  const out: PublicIdentifiers = { clientDisplayName: ids.clientDisplayName }
  for (const k of PUBLIC_IDENTIFIER_KEYS) {
    if (k === 'clientDisplayName') continue
    const v = ids[k]
    if (typeof v === 'string' && v.trim()) out[k] = v
  }
  return out
}

// ── The extractor (reads ONLY client-profile fields) ────────────────────────

/**
 * The narrow, DB-agnostic shape the extractor reads from. Deliberately has NO
 * field that could carry matter rows, communications, notes, or evidence —
 * only the client's own display name and its contacts' names. Callers (
 * clientBriefEngine.ts's loadPublicIdentifiers) must narrow whatever richer
 * object they loaded (e.g. queries/client.ts's ClientDetail, which also
 * carries matters/billing) down to exactly this shape before calling
 * extractPublicIdentifiers — the type boundary is what makes passing a wider,
 * matter-shaped object here a compile error rather than a runtime hazard.
 */
export interface ClientProfileFields {
  name: string
  contacts: Array<{ fullName: string; isMain?: boolean }>
}

// Common U.S. business-entity suffixes. A conservative allowlist — a false
// negative just skips the business-research leg (safe: no research is not a
// privacy problem), a false positive would still only ever search a NAME, so
// even a misclassified individual client leaks nothing beyond their own name.
const BUSINESS_SUFFIX_RE =
  /\b(LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|Co\.?|Company|Ltd\.?|LLP|L\.L\.P\.|PLLC|P\.L\.L\.C\.|PC|P\.C\.|Group|Holdings|Enterprises|Partners)\.?\s*$/i

export function isLikelyBusinessName(name: string): boolean {
  return BUSINESS_SUFFIX_RE.test(name.trim())
}

/** Reads ONLY `profile.name` and `profile.contacts[].fullName/.isMain` — see
 * the module header for why that is the whole privacy guarantee. */
export function extractPublicIdentifiers(profile: ClientProfileFields): PublicIdentifiers {
  const clientDisplayName = (profile.name ?? '').trim()
  const mainContact = profile.contacts.find((c) => c.isMain) ?? profile.contacts[0] ?? null
  const personName = mainContact?.fullName?.trim() || undefined
  return sanitizePublicIdentifiers({
    clientDisplayName,
    companyName: isLikelyBusinessName(clientDisplayName) ? clientDisplayName : undefined,
    personName,
  })
}

// ── Templated, recorded outbound queries ─────────────────────────────────────

export interface RecordedResearchQuery {
  query: string
  kind: 'business' | 'person'
}

/** Every outbound query string this module can ever produce — templated from
 * PublicIdentifiers only, never a caller-supplied free-text string. Business
 * queries fire only when `companyName` is set (decision: "if the client is a
 * business"); the person query is name-only per decision 2. */
export function buildBriefResearchQueries(ids: PublicIdentifiers): RecordedResearchQuery[] {
  const queries: RecordedResearchQuery[] = []
  if (ids.companyName) {
    queries.push({
      kind: 'business',
      query:
        `${ids.companyName}: what does this company do, what industry, roughly what size, ` +
        'and any public profile (official website, notable public information). If there are ' +
        'multiple companies with a similar name, say so rather than guessing which one.',
    })
  }
  if (ids.personName) {
    queries.push({
      kind: 'person',
      query: `${ids.personName} — LinkedIn profile, current role, and professional background.`,
    })
  }
  return queries
}

// ── Running the research (graceful degrade, never throws) ───────────────────

export interface BriefResearchFinding {
  query: string
  kind: 'business' | 'person'
  answer: string
  citations: string[]
}

/** Persisted into brief_research_json (Client Brief only) — the full audit
 * record of what left the firm and what came back. `connected: false` +
 * `skippedReason` is a valid, expected state (Perplexity not connected for
 * this tenant, or nothing researchable) — the UI renders it as "research not
 * run," never as an error. */
export interface BriefResearchRecord {
  ranAt: string
  connected: boolean
  skippedReason: string | null
  queries: RecordedResearchQuery[]
  findings: BriefResearchFinding[]
}

export interface RunBriefResearchOptions {
  researchBusiness?: boolean
  researchPerson?: boolean
}

// Injectable seam for unit tests — no live Perplexity call needed to pin the
// query-building/recording/degrade behavior.
export interface BriefResearchDeps {
  research: (tenantId: string | null, request: ResearchRequest) => Promise<ResearchResult>
}
const DEFAULT_RESEARCH_DEPS: BriefResearchDeps = { research: runPerplexityResearch }

const NOT_CONNECTED_RE = /no perplexity api key available/i
// Perplexity's own floor (see adapters/perplexity.ts verifyPerplexityKey) is 16;
// a "quick search" answer stays well short of the brief's evidence budget.
const RESEARCH_MAX_TOKENS = 400

/**
 * Runs the (already-built, already-recorded) queries through Perplexity —
 * ONLY through this module's own templated queries, never a caller string.
 * Degrades gracefully on every failure path: no Perplexity connection, or a
 * live call failing mid-run, both produce a well-formed record, never a throw
 * — a Client Brief must always generate even when research cannot run.
 */
export async function runBriefResearch(
  tenantId: string,
  ids: PublicIdentifiers,
  opts: RunBriefResearchOptions = {},
  deps: BriefResearchDeps = DEFAULT_RESEARCH_DEPS,
): Promise<BriefResearchRecord> {
  const ranAt = new Date().toISOString()
  const wantBusiness = opts.researchBusiness ?? true
  const wantPerson = opts.researchPerson ?? true
  const queries = buildBriefResearchQueries(ids).filter(
    (q) => (q.kind === 'business' && wantBusiness) || (q.kind === 'person' && wantPerson),
  )

  if (queries.length === 0) {
    return {
      ranAt,
      connected: false,
      skippedReason:
        'Nothing researchable on this client profile (not recognized as a business name, and no contact on file).',
      queries: [],
      findings: [],
    }
  }

  const findings: BriefResearchFinding[] = []
  let connected = true
  let skippedReason: string | null = null

  for (const q of queries) {
    try {
      const result = await deps.research(tenantId, {
        question: q.query,
        maxTokens: RESEARCH_MAX_TOKENS,
      })
      findings.push({
        query: q.query,
        kind: q.kind,
        answer: result.answer,
        citations: result.citations,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (NOT_CONNECTED_RE.test(message)) {
        // Not connected for this tenant — stop trying further queries (they'll
        // fail the same way) and report it as a clean "not run," not an error.
        connected = false
        skippedReason = 'Perplexity is not connected for this firm — research was not run.'
        break
      }
      // A live-but-failing call degrades only THIS finding, never the whole brief.
      findings.push({
        query: q.query,
        kind: q.kind,
        answer: `(research failed: ${message})`,
        citations: [],
      })
    }
  }

  return { ranAt, connected, skippedReason, queries, findings }
}

// ── Formatting for the evidence bundle (fenced, capped, source-tagged) ──────

const RESEARCH_SECTION_CHAR_CAP = 4000

/** Renders a BriefResearchRecord as one more EvidenceSection, fenced with the
 * SAME delimiter-forgery guard every other section uses — research answers are
 * third-party text and get no more trust than a client email would. Returns
 * null when there is nothing to show (no findings) so an empty/skipped
 * research leg never becomes a hollow placeholder section — the modal reads
 * the record's `connected`/`skippedReason` directly for that "not run" state. */
export function formatResearchEvidenceSection(record: BriefResearchRecord): EvidenceSection | null {
  if (record.findings.length === 0) return null
  const text = record.findings
    .map(
      (f) =>
        `- [${f.kind}] Q: ${f.query}\n  A: ${f.answer}\n  Citations: ${f.citations.length ? f.citations.join(', ') : 'none'}`,
    )
    .join('\n\n')
  const clipped = clip(text, RESEARCH_SECTION_CHAR_CAP)
  return {
    source: 'external_research',
    label: 'External research (Perplexity — quick business/person search)',
    content: neutralizeDelimiters(clipped),
    truncated: clipped.length < text.length,
  }
}

// ── Audit event (design §4 rule 4: brief_research_json + research.recorded) ─

/** Best-effort audit trail on the client's own timeline, mirroring
 * api/research.ts's recordMatterResearch convention (event.record →
 * research.recorded, provenance integration:perplexity) — a SECOND,
 * independent record of what left the firm, alongside brief_research_json.
 * Returns null (not an error) when nothing was queried. */
export async function recordBriefResearchEvent(
  ctx: ActionContext,
  clientEntityId: string,
  record: BriefResearchRecord,
): Promise<{ eventId: string } | null> {
  if (record.queries.length === 0) return null
  const res = await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'exploration',
    payload: {
      event_kind_name: 'research.recorded',
      primary_entity_id: clientEntityId,
      source_type: 'integration',
      source_ref: 'integration:perplexity',
      data: {
        brief_research: true,
        ranAt: record.ranAt,
        queries: record.queries,
        findingCount: record.findings.length,
        citations: record.findings.flatMap((f) => f.citations),
      },
    },
  })
  const eventId = (res.effects[0] as { eventId: string } | undefined)?.eventId ?? res.actionId
  return { eventId }
}

// ── Tolerant read-side parse (mirrors queries/briefs.ts's parseStoredSections) ─

function isRecordedQuery(v: unknown): v is RecordedResearchQuery {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return typeof r.query === 'string' && (r.kind === 'business' || r.kind === 'person')
}

function isFinding(v: unknown): v is BriefResearchFinding {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    typeof r.query === 'string' &&
    (r.kind === 'business' || r.kind === 'person') &&
    typeof r.answer === 'string' &&
    Array.isArray(r.citations)
  )
}

/** A malformed/foreign brief_research_json degrades to null, never a throw —
 * the same discipline queries/briefs.ts's parseStoredSections uses. */
export function parseBriefResearchRecord(v: unknown): BriefResearchRecord | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.ranAt !== 'string') return null
  return {
    ranAt: r.ranAt,
    connected: r.connected === true,
    skippedReason: typeof r.skippedReason === 'string' ? r.skippedReason : null,
    queries: Array.isArray(r.queries) ? r.queries.filter(isRecordedQuery) : [],
    findings: Array.isArray(r.findings) ? r.findings.filter(isFinding) : [],
  }
}
