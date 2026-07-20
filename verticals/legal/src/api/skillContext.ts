import type { ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'
import {
  listSkillCatalog,
  getSkillBySlug,
  type SkillCatalogEntry,
  type Skill,
} from '../queries/skills.js'
import { US_STATES, normalizeJurisdiction } from './jurisdictions.js'
import { getTenantSettings } from './tenantSettings.js'

// Shared skill-awareness for ANY generative-AI feature in the legal vertical —
// not just the chatbot. The same legal skills (playbooks ported from
// claude-for-legal) back the assistant chat, the Templates "Draft with AI" flow,
// the "AI enhance" flow, etc. Beta ask: "anywhere in the system that uses
// generative AI should have access to the legal skills."

// Definition advertised to the model for the load_skill client tool. The model
// calls this with a slug from the catalog to pull the full instructions into
// context (progressive disclosure), then follows them. Executed by buildSkillTool.
const LOAD_SKILL_TOOL_DEF = {
  name: 'load_skill',
  description:
    "Load a specialized legal skill's full instructions before answering or drafting. When the request matches one of the skills listed under '--- Skills ---' in the system prompt (e.g. an NDA, a vendor MSA, a termination, a demand letter, a clearance), CALL this FIRST with the skill's slug, then follow the loaded playbook. You may load more than one. Every output is a draft for the attorney to review, never a final legal opinion.",
  input_schema: {
    type: 'object',
    properties: {
      slug: {
        type: 'string',
        description: 'The slug of the skill to load, exactly as listed in the Skills catalog.',
      },
    },
    required: ['slug'],
    additionalProperties: false,
  },
}

// Build the load_skill ClientTool for this turn. run() fetches the skill body from
// the substrate (tenant-scoped read) and returns it verbatim for the model to
// follow. Read-only — loading a skill writes nothing.
export function buildSkillTool(ctx: ActionContext): ClientTool {
  return {
    definition: LOAD_SKILL_TOOL_DEF,
    name: 'load_skill',
    run: async (raw) => {
      const args = (raw ?? {}) as { slug?: string }
      const slug = (args.slug ?? '').trim()
      if (!slug) return 'No skill slug was provided, so no skill was loaded.'
      const skill = await getSkillBySlug(ctx, slug)
      if (!skill) {
        return `No skill found with slug "${slug}". Proceed from general knowledge and remind the attorney to verify.`
      }
      return `LOADED SKILL — ${skill.name}\nFollow these instructions for this request. The result is a draft for the attorney to review, not a final legal opinion.\n\n${skill.body}`
    },
  }
}

// WP A5 — practice areas every firm needs regardless of its own configured
// practice mix (platform/meta skills, not a legal specialty). Always survive
// the scoping filter below even when the firm's own set doesn't name them.
const ALWAYS_ON_PRACTICE_AREAS = new Set(['firm-admin', 'research', 'client-portal'])

function normalizeArea(area: string): string {
  return area.trim().toLowerCase()
}

// Scope the DISCOVERY surface (the catalog text the model sees) to the firm's
// own practice areas, plus the always-on set. An UNSET firm (no practice_areas
// configured) gets the FULL catalog — the honest default, so a firm that hasn't
// filled in Settings never silently loses skills. This filters what the system
// prompt ADVERTISES, not what load_skill can load: an attorney or the model can
// still load_skill any slug directly (catalog filters discovery, not access).
function scopeToFirmPracticeAreas(
  entries: SkillCatalogEntry[],
  firmPracticeAreas: string[] | null | undefined,
): SkillCatalogEntry[] {
  if (!firmPracticeAreas?.length) return entries
  const allowed = new Set(firmPracticeAreas.map(normalizeArea))
  return entries.filter((s) => {
    const area = normalizeArea(s.practiceArea)
    return ALWAYS_ON_PRACTICE_AREAS.has(area) || allowed.has(area)
  })
}

// Render the skill catalog the model sees: practice-area groupings of
// `slug — name: when-to-use`. Only the short routing fields go in the prompt; the
// (long) bodies load on demand via load_skill. Helper skills (user_invocable =
// false) are reachable by slug but kept out of the routed list.
export function buildSkillCatalogText(
  catalog: SkillCatalogEntry[],
  firmPracticeAreas?: string[] | null,
): string {
  const invocable = scopeToFirmPracticeAreas(
    catalog.filter((s) => s.userInvocable && s.slug),
    firmPracticeAreas,
  )
  if (!invocable.length) return ''
  const byArea = new Map<string, SkillCatalogEntry[]>()
  for (const s of invocable) {
    const arr = byArea.get(s.practiceArea) ?? []
    arr.push(s)
    byArea.set(s.practiceArea, arr)
  }
  const lines: string[] = [
    '--- Skills ---',
    "You have specialized legal skills (playbooks ported from Anthropic's claude-for-legal). When the request matches one, CALL the load_skill tool with its slug BEFORE answering, then follow the loaded instructions. You may load more than one. Every output is a draft for the attorney to review — never a final legal opinion. If nothing matches, proceed normally.",
  ]
  for (const [area, skills] of byArea) {
    lines.push(`### ${area || 'general'}`)
    for (const s of skills) lines.push(`- ${s.slug} — ${s.name}: ${s.whenToUse}`)
  }
  return lines.join('\n')
}

// Render the bodies of explicitly-selected skills as an "active skills" block
// injected directly into the system prompt — so a picked skill is GUARANTEED to
// apply, vs. the model deciding via load_skill.
export function buildActiveSkillsText(skills: Skill[]): string {
  if (!skills.length) return ''
  const parts = [
    '--- Active skills (these were selected — follow them for this request) ---',
    'Each output remains a draft for the attorney to review, never a final legal opinion.',
  ]
  for (const s of skills) parts.push(`\n## ${s.name}\n${s.body}`)
  return parts.join('\n')
}

// Resolve skill slugs to full skills (bodies), in order, dropping any that no
// longer exist.
export async function loadForcedSkills(
  ctx: ActionContext,
  slugs: string[] | undefined,
): Promise<Skill[]> {
  if (!slugs?.length) return []
  const loaded = await Promise.all(slugs.map((s) => getSkillBySlug(ctx, s)))
  return loaded.filter((s): s is Skill => s != null)
}

// ── Auto-resolve the jurisdiction skill for a draft ──────────────────────────
//
// The AI drafter should apply the RIGHT legal playbook for the document even when the
// attorney didn't hand-pick one (founder ask: "the right jurisdiction skill"). This is
// a deterministic relevance match over the skill catalog (skills are data, so this is
// a generic matcher, not hard-coded business logic). It is deliberately CONSERVATIVE:
// a skill qualifies only on a STRONG document-kind match (the full kind phrase, or ≥2
// of its words), with a small jurisdiction bonus; jurisdiction alone never qualifies.
// When nothing matches well it returns [] — so a weak/irrelevant skill is never forced
// into a draft and drafting behaves exactly as before.

// A 2-letter US jurisdiction code → full state name, so a skill that spells out the
// state ("North Carolina LLC …") still earns the jurisdiction bonus. The full 50
// states + DC (jurisdictions.ts, WP A1) — a pure superset of the 6-state map this
// replaced, so every prior match still passes; anything else falls back to the
// code-as-word match.
const JURISDICTION_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([code, name]) => [code.toLowerCase(), name.toLowerCase()]),
)

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Does the skill's searchable text reference this jurisdiction? Matches the full state
// name (e.g. "north carolina") or the 2-letter code as a whole word (e.g. "nc", never
// "ncis"). A bonus signal only — never sufficient on its own.
function matchesJurisdiction(haystack: string, jurisdiction: string): boolean {
  const j = jurisdiction.toLowerCase().trim()
  if (!j) return false
  if (j.length > 2 && haystack.includes(j)) return true
  if (/^[a-z]{2}$/.test(j) && new RegExp(`\\b${j}\\b`).test(haystack)) return true
  const full = JURISDICTION_NAMES[j]
  return full ? haystack.includes(full) : false
}

