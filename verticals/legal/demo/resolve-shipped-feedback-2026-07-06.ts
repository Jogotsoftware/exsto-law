// One-shot close-the-loop: resolve beta-feedback items that were verifiably
// shipped by merged PRs #261/#262/#263 (2026-06-24/25) but never resolved —
// the commits quote the feedback verbatim yet carry no Beta-Feedback trailer,
// and the merge-manager backstop is retired. No re-reports since the fixes
// deployed (the 6/26 demo feedback is all about other pages).
//
// Attributed to the Claude agent actor (tenant zero) — agent action, through the core.
// Run: tsx --env-file=.env.local verticals/legal/demo/resolve-shipped-feedback-2026-07-06.ts
import { closeDbPool } from '@exsto/shared'
import { type ActionContext } from '@exsto/substrate'
import { resolveAssistantFeedback } from '@exsto/legal'
import '@exsto/legal'

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000004', // Claude (agent/claude), tenant zero
}

const RESOLUTIONS: Array<{ id: string; summary: string; note: string }> = [
  // PR #261 — bounded pg pool (EMAXCONNSESSION dashboard 500)
  {
    id: '8a7bf976-746f-49e4-bd74-d4f482aa1f6d',
    summary: 'Dashboard 500 (max clients reached) fixed — connection pool bounded',
    note: 'PR #261: pool capped on serverless (max 3), idle connections reaped after 10s, fail-fast on saturation. No recurrence since 6/24.',
  },
  {
    id: 'f9e6ec24-e203-42f6-946e-8de8e21a17af',
    summary: 'Dashboard 500 (max clients reached) fixed — connection pool bounded',
    note: 'Duplicate report of the same pooler exhaustion; fixed by PR #261.',
  },
  // PR #261 — invoice-PDF renderer fix (Settings → Invoice template 500)
  {
    id: '282acb2a-1bc1-4aa2-817d-a8ad1f085abc',
    summary: 'Invoice template PDF preview 500 fixed — PDF renderer survives the serverless bundle',
    note: "PR #261: @react-pdf/renderer added to serverExternalPackages so its font data isn't stripped by the bundler (the \"reading 'S'\" crash).",
  },
  {
    id: 'cd9e9331-5a34-4e39-87fb-8c98f7a883e9',
    summary: 'Invoice template PDF preview 500 fixed — PDF renderer survives the serverless bundle',
    note: 'Duplicate report; fixed by PR #261.',
  },
  {
    id: '4f0bf67c-e30e-4b9b-928f-148fab523fc7',
    summary: 'Invoice template PDF preview 500 fixed — PDF renderer survives the serverless bundle',
    note: 'Duplicate report; fixed by PR #261.',
  },
  // PR #262 — billing Unbilled header declutter
  {
    id: '6ca32a71-aba8-4ed6-ad4c-b59833da6904',
    summary: 'Billing page cleaned up — select-all labeled, client header row ungrouped',
    note: 'PR #262: the "stray text box" was the bare select-all checkbox (now labeled "Select all"); the squished name/rate/Unbilled row now has spacing and wraps.',
  },
  {
    id: '7ad6ae46-008a-4c23-be03-bdbe07d879fd',
    summary: 'Billing page cleaned up — select-all labeled, client header row ungrouped',
    note: 'Duplicate report; fixed by PR #262.',
  },
  // PR #263 — smooth streamed reply
  {
    id: 'ffd969f1-be09-4907-906c-6e9c2899f0dd',
    summary: 'AI chat now streams smoothly — word-by-word reveal instead of bursts',
    note: 'PR #263: render cadence decoupled from network chunks; ease-out reveal snapped to word boundaries.',
  },
  {
    id: '89982920-97ae-4133-86dd-ac5d4bbb324a',
    summary: 'AI chat now streams smoothly — word-by-word reveal instead of bursts',
    note: 'Duplicate report; fixed by PR #263.',
  },
  {
    id: '5d16b5ba-0616-479a-8180-658a529f6e50',
    summary: 'AI chat now streams smoothly — word-by-word reveal instead of bursts',
    note: 'Duplicate report; fixed by PR #263.',
  },
]

async function main(): Promise<void> {
  let ok = 0
  for (const r of RESOLUTIONS) {
    try {
      const { eventId } = await resolveAssistantFeedback(ctx, {
        feedbackEventId: r.id,
        summary: r.summary,
        note: r.note,
      })
      ok++
      console.log(`✓ resolved ${r.id.slice(0, 8)} → ${eventId.slice(0, 8)}  ${r.summary}`)
    } catch (e) {
      console.error(`✗ FAILED ${r.id.slice(0, 8)}: ${(e as Error).message}`)
    }
  }
  console.log(`\n${ok}/${RESOLUTIONS.length} resolved.`)
}

main()
  .then(async () => {
    await closeDbPool()
    process.exit(0)
  })
  .catch(async (e) => {
    console.error('✗ Run failed:', e)
    try {
      await closeDbPool()
    } catch {
      /* ignore */
    }
    process.exit(1)
  })
