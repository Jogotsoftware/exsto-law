import type { ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'
import {
  listSkillCatalog,
  getSkillBySlug,
  type SkillCatalogEntry,
  type Skill,
} from '../queries/skills.js'
import { US_STATES } from './jurisdictions.js'

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

// Render the skill catalog the model sees: practice-area groupings of
// `slug — name: when-to-use`. Only the short routing fields go in the prompt; the
// (long) bodies load on demand via load_skill. Helper skills (user_invocable =
// false) are reachable by slug but kept out of the routed list.
export function buildSkillCatalogText(catalog: SkillCatalogEntry[]): string {
  const invocable = catalog.filter((s) => s.userInvocable && s.slug)
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

// Rank catalog skills for a given document kind + jurisdiction and return the best
// slug(s). PURE (takes the catalog, no DB) so it is unit-tested without a database.
// A skill QUALIFIES only on a strong document-kind match: the full kind phrase appears
// (e.g. "operating agreement"), OR every word of the kind appears (so "engagement
// letter" needs both "engagement" AND "letter", and a single-word kind like "nda"
// needs that word). Jurisdiction NEVER qualifies a skill on its own — it is only a
// tie-breaking bonus. Scoring (for ordering): full phrase = +5; each distinct kind
// word (≥3 chars) present = +1; a jurisdiction reference = +2. Returns at most `limit`
// (default 1) slugs, best first; [] when nothing matches (a draft is then unchanged).
export function rankSkillsForDraft(
  catalog: SkillCatalogEntry[],
  opts: { documentKind: string; jurisdiction?: string; limit?: number },
): string[] {
  const kind = (opts.documentKind ?? '').toLowerCase().trim()
  if (!kind) return []
  const phrase = kind.replace(/_/g, ' ').trim()
  const kindWords = [...new Set(phrase.split(/\s+/).filter((w) => w.length >= 3))]
  if (!kindWords.length) return []
  const jurisdiction = (opts.jurisdiction ?? '').trim()

  const scored = catalog
    .filter((s) => s.slug && s.userInvocable)
    .map((s) => {
      const hay = `${s.slug} ${s.name} ${s.whenToUse} ${s.description}`.toLowerCase()
      const phraseHit = phrase.includes(' ') && hay.includes(phrase)
      const wordHits = kindWords.filter((w) =>
        new RegExp(`\\b${escapeRegExp(w)}\\b`).test(hay),
      ).length
      const jurisHit = matchesJurisdiction(hay, jurisdiction)
      const score = (phraseHit ? 5 : 0) + wordHits + (jurisHit ? 2 : 0)
      // Strong match required: the contiguous phrase, or ALL of the kind's words.
      const qualifies = phraseHit || wordHits === kindWords.length
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
  opts: { documentKind: string; jurisdiction?: string; limit?: number },
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
  const catalogText = buildSkillCatalogText(catalog)
  return {
    system: catalogText ? `${baseSystem}\n\n${catalogText}` : baseSystem,
    clientTools: catalog.length ? [buildSkillTool(ctx)] : [],
  }
}