// WP A5 — the negative jurisdiction filter: a skill EXPLICITLY tagged to a
// jurisdiction (skill_jurisdiction attribute; queries/skills.ts) that differs
// from the one resolved for this draft/review/email is excluded OUTRIGHT —
// never auto-load a Delaware playbook onto a North Carolina matter. An untagged
// skill (the vast majority) is jurisdiction-NEUTRAL and is never excluded here;
// nor is a tagged skill excluded when there is no resolved jurisdiction to
// compare against (nothing to call a mismatch). Distinct from matchesJurisdiction
// above, which is a same-direction TEXT bonus for untagged skills only.
function jurisdictionExcludes(
  skillJurisdiction: string | undefined,
  resolvedJurisdiction: string,
): boolean {
  const tag = normalizeJurisdiction(skillJurisdiction)
  if (!tag) return false
  const resolved = normalizeJurisdiction(resolvedJurisdiction)
  if (!resolved) return false
  return tag !== resolved
}

export type SkillIntent = 'draft' | 'review' | 'email'

// WP A5 — per-intent vocabulary ADDED as extra candidate phrases alongside the
// caller's own documentKind phrase (below). 'draft' carries none — a drafting
// call behaves EXACTLY as before, scored purely on the document kind. review/
// email add a small fixed set of task-shaped terms so a call can still qualify a
// skill whose whenToUse describes the TASK ("review any commercial agreement",
// "client email") even when the caller's own kind label is weak or generic (e.g.
// a bare 'uploaded' upload label, or a long free-text purpose). This is the fix
// for the pre-A5 bug where review/email keyed on a sentinel output-document kind
// (REVIEW_MEMO_DOCUMENT_KIND / CLIENT_EMAIL_DOCUMENT_KIND) that no seeded skill's
// words matched — a near-no-op auto-resolve.
const INTENT_VOCAB: Record<SkillIntent, readonly string[]> = {
  draft: [],
  review: ['contract review', 'document review', 'redline'],
  email: ['client email', 'client letter', 'client communication'],
}

