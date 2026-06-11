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
