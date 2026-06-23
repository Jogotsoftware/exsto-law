// =============================================================================
// Deterministic template merge — the engine behind the template_merge
// generation path (WP3.4, Objective 6).
//
// renderTemplate fills `{{slot}}` markers in a configured document template from
// a flat data map. It makes NO model call and NO network call — same inputs
// always yield the same document. This is what lets a submitted questionnaire
// produce a document_draft with zero Anthropic dependency.
//
// Contract H (`renderTemplate`) is owned by the templates/questionnaire session.
// Until that canonical engine lands on main, the generation worker uses this
// renderer so the template_merge path — and Objective 6's "no Anthropic" receipt
// — is provable now. The signature IS the contract's, so swapping in the shared
// engine later is a one-line import change.
// =============================================================================

import type { MatterDetail } from '../queries/matters.js'

// `{{ field }}` / `{{field}}` / `{{member.0.name}}` — dotted paths allowed.
const SLOT_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g

export interface RenderResult {
  markdown: string
  filledFields: string[]
  missingFields: string[]
}

/**
 * Replace every `{{field}}` in `templateText` with `data[field]`.
 *
 * A field that is absent or empty renders as a VISIBLE, honest marker
 * (`[[MISSING: field]]`) — never a blank or a guess. The substrate distinguishes
 * "we don't know" from "we know there is nothing"; a deterministic merge surfaces
 * the gap for the reviewing attorney instead of silently papering over it.
 */
export function renderTemplate(
  templateText: string,
  data: Record<string, string | undefined>,
): RenderResult {
  const filled = new Set<string>()
  const missing = new Set<string>()
  // Case-insensitive field lookup: a hand-typed {{Client_Name}} fills a
  // `client_name` field. Token/field ids are snake_case slugs, so letter case is
  // never meaningful — match it the way the live preview already does.
  const byLower = new Map<string, string | undefined>()
  for (const [k, v] of Object.entries(data)) byLower.set(k.toLowerCase(), v)
  const markdown = templateText.replace(SLOT_RE, (_match, field: string) => {
    const value = data[field] ?? byLower.get(field.toLowerCase())
    if (value != null && String(value).trim() !== '') {
      filled.add(field)
      return String(value)
    }
    missing.add(field)
    return `[[MISSING: ${field}]]`
  })
  return { markdown, filledFields: [...filled], missingFields: [...missing] }
}

export interface MergeDataOptions {
  // ISO date used for {{effective_date}} (caller passes today so the function
  // stays pure and testable). Rendered as a long-form date.
  effectiveDateIso: string
  // Formatted fee + structure, resolved from the service cost config when present
  // (the worker reads Contract G). Absent → the fee slots render as MISSING.
  feeAmountFormatted?: string
  feeStructureHuman?: string
}

// Pull the first plausible value for a logical field out of the questionnaire
// answers, tolerating the small naming variations across intake schemas.
function pick(responses: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = responses[k]
    if (v != null && typeof v !== 'object' && String(v).trim() !== '') return String(v)
  }
  return undefined
}

// The WP2.4 "I don't know" sentinel — treated as unanswered (renders MISSING).
const UNKNOWN_ANSWER = '__unknown__'

// Flatten every questionnaire answer into a {{field_id}} → string map, so any
// question (including reusable library questions, migration 0077) fills its
// {{answer}} token by id. Curated slots from buildMergeData override these.
//  • multi-select (checkbox) → comma-joined
//  • structured address → formatted_address
//  • "I don't know" / empty / nested objects → omitted (render as MISSING)
function flattenAnswers(responses: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, v] of Object.entries(responses)) {
    if (v == null || v === '' || v === UNKNOWN_ANSWER) continue
    if (Array.isArray(v)) {
      // Multi-select (checkbox) → comma-joined scalars. Object elements (e.g. the
      // members_repeater rows) are NOT stringifiable to a token — skip them so a
      // {{members}} token honestly renders MISSING rather than "[object Object]".
      const joined = v
        .filter((x) => x != null && typeof x !== 'object' && String(x).trim() !== '')
        .join(', ')
      if (joined) out[key] = joined
    } else if (typeof v === 'object') {
      const addr = (v as { formatted_address?: unknown }).formatted_address
      if (typeof addr === 'string' && addr.trim()) out[key] = addr
    } else {
      out[key] = String(v)
    }
  }
  return out
}

function firstName(fullName: string | null | undefined): string | undefined {
  const n = (fullName ?? '').trim()
  if (!n) return undefined
  return n.split(/\s+/)[0]
}

function longDate(iso: string): string {
  // Deterministic long-form date (e.g. "June 18, 2026"), locale-fixed so the
  // same matter always renders the same string regardless of server locale.
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Build the flat field map a document template merges against, from matter facts
 * + questionnaire answers + service config. Common engagement-letter / formation
 * slots are mapped here; any template slot with no mapping renders as a MISSING
 * marker via renderTemplate, which is the honest outcome for a deterministic
 * merge that lacks a fact.
 *
 * Clause-style slots (scope notes, fee terms, ambiguities) get deterministic
 * defaults rather than MISSING markers — they describe the deterministic process
 * itself, not a missing client fact.
 */
export function buildMergeData(
  matter: MatterDetail,
  options: MergeDataOptions,
): Record<string, string | undefined> {
  const q = matter.questionnaireResponses ?? {}
  const companyName = pick(q, ['company_name', 'proposed_company_name', 'llc_name'])
  const clientName =
    matter.clientName?.trim() || pick(q, ['primary_client_name', 'client_name', 'member_name'])

  // Curated/derived slots — matter facts, fee block, deterministic clauses.
  const curated: Record<string, string | undefined> = {
    // Identity / matter facts
    company_name: companyName,
    matter_number: matter.matterNumber,
    primary_client_name: clientName,
    primary_client_salutation: firstName(clientName) ?? clientName,
    client_email: matter.clientEmail ?? undefined,
    effective_date: longDate(options.effectiveDateIso),
    business_description: pick(q, ['business_description', 'business_purpose']),

    // Fee block (from service cost config when available)
    fee_amount_formatted: options.feeAmountFormatted,
    fee_structure_human: options.feeStructureHuman,

    // Clause-style slots — deterministic defaults (process, not client facts).
    scope_notes_clause: '',
    fee_terms_clause:
      'Fees are due upon acceptance of this engagement unless the Firm agrees otherwise in writing.',
    ambiguities_section:
      '_This document was assembled deterministically from your intake answers. Any slot shown as `[[MISSING: …]]` needs attorney input before sending._',
  }

  // Base: every raw questionnaire answer by field id (so any library/custom
  // question token fills). A curated slot overrides a raw answer only when it
  // actually resolved — an undefined curated value never clobbers a real answer.
  const merged: Record<string, string | undefined> = { ...flattenAnswers(q) }
  for (const [k, v] of Object.entries(curated)) {
    if (v !== undefined) merged[k] = v
  }
  return merged
}