// Score ONE candidate phrase against a skill's searchable text, under the same
// conservative rule rankSkillsForDraft has always used: the contiguous phrase,
// or EVERY (≥3-char) word of the phrase, must appear as a whole word. Words
// shorter than 3 chars (or a phrase with none) contribute nothing — this phrase
// simply can't qualify a skill on its own.
function scoreOverPhrase(hay: string, phrase: string): { qualifies: boolean; score: number } {
  const words = [...new Set(phrase.split(/\s+/).filter((w) => w.length >= 3))]
  if (!words.length) return { qualifies: false, score: 0 }
  const phraseHit = phrase.includes(' ') && hay.includes(phrase)
  const wordHits = words.filter((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`).test(hay)).length
  return {
    qualifies: phraseHit || wordHits === words.length,
    score: (phraseHit ? 5 : 0) + wordHits,
  }
}

// Rank catalog skills for a given document kind + jurisdiction and return the best
// slug(s). PURE (takes the catalog, no DB) so it is unit-tested without a database.
// A skill QUALIFIES only on a strong match against EITHER the caller's document-kind
// phrase OR one of the intent's fixed vocabulary phrases (opts.intent, default
// 'draft'): the full phrase appears (e.g. "operating agreement"), OR every word of
// that phrase appears (so "engagement letter" needs both "engagement" AND "letter",
// and a single-word phrase like "nda" needs that word). Jurisdiction NEVER qualifies
// a skill on its own — matchesJurisdiction above is only a tie-breaking bonus for
// untagged skills. A skill TAGGED to a different jurisdiction than the resolved one
// is excluded before scoring, regardless of how strong its text match is
// (jurisdictionExcludes above). Scoring (for ordering, best phrase wins): full
// phrase = +5; each distinct word present = +1; a jurisdiction text reference = +2.
// Returns at most `limit` (default 1) slugs, best first; [] when nothing matches (a
// draft/review/email is then unchanged).
export function rankSkillsForDraft(
  catalog: SkillCatalogEntry[],
  opts: { documentKind: string; jurisdiction?: string; limit?: number; intent?: SkillIntent },
): string[] {
  const kind = (opts.documentKind ?? '').toLowerCase().trim()
  const intent = opts.intent ?? 'draft'
  // Normalize both underscores (document_kind's own separator) and hyphens (a
  // service key's, e.g. "operating-agreement") to spaces so either style lines
  // up with the space-separated words skill text is written in.
  const kindPhrase = kind.replace(/[_-]+/g, ' ').trim()
  const candidatePhrases = [kindPhrase, ...INTENT_VOCAB[intent]].filter(Boolean)
  if (!candidatePhrases.length) return []
  const jurisdiction = (opts.jurisdiction ?? '').trim()

  const scored = catalog
    .filter((s) => s.slug && s.userInvocable)
    .filter((s) => !jurisdictionExcludes(s.jurisdiction, jurisdiction))
    .map((s) => {
      const hay = `${s.slug} ${s.name} ${s.whenToUse} ${s.description}`.toLowerCase()
      let qualifies = false
      let bestScore = 0
      for (const phrase of candidatePhrases) {
        const result = scoreOverPhrase(hay, phrase)
        if (result.qualifies) qualifies = true
        if (result.score > bestScore) bestScore = result.score
      }
      const jurisHit = matchesJurisdiction(hay, jurisdiction)
      const score = bestScore + (jurisHit ? 2 : 0)
      return { slug: s.slug, score, qualifies }
    })
    .filter((s) => s.qualifies)
    // Highest score first; stable by slug for deterministic ties.
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
  return scored.slice(0, Math.max(1, opts.limit ?? 1)).map((s) => s.slug)
}

// DB-backed wrapper: load the catalog (tenant-scoped) and rank it. Read-only.
export async function resolveJurisdictionSkillSlugs(
  ctx: ActionContext,
  opts: { documentKind: string; jurisdiction?: string; limit?: number; intent?: SkillIntent },
): Promise<string[]> {
  const catalog = await listSkillCatalog(ctx)
  return rankSkillsForDraft(catalog, opts)
}

// One-call convenience for any AI feature: take a base system prompt and return
// it augmented with the skills catalog, plus the load_skill tool to pass to
// chatWithAssistantDetailed. If the tenant has no skills, the system is unchanged
// and clientTools is empty.
export interface SkillAwareGeneration {
  system: string
  clientTools: ClientTool[]
}

export async function withSkills(
  ctx: ActionContext,
  baseSystem: string,
): Promise<SkillAwareGeneration> {
  const catalog = await listSkillCatalog(ctx)
  // WP A5 — scope the advertised catalog to the firm's own practice areas (an
  // unset firm still gets the full catalog; see scopeToFirmPracticeAreas).
  const settings = await getTenantSettings(ctx)
  const catalogText = buildSkillCatalogText(catalog, settings.practiceAreas)
  return {
    system: catalogText ? `${baseSystem}\n\n${catalogText}` : baseSystem,
    clientTools: catalog.length ? [buildSkillTool(ctx)] : [],
  }
}
