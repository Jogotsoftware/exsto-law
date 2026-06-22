// NC Single-Member LLC Formation — go-live provisioning, THROUGH THE CORE.
//
// One-shot, attributed to the firm owner (Juan Carlos, tenant zero). Append-only:
// the test data is ARCHIVED (entity.archive), never deleted. Everything else is a
// core action (legal.service.upsert / set_active, legal.questionnaire_template.create,
// legal.template.create). No raw substrate SQL.
//
//   Phase 1  archive the active `test` template entity.
//   Phase 3  create the NC SMLLC service (functional: questionnaire + OA template +
//            drafting prompt + route=auto + generation=template_merge + fixed billing
//            marker, then ACTIVATE), plus the two standalone library records the
//            clean-slate count requires (one questionnaire_template, one template).
//
// The 24-field contract (§6) is a SINGLE source of truth (FIELDS below); the intake
// schema and the template variables are both derived from it, so they can never drift.
//
// Run: pnpm --filter @exsto/legal exec tsx --env-file=../../.env.local demo/nc-smllc-provision.ts
//   (or from repo root: tsx --env-file=.env.local verticals/legal/demo/nc-smllc-provision.ts)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { closeDbPool } from '@exsto/shared'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { archiveEntity } from '@exsto/primitives'
import {
  listServices,
  createService,
  updateServiceMetadata,
  updateQuestionnaire,
  updateDocumentTemplate,
  updateDraftingPrompt,
  setServiceActive,
  serviceCompleteness,
  createQuestionnaireTemplate,
  createTemplate,
} from '@exsto/legal'
// Side-effect import: registers the legal action handlers so submitAction can dispatch.
import '@exsto/legal'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const OWNER_ACTOR_ID = 'a392ee27-08dc-4845-9990-01af013d5dab' // Juan Carlos (firm owner), tenant zero
const TEST_TEMPLATE_ENTITY_ID = 'caac88ae-0254-4689-a1ff-70033e38c1c1'
const DOC_KIND = 'operating_agreement'
const SERVICE_DISPLAY_NAME = 'NC Single-Member LLC Formation'

const ctx: ActionContext = { tenantId: TENANT_ID, actorId: OWNER_ACTOR_ID }

