import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  OPERATING_AGREEMENT_SINGLE_MEMBER_BODY,
  OPERATING_AGREEMENT_MULTI_MEMBER_BODY,
  ENGAGEMENT_LETTER_BODY,
} from './bundledBodies.js'

const here = dirname(fileURLToPath(import.meta.url))
// here points at dist/templates at runtime and src/templates during dev; both
// resolve to the package root one level up, where templates/ lives at
// verticals/legal/templates/.
const templatesDir = resolve(here, '..', '..', 'templates')

let cached: {
  intakeQuestionnaireOa?: IntakeQuestionnaire
  draftingPrompt?: string
  reviewPrompt?: string
  redlinePrompt?: string
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

// Bundled (inlined) so the body resolves in the deployed standalone serverless
// bundle, where a runtime readFileSync of the .md asset throws ENOENT. See
// bundledBodies.ts for the why. The .md file remains the canonical source to edit.
export function loadOperatingAgreementTemplate(): string {
  return OPERATING_AGREEMENT_SINGLE_MEMBER_BODY
}

// Multi-member NC LLC operating-agreement body. Same mustache-slot contract the
// drafting prompt expects, but the structure adds the multi-member-specific
// machinery: a member schedule with ownership %, capital contributions and
// capital accounts, voting in proportion to ownership, supermajority/deadlock
// rules, pro-rata distributions, a right of first refusal, and a buy-sell on
// dissociation. This is a TEMPLATE the attorney reviews in the existing review
// surface — a first draft, never final legal advice.
export function loadMultiMemberOperatingAgreementTemplate(): string {
  return OPERATING_AGREEMENT_MULTI_MEMBER_BODY
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
  return ENGAGEMENT_LETTER_BODY
}

// Document kinds that ship a bundled repo BODY template (the Phase-0 fallback).
// The Service Library lets an attorney author a body template per document kind as
// config (Doc-Types PR1); a kind that is NOT one of these has no built-in body, so
// it can only be drafted once a config template exists. This set is the single
// source of truth for "is there a repo fallback for this kind", shared by the
// document-template resolver and the service completeness gate. Keep it narrow:
// adding a kind here means committing a bundled template file for it.
const REPO_TEMPLATE_KINDS = new Set<string>(['operating_agreement', 'engagement_letter'])

export function hasRepoTemplate(documentKind: string): boolean {
  return REPO_TEMPLATE_KINDS.has(documentKind)
}

// Resolve the bundled repo BODY template for a known document kind, service-aware
// for the operating agreement (multi-member vs single-member body). Throws for a
// kind with no bundled template — callers gate on hasRepoTemplate() first. This is
// the thin code-side fallback the config resolver delegates to (binding Lesson #3:
// bodies are repo files in this phase, the interface stays library-ready).
export function resolveRepoDocumentTemplate(
  documentKind: string,
  serviceKey: string | null | undefined,
): string {
  if (documentKind === 'engagement_letter') return loadEngagementLetterTemplate()
  if (documentKind === 'operating_agreement') return resolveOperatingAgreementTemplate(serviceKey)
  throw new Error(`No bundled template for document kind: ${documentKind}`)
}

export function loadDraftingPrompt(): string {
  if (!cached.draftingPrompt) {
    cached.draftingPrompt = readFileSync(resolve(templatesDir, 'drafting-prompt.md'), 'utf8')
  }
  return cached.draftingPrompt
}

// Default AI document-review prompt (per-service config overrides it, same
// config-first pattern as the drafting prompt).
export function loadReviewPrompt(): string {
  if (!cached.reviewPrompt) {
    cached.reviewPrompt = readFileSync(resolve(templatesDir, 'document-review-prompt.md'), 'utf8')
  }
  return cached.reviewPrompt
}

// The redline pass's prompt is REPO-CONTROLLED (not attorney-editable): its
// output contract (verbatim reproduction + memo-driven edits only) is what the
// diff view depends on, so it stays content the firm can't accidentally break.
export function loadRedlinePrompt(): string {
  if (!cached.redlinePrompt) {
    cached.redlinePrompt = readFileSync(resolve(templatesDir, 'document-redline-prompt.md'), 'utf8')
  }
  return cached.redlinePrompt
}
