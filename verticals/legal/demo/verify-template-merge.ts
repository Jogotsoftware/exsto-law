// WP2.5 receipt — Contract H deterministic merge + auto-questionnaire-from-template.
// Unit checks the pure functions, then runs an end-to-end through the core
// (create template → generate a bound questionnaire → save to a throwaway service
// → confirm the saved fields are exactly the template's tokens), then tears down.
//   tsx --env-file=.env.local verticals/legal/demo/verify-template-merge.ts
import { closeDbPool } from '@exsto/shared'
import {
  renderTemplate,
  extractInputTokens,
  questionnaireFromTemplate,
  createTemplate,
  archiveTemplate,
  createService,
  updateQuestionnaire,
  getQuestionnaire,
  retireService,
} from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'
import '@exsto/legal'

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000001',
}

let failed = false
function check(name: string, cond: boolean) {
  if (!cond) failed = true
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`)
}

const BODY =
  '# Operating Agreement\n\n{{company_name}} is organized in {{state}}. Manager: {{manager_name}}.\n\n{{>signature_block}}'

async function main() {
  // (c) renderTemplate — deterministic merge + missingFields + composition.
  const tokens = extractInputTokens(BODY)
  check(
    'extractInputTokens = [company_name, state, manager_name] (excludes {{>include}})',
    JSON.stringify(tokens) === JSON.stringify(['company_name', 'state', 'manager_name']),
  )
  const r = renderTemplate(
    BODY,
    { company_name: 'Pine Hollow Roasters LLC', state: 'North Carolina' },
    { includes: { signature_block: 'Signed: {{manager_name}}' } },
  )
  check(
    'filled = company_name + state',
    r.filledFields.includes('company_name') && r.filledFields.includes('state'),
  )
  check(
    'missing = [manager_name]',
    JSON.stringify(r.missingFields) === JSON.stringify(['manager_name']),
  )
  check('html merged the company value', r.html.includes('Pine Hollow Roasters LLC'))
  check('html shows the [[manager_name]] gap (never silent)', r.html.includes('[[manager_name]]'))
  check('{{>signature_block}} composed in', r.html.includes('Signed:'))

  // (a)/(b) auto-questionnaire — one bound question per token, no orphans.
  const q = questionnaireFromTemplate('NC LLC Operating Agreement', BODY)
  const qIds = q.sections[0].fields.map((f) => f.id)
  check(
    'questionnaire fields === template tokens (every {{input}} bound)',
    JSON.stringify(qIds) === JSON.stringify(tokens),
  )

  // End-to-end through the core: generate → save to a throwaway service → read back.
  const tpl = await createTemplate(ctx, {
    name: 'WP2.5 OA shape check',
    category: 'document',
    body: BODY,
  })
  const svc = await createService(ctx, {
    displayName: 'WP2.5 template-bound service',
    route: 'manual',
  })
  const gen = questionnaireFromTemplate('WP2.5 OA', BODY)
  await updateQuestionnaire(ctx, svc.serviceKey, {
    id: svc.serviceKey,
    version: 1,
    title: gen.title,
    sections: gen.sections,
  })
  const saved = await getQuestionnaire(ctx, svc.serviceKey)
  const savedIds = saved ? saved.sections[0].fields.map((f) => f.id) : []
  check(
    'saved questionnaire bound to the template tokens',
    JSON.stringify(savedIds) === JSON.stringify(tokens),
  )
  console.log('saved fields:', JSON.stringify(saved?.sections[0].fields))

  // teardown
  await retireService(ctx, svc.serviceKey)
  await archiveTemplate(ctx, tpl.templateEntityId)
  console.log(failed ? 'FAIL' : 'PASS — Contract H merge + auto-questionnaire verified.')
  await closeDbPool()
  if (failed) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