// ── The 24-variable contract (§6), single source of truth ────────────────────
// id = lowercased {{TOKEN}} (the merge engine lowercases tokens before lookup, so
// the questionnaire field id must be the lowercase name for the fill to land).
// intakeType ∈ KNOWN_FIELD_TYPES; varType ∈ TemplateVariableType.
// NOTE: the platform has no 'email' field type and no show-if conditionals, so
// notice_email is a text field, and the two conditional fields are optional with
// guiding labels (matching the questionnaire's own "leave blank if…" instruction).
type F = {
  id: string
  label: string
  section: string
  intakeType: string
  varType: 'text' | 'textarea' | 'date' | 'choice'
  required: boolean
  options?: string[]
}
const SECTIONS: Array<{ id: string; title: string }> = [
  { id: 'company_information', title: 'A. Company information' },
  { id: 'sole_member', title: 'B. Sole member' },
  { id: 'capital', title: 'C. Capital' },
  { id: 'management', title: 'D. Management' },
  { id: 'tax_accounting', title: 'E. Tax & accounting' },
  { id: 'succession_dissolution_notices', title: 'F. Succession, dissolution & notices' },
  { id: 'execution', title: 'G. Execution' },
]
const FIELDS: F[] = [
  // A. Company information
  {
    id: 'company_name',
    label:
      'Exact legal name of the LLC (must match the Articles of Organization exactly, incl. “LLC”/“L.L.C.”)',
    section: 'company_information',
    intakeType: 'text',
    varType: 'text',
    required: true,
  },
  {
    id: 'sosid',
    label: 'NC Secretary of State entity ID (SOSID)',
    section: 'company_information',
    intakeType: 'text',
    varType: 'text',
    required: true,
  },
  {
    id: 'articles_filing_date',
    label: 'Date the Articles of Organization were (or will be) filed',
    section: 'company_information',
    intakeType: 'date',
    varType: 'date',
    required: true,
  },
  {
    id: 'effective_date',
    label: 'Effective date of this Operating Agreement',
    section: 'company_information',
    intakeType: 'date',
    varType: 'date',
    required: true,
  },
  {
    id: 'principal_office_address',
    label: 'Principal office street address',
    section: 'company_information',
    intakeType: 'address_autocomplete',
    varType: 'text',
    required: true,
  },
  {
    id: 'registered_agent_name',
    label: 'Registered agent name in North Carolina',
    section: 'company_information',
    intakeType: 'text',
    varType: 'text',
    required: true,
  },
  {
    id: 'registered_office_address',
    label: 'Registered office address in North Carolina (NC street address — no P.O. box only)',
    section: 'company_information',
    intakeType: 'address_autocomplete',
    varType: 'text',
    required: true,
  },
  {
    id: 'business_purpose',
    label: 'Business purpose / description of activities (or “any lawful purpose”)',
    section: 'company_information',
    intakeType: 'textarea',
    varType: 'textarea',
    required: true,
  },
  {
    id: 'term',
    label:
      'Term / duration of the Company (default “perpetual” unless a fixed end date is required)',
    section: 'company_information',
    intakeType: 'text',
    varType: 'text',
    required: true,
  },
  // B. Sole member
  {
    id: 'member_name',
    label: 'Full legal name of the sole Member',
    section: 'sole_member',
    intakeType: 'text',
    varType: 'text',
    required: true,
  },
  {
    id: 'member_type',
    label: 'Member type',
    section: 'sole_member',
    intakeType: 'select',
    varType: 'choice',
    required: true,
    options: ['individual', 'entity'],
  },
  {
    id: 'member_entity_state',
    label: 'If the Member is an entity, its state/type of formation (leave blank if an individual)',
    section: 'sole_member',
    intakeType: 'text',
    varType: 'text',
    required: false,
  },
  {
    id: 'member_address',
    label: 'Member’s mailing address',
    section: 'sole_member',
    intakeType: 'address_autocomplete',
    varType: 'text',
    required: true,
  },
  // C. Capital
  {
    id: 'initial_capital_contribution',
    label: 'Initial capital contribution (dollar value)',
    section: 'capital',
    intakeType: 'text',
    varType: 'text',
    required: true,
  },
  {
    id: 'contribution_form',
    label: 'Form of the contribution (cash, property, services)',
    section: 'capital',
    intakeType: 'text',
    varType: 'text',
    required: true,
  },
  // D. Management
  {
    id: 'management_type',
    label: 'Management structure',
    section: 'management',
    intakeType: 'select',
    varType: 'choice',
    required: true,
    options: ['Member-Managed', 'Manager-Managed'],
  },
  {
    id: 'manager_name',
    label: 'If Manager-Managed, name of the initial Manager (leave blank if Member-Managed)',
    section: 'management',
    intakeType: 'text',
    varType: 'text',
    required: false,
  },
  // E. Tax & accounting
  {
    id: 'tax_classification',
    label: 'Federal tax classification',
    section: 'tax_accounting',
    intakeType: 'select',
    varType: 'choice',
    required: true,
    options: ['disregarded entity', 'S-corporation', 'C-corporation'],
  },
  {
    id: 'fiscal_year_end',
    label: 'Fiscal year end (usually December 31)',
    section: 'tax_accounting',
    intakeType: 'date',
    varType: 'date',
    required: true,
  },
  // F. Succession, dissolution & notices
  {
    id: 'successor_member',
    label: 'Successor / transfer-on-death beneficiary of the membership interest',
    section: 'succession_dissolution_notices',
    intakeType: 'text',
    varType: 'text',
    required: true,
  },
  {
    id: 'dissolution_trigger',
    label:
      'Events that should trigger dissolution beyond statutory defaults (or “none beyond N.C. Gen. Stat. § 57D-6-01”)',
    section: 'succession_dissolution_notices',
    intakeType: 'textarea',
    varType: 'textarea',
    required: true,
  },
  {
    id: 'notice_address',
    label: 'Notice address for the Member',
    section: 'succession_dissolution_notices',
    intakeType: 'address_autocomplete',
    varType: 'text',
    required: true,
  },
  {
    id: 'notice_email',
    label: 'Notice email for the Member',
    section: 'succession_dissolution_notices',
    intakeType: 'text',
    varType: 'text',
    required: true,
  },
  // G. Execution
  {
    id: 'signature_date',
    label: 'Date the Member will sign',
    section: 'execution',
    intakeType: 'date',
    varType: 'date',
    required: true,
  },
]

function buildIntakeSchema() {
  return {
    id: 'nc_smllc_operating_agreement_v1',
    version: 1,
    title: 'Single-Member LLC Operating Agreement — North Carolina',
    jurisdiction: 'NC',
    sections: SECTIONS.map((s) => ({
      id: s.id,
      title: s.title,
      fields: FIELDS.filter((f) => f.section === s.id).map((f) => ({
        id: f.id,
        label: f.label,
        type: f.intakeType,
        required: f.required,
        ...(f.options ? { options: f.options } : {}),
      })),
    })),
  }
}

function buildTemplateVariables() {
  const vars: Record<string, { type: string; required?: boolean; options?: string[] }> = {}
  for (const f of FIELDS) {
    vars[f.id] = {
      type: f.varType,
      required: f.required,
      ...(f.options ? { options: f.options } : {}),
    }
  }
  return vars
}

// Script dir = verticals/legal/demo → repo root is three levels up.
const OA_BODY = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'docs',
    'templates',
    'nc_smllc',
    'nc_smllc_operating_agreement.md',
  ),
  'utf8',
)

