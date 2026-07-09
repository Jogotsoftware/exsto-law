// CAPABILITY-UNIFY-1 — fix a PRE-EXISTING prod data bug the capability path exposed:
// the nc_will_drafting config drafting prompt (transitions.drafting.prompts.
// last_will_and_testament) says "Output the final document only — no commentary" and
// never asks for the fenced ```json reasoning trace the drafting parser
// (splitDocumentAndTrace) requires. Every ai_draft against it dead-letters with
// "did not include a fenced ```json reasoning trace block" (or, when nudged, a trace
// missing required fields → reasoning_trace.evidence NOT NULL violation). The last
// successful prod ai_draft predates this prompt (2026-06-20, repo-prompt era).
//
// Fix: re-save the prompt through updateDraftingPrompt (the sanctioned versioned
// path — legal.service.upsert with a transitions_patch), keeping its content but
// (a) replacing the "document only" sentence and (b) appending the same reasoning-
// trace contract the repo drafting-prompt.md carries.
//   node --import tsx --env-file=.env.local verticals/legal/demo/capunify-fix-will-prompt.ts
import '@exsto/legal'
import { getDraftingPrompt, updateDraftingPrompt } from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ADMIN = '00000000-0000-0000-0001-000000000004'
const ctx: ActionContext = { tenantId: TENANT, actorId: ADMIN }

const SERVICE = 'nc_will_drafting'
const DOC_KIND = 'last_will_and_testament'

const TRACE_SECTION = `

# Reasoning trace (required)

After the will text, you must also produce a JSON block (fenced with \`\`\`json) containing the structured reasoning trace described below. The attorney's review UI relies on this. Do not skip it, and include EVERY field shown — "evidence" and "alternatives_considered" must be present (use [] only if truly empty).

\`\`\`json
{
  "prompt_id": "will-drafting-prompt@v2",
  "model_identity": "<model id you used>",
  "evidence": [
    { "source": "questionnaire", "field": "<questionnaire field id>", "value": "<value>", "used_in": "<article or clause>" }
  ],
  "alternatives_considered": [
    { "decision_point": "<what choice you had>", "alternatives": ["<option a>", "<option b>"], "selected": "<which>", "rationale": "<why>" }
  ],
  "conclusion": "<one or two sentence summary of the draft's overall posture>",
  "confidence": <number between 0 and 1>,
  "ambiguities": [
    { "topic": "<short label>", "explanation": "<what is uncertain and why>", "needs_input_from": "client | attorney | both" }
  ]
}
\`\`\`
`

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const current = await getDraftingPrompt(ctx, SERVICE, DOC_KIND)
  if (!current?.promptText || current.source !== 'config') {
    throw new Error(
      `Expected a config drafting prompt for ${SERVICE}/${DOC_KIND}; got ${current?.source}`,
    )
  }
  if (current.promptText.includes('# Reasoning trace (required)')) {
    console.log('prompt already carries the reasoning-trace contract — nothing to do')
    return
  }
  const fixed =
    current.promptText.replace(
      'Output the final document only — no commentary.',
      'Output the final document followed by the required reasoning-trace JSON block described below — no other commentary.',
    ) + TRACE_SECTION
  const saved = await updateDraftingPrompt(ctx, SERVICE, DOC_KIND, fixed)
  console.log(
    `will drafting prompt fixed: source=${saved.source} prompt_version=${saved.promptVersion} length=${saved.promptText?.length}`,
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
