import type { ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'
import {
  listSkillCatalog,
  getSkillBySlug,
  type SkillCatalogEntry,
  type Skill,
} from '../queries/skills.js'

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
