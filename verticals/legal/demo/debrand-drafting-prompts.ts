// One-off: strip the agent's proper name ("Sage") from the stored drafting
// prompts — THROUGH THE CORE (versioned service upsert + configuration_change
// audit), per WP2.6 branding purge. The repo fallback file (drafting-prompt.md)
// is debranded separately; this fixes the in-app config that OVERRIDES it
// (seeded by migration 0012). Removing the name only — every required mustache
// slot is preserved, so updateDraftingPrompt's slot validation still passes.
//
// Run with the pilot DB url:  tsx --env-file=.env.local verticals/legal/demo/debrand-drafting-prompts.ts
// Idempotent: a prompt with no config source or no "Sage" is skipped.
import { closeDbPool } from '@exsto/shared'
import { getDraftingPrompt, updateDraftingPrompt } from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'
// Side-effect import: registers the legal action handlers (service upsert path).
import '@exsto/legal'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0001-000000000001'
const systemCtx: ActionContext = { tenantId: TENANT_ID, actorId: SYSTEM_ACTOR_ID }

const SERVICES = ['nc_llc_single_member', 'nc_llc_multi_member']
const DOC_KINDS = ['operating_agreement', 'engagement_letter']

function debrand(text: string): string {
  return text
    .replace(/You are Sage, the drafting agent/g, 'You are the drafting agent')
    .replace(/\bSage\b/g, 'the drafting agent')
}

async function main() {
  let updated = 0
  for (const serviceKey of SERVICES) {
    for (const documentKind of DOC_KINDS) {
      const doc = await getDraftingPrompt(systemCtx, serviceKey, documentKind)
      if (!doc || doc.source !== 'config' || !doc.promptText) {
        console.log(`skip ${serviceKey}/${documentKind}: source=${doc?.source ?? 'none'}`)
        continue
      }
      if (!/\bSage\b/.test(doc.promptText)) {
        console.log(`skip ${serviceKey}/${documentKind}: already clean`)
        continue
      }
      const cleaned = debrand(doc.promptText)
      if (/\bSage\b/.test(cleaned)) {
        throw new Error(`"Sage" survived debrand for ${serviceKey}/${documentKind}`)
      }
      await updateDraftingPrompt(systemCtx, serviceKey, documentKind, cleaned)
      updated += 1
      console.log(`updated ${serviceKey}/${documentKind} — new immutable version written`)
    }
  }
  console.log(`Done. ${updated} prompt(s) debranded through the core.`)
  await closeDbPool()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