// Drafting prompt — required by the auto-route activation gate (it must carry the
// REQUIRED_DRAFTING_SLOTS). generation_mode=template_merge does NOT use it (the
// worker fills the template deterministically); it is present to satisfy the gate
// and to be ready if the firm later opts a document into AI drafting.
const DRAFTING_PROMPT = `You are drafting a North Carolina single-member LLC Operating Agreement for attorney review.
Fill the template strictly from the client's intake answers (and the consultation notes if present).
Do not invent facts: where an answer is missing, leave the template's placeholder so the attorney can complete it.

Client intake answers (JSON):
{{questionnaire_responses_json}}

Consultation notes:
{{transcript_text}}

Operating Agreement template to complete:
{{operating_agreement_template}}`

async function main(): Promise<void> {
  console.log(`Provisioning as Juan Carlos (firm owner) on tenant zero.\n`)

  // ── Phase 1: archive the test template (through core entity.archive) ───────
  console.log('▸ Phase 1: archiving the `test` template entity…')
  await archiveEntity(ctx, TEST_TEMPLATE_ENTITY_ID)
  console.log(`  archived template entity ${TEST_TEMPLATE_ENTITY_ID}\n`)

  // Guard: do not double-provision the service on an accidental re-run.
  const existing = (await listServices(ctx)).find((s) => s.displayName === SERVICE_DISPLAY_NAME)
  if (existing) {
    throw new Error(
      `A service named "${SERVICE_DISPLAY_NAME}" already exists (key ${existing.serviceKey}). Aborting to avoid a duplicate. Remove this guard only if intentional.`,
    )
  }

  // ── Phase 3: create the functional NC SMLLC service ────────────────────────
  console.log('▸ Phase 3: creating the NC SMLLC service…')
  const svc = await createService(ctx, {
    displayName: SERVICE_DISPLAY_NAME,
    description:
      'Formation of a North Carolina single-member LLC, including a tailored Operating Agreement generated from the client intake.',
    route: 'auto',
    documents: [DOC_KIND],
  })
  const serviceKey = svc.serviceKey
  console.log(`  service created: ${serviceKey}`)

  await updateServiceMetadata(ctx, {
    serviceKey,
    displayName: SERVICE_DISPLAY_NAME,
    route: 'auto',
    documents: [DOC_KIND],
    generationMode: 'template_merge',
  })
  console.log('  set route=auto, documents=[operating_agreement], generation_mode=template_merge')

  await updateQuestionnaire(ctx, serviceKey, buildIntakeSchema())
  console.log('  set questionnaire (24 fields)')

  await updateDocumentTemplate(ctx, serviceKey, DOC_KIND, OA_BODY)
  console.log(`  set document template for "${DOC_KIND}" (${OA_BODY.length} chars)`)

  await updateDraftingPrompt(ctx, serviceKey, DOC_KIND, DRAFTING_PROMPT)
  console.log('  set drafting prompt (gate requirement; unused by template_merge)')

  // Fixed-billing marker on the service config (groundwork). The fee AMOUNT is left
  // for the firm to set; no fabricated price. transitions.cost stays unset.
  await submitAction(ctx, {
    actionKindName: 'legal.service.upsert',
    intentKind: 'adjustment',
    payload: {
      service_key: serviceKey,
      display_name: SERVICE_DISPLAY_NAME,
      transitions_patch: { billing_mode: 'fixed' },
    },
  })
  console.log('  marked billing_mode=fixed (fee amount left for the firm)')

  const completeness = await serviceCompleteness(ctx, serviceKey)
  console.log(
    `  completeness: ready=${completeness.ready} missing=${JSON.stringify(completeness.missing)}`,
  )

  await setServiceActive(ctx, serviceKey, true)
  console.log('  ACTIVATED service\n')

  // ── Phase 3: standalone library records (the clean-slate count) ────────────
  console.log('▸ Phase 3: creating standalone library records…')
  const qt = await createQuestionnaireTemplate(ctx, {
    name: 'NC Single-Member LLC — Client Intake',
    description:
      'Intake questionnaire for the NC single-member LLC formation service (24 fields feeding the Operating Agreement).',
    schema: buildIntakeSchema(),
  })
  console.log(
    `  questionnaire_template entity: ${qt.questionnaireTemplateId} (${qt.fieldCount} fields)`,
  )

  const tpl = await createTemplate(ctx, {
    name: 'NC Single-Member LLC — Operating Agreement',
    category: 'document',
    body: OA_BODY,
    docKind: DOC_KIND,
    variables: buildTemplateVariables(),
  })
  console.log(
    `  template entity: ${tpl.templateEntityId} (${Object.keys(tpl.variables).length} variables)\n`,
  )

  console.log('✓ Provisioning complete.')
  console.log(
    JSON.stringify(
      {
        serviceKey,
        questionnaireTemplateId: qt.questionnaireTemplateId,
        templateEntityId: tpl.templateEntityId,
      },
      null,
      2,
    ),
  )
}

main()
  .then(async () => {
    await closeDbPool()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error('✗ Provisioning failed:', error)
    try {
      await closeDbPool()
    } catch {
      /* ignore */
    }
    process.exit(1)
  })
