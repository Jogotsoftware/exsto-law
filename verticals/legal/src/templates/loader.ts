import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// here points at dist/templates at runtime and src/templates during dev; both
// resolve to the package root one level up, where templates/ lives at
// verticals/legal/templates/.
const templatesDir = resolve(here, '..', '..', 'templates')

let cached: {
  intakeQuestionnaireOa?: IntakeQuestionnaire
  operatingAgreementTemplate?: string
  operatingAgreementTemplateMultiMember?: string
  engagementLetterTemplate?: string
  draftingPrompt?: string
} = {}

export interface QuestionnaireField {
  id: string
  label: string
  type: string
  required?: boolean
  help?: string
  options?: string[]
  memberFields?: QuestionnaireField[]
  minItems?: number
}

export interface QuestionnaireSection {
  id: string
  title: string
  fields: QuestionnaireField[]
}

export interface IntakeQuestionnaire {
  id: string
  version: number
  title: string
  description: string
  jurisdiction: string
  sections: QuestionnaireSection[]
}

export function loadIntakeQuestionnaire(): IntakeQuestionnaire {
  if (!cached.intakeQuestionnaireOa) {
    const raw = readFileSync(resolve(templatesDir, 'intake-questionnaire-oa.json'), 'utf8')
    cached.intakeQuestionnaireOa = JSON.parse(raw) as IntakeQuestionnaire
  }
  return cached.intakeQuestionnaireOa
}

// Intake forms are repo files in Phase 0 (binding Lesson #3: acceptable for now,
// loader interface stays library-ready so Phase 1 can move them to substrate
// content rows without call-site changes). Keyed by the intake_form_id each
// service kind binds in workflow_definition.transitions.
const INTAKE_FORM_FILES: Record<string, string> = {
  'nc-llc-single-member-oa-v1': 'intake-questionnaire-oa.json',
  'nc-llc-multi-member-v1': 'intake-nc-llc-multi-member.json',
  'something-else-v1': 'intake-something-else.json',
}

const intakeFormCache = new Map<string, IntakeQuestionnaire>()

export function loadIntakeForm(intakeFormId: string): IntakeQuestionnaire {
  let form = intakeFormCache.get(intakeFormId)
  if (!form) {
    const file = INTAKE_FORM_FILES[intakeFormId]
    if (!file) throw new Error(`Unknown intake form id: ${intakeFormId}`)
    form = JSON.parse(readFileSync(resolve(templatesDir, file), 'utf8')) as IntakeQuestionnaire
    intakeFormCache.set(intakeFormId, form)
  }
  return form
}

export function loadOperatingAgreementTemplate(): string {
  if (!cached.operatingAgreementTemplate) {
    cached.operatingAgreementTemplate = readFileSync(
      resolve(templatesDir, 'nc-llc-operating-agreement.md'),
      'utf8',
    )
  }
  return cached.operatingAgreementTemplate
}

// Multi-member NC LLC operating-agreement body. Same mustache-slot contract the
// drafting prompt expects, but the structure adds the multi-member-specific
// machinery: a member schedule with ownership %, capital contributions and
// capital accounts, voting in proportion to ownership, supermajority/deadlock
// rules, pro-rata distributions, a right of first refusal, and a buy-sell on
// dissociation. This is a TEMPLATE the attorney reviews in the existing review
// surface — a first draft, never final legal advice.
export function loadMultiMemberOperatingAgreementTemplate(): string {
  if (!cached.operatingAgreementTemplateMultiMember) {
    cached.operatingAgreementTemplateMultiMember = readFileSync(
      resolve(templatesDir, 'nc-llc-operating-agreement-multi-member.md'),
      'utf8',
    )
  }
  return cached.operatingAgreementTemplateMultiMember
}

// Service keys that draft the MULTI-MEMBER operating-agreement body. The drafting
// worker selects the document-body template by (document kind, service): an
// operating_agreement for a multi-member service gets the multi-member body;
// every other service keeps the single-member body. Config-as-data lives in the
// service's transitions; this is the thin code-side selector that maps the
// service kind to its bundled body file (the bodies are repo files in this phase,
// loader interface stays library-ready — binding Lesson #3).
const MULTI_MEMBER_SERVICE_KEYS = new Set<string>(['nc_llc_multi_member'])

// Resolve the operating-agreement BODY template for a given service. Single-member
// (and any unknown service) → the single-member body, so this is strictly additive
// and cannot break the single-member path. A multi-member service → the
// multi-member body.
export function resolveOperatingAgreementTemplate(serviceKey: string | null | undefined): string {
  if (serviceKey && MULTI_MEMBER_SERVICE_KEYS.has(serviceKey)) {
    return loadMultiMemberOperatingAgreementTemplate()
  }
  return loadOperatingAgreementTemplate()
}

export function loadEngagementLetterTemplate(): string {
  if (!cached.engagementLetterTemplate) {
    cached.engagementLetterTemplate = readFileSync(
      resolve(templatesDir, 'engagement-letter-oa.md'),
      'utf8',
    )
  }
  return cached.engagementLetterTemplate
}

export function loadDraftingPrompt(): string {
  if (!cached.draftingPrompt) {
    cached.draftingPrompt = readFileSync(resolve(templatesDir, 'drafting-prompt.md'), 'utf8')
  }
  return cached.draftingPrompt
}
