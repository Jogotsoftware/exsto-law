// Seed the firm question library with the Operating-Agreement fields from the
// imported OA template (Joe-authorized 2026-07-07), so those {{tokens}} exist
// firm-wide: template editors paint them recognized (yellow) instead of red,
// and each is one click from binding into any service questionnaire.
// THROUGH THE CORE: createQuestionTemplate is an upsert keyed on the token
// (idempotent — safe to re-run). Attributed to the Claude agent actor.
// Run: npx tsx --env-file=.env.local verticals/legal/demo/seed-oa-question-library-2026-07-07.ts
import { closeDbPool } from '@exsto/shared'
import { type ActionContext } from '@exsto/substrate'
import { createQuestionTemplate } from '@exsto/legal'
import '@exsto/legal'

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000004', // Claude (agent/claude), tenant zero
}

const QUESTIONS: Array<{ token: string; label: string; type: string; options?: string[] }> = [
  { token: 'company_name', label: 'Company name', type: 'text' },
  { token: 'member_name', label: 'Member name', type: 'text' },
  { token: 'member_type', label: 'Member type', type: 'select', options: ['Individual', 'Entity'] },
  { token: 'member_entity_state', label: 'Member entity state', type: 'text' },
  { token: 'member_address', label: 'Member address', type: 'address_autocomplete' },
  { token: 'articles_filing_date', label: 'Articles filing date', type: 'date' },
  { token: 'sosid', label: 'SOSID (Secretary of State ID)', type: 'text' },
  {
    token: 'principal_office_address',
    label: 'Principal office address',
    type: 'address_autocomplete',
  },
  { token: 'registered_agent_name', label: 'Registered agent name', type: 'text' },
  {
    token: 'registered_office_address',
    label: 'Registered office address',
    type: 'address_autocomplete',
  },
  { token: 'term', label: 'Term', type: 'text' },
  { token: 'business_purpose', label: 'Business purpose', type: 'textarea' },
  {
    token: 'initial_capital_contribution',
    label: 'Initial capital contribution',
    type: 'text',
  },
  {
    token: 'contribution_form',
    label: 'Contribution form',
    type: 'select',
    options: ['Cash', 'Property', 'Services'],
  },
  {
    token: 'management_type',
    label: 'Management type',
    type: 'select',
    options: ['Member-managed', 'Manager-managed'],
  },
  { token: 'manager_name', label: 'Manager name', type: 'text' },
  {
    token: 'tax_classification',
    label: 'Tax classification',
    type: 'select',
    options: ['Disregarded entity', 'Partnership', 'S corporation', 'C corporation'],
  },
  { token: 'fiscal_year_end', label: 'Fiscal year end', type: 'text' },
  { token: 'successor_member', label: 'Successor member', type: 'text' },
  { token: 'dissolution_trigger', label: 'Dissolution trigger', type: 'textarea' },
  { token: 'notice_address', label: 'Notice address', type: 'address_autocomplete' },
  { token: 'notice_email', label: 'Notice email', type: 'text' },
  { token: 'signature_date', label: 'Signature date', type: 'date' },
]

async function main(): Promise<void> {
  let ok = 0
  for (const q of QUESTIONS) {
    try {
      const saved = await createQuestionTemplate(ctx, {
        token: q.token,
        label: q.label,
        type: q.type,
        options: q.options ?? null,
      })
      ok++
      console.log(`✓ ${saved.token} (${q.type})`)
    } catch (e) {
      console.error(`✗ FAILED ${q.token}: ${(e as Error).message}`)
    }
  }
  console.log(`\n${ok}/${QUESTIONS.length} seeded (upsert-by-token, idempotent).`)
}

main()
  .then(async () => {
    await closeDbPool()
    process.exit(0)
  })
  .catch(async (e) => {
    console.error('✗ Seed failed:', e)
    try {
      await closeDbPool()
    } catch {
      /* ignore */
    }
    process.exit(1)
  })
