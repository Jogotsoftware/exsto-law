// Close-the-loop for feedback shipped 2026-07-06 (PRs #271/#272/#273), plus two
// items verified already shipped in code (#199's review-queue fix; the dashboard
// greeting/booking-link removal). Per CLAUDE.md: resolve the same session you ship.
// Run: tsx --env-file=.env.local verticals/legal/demo/resolve-shipped-feedback-2026-07-06b.ts
import { closeDbPool } from '@exsto/shared'
import { type ActionContext } from '@exsto/substrate'
import { resolveAssistantFeedback } from '@exsto/legal'
import '@exsto/legal'

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000004', // Claude (agent/claude), tenant zero
}

const RESOLUTIONS: Array<{ id: string; summary: string; note: string }> = [
  // PR #271 — build wizard history
  {
    id: '20c6b932-33dc-4f50-af98-089ca4ce3771',
    summary: 'Service Builder fixed — answers advance the interview instead of jumping back',
    note: 'PR #271: hidden answers/primer now persist in the model history and card-only turns are recorded, so the wizard keeps its place.',
  },
  {
    id: 'ca035bac-e253-4485-9113-39aded0b8b99',
    summary: 'Service Builder fixed — answers advance the interview instead of jumping back',
    note: 'Duplicate report; fixed by PR #271.',
  },
  {
    id: 'ac76ff87-7410-42a5-aeca-b28c945d281f',
    summary: 'Service Builder fixed — answers advance, and re-asked questions are clickable again',
    note: 'PR #271 also removed the answered-key dedupe that made re-asked questions unclickable.',
  },
  // PR #272 — dates platform-wide
  {
    id: 'df38697c-ed7b-4708-a4a0-e7a647d61b6d',
    summary: 'Dates render everywhere — server timestamps are now browser-parseable',
    note: 'PR #272: all substrate reads emit full offsets (+00:00) and every date surface renders through lib/datetime with a dash fallback.',
  },
  {
    id: '21d1ebcf-938d-4c4c-a6b6-7800529e2efd',
    summary: 'Dates render everywhere — server timestamps are now browser-parseable',
    note: 'Follow-up to df38697c; same fix (PR #272). Remaining blank dates are genuinely-null test rows.',
  },
  // PR #273 — templates + integrations
  {
    id: 'b7911a41-ee25-4209-8c1d-0ca5e3061257',
    summary: 'Template variables match case-insensitively — {{COMPANY_NAME}} fills company_name',
    note: 'PR #273: editor validation now mirrors the merge (which was already case-insensitive).',
  },
  {
    id: '8670473e-30da-4458-8404-a3e893f79fe7',
    summary: 'OpenAI card is honest — key stored, chat support marked coming soon',
    note: 'PR #273: no OpenAI chat adapter exists yet; the card and model picker now say so instead of implying a connected key is selectable.',
  },
  // Shipped earlier, never resolved
  {
    id: '01e415c2-923d-4cf4-bb23-57fd2f31aa19',
    summary: 'Review queue dates fixed + click-to-sort column headers',
    note: 'Shipped as PR #199 (merged before this branch was picked up); the duplicate local branch was retired.',
  },
  {
    id: 'a0a85c69-046d-4af4-90ce-ba5f09ab210e',
    summary: 'Dashboard booking link and "Hi, Juan Carlos" greeting removed',
    note: 'Already shipped on main (see the beta-feedback comment in app/attorney/page.tsx); confirmed gone in code.',
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
      console.log(`✓ resolved ${r.id.slice(0, 8)} → ${eventId.slice(0, 8)}`)
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
