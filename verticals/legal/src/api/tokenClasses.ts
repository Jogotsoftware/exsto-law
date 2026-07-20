// =============================================================================
// P13 — merge-token classification, the ONE shared module.
//
// Template tokens fall into three classes:
//   • CLIENT-supplied — facts only the client knows (business details, member
//     names, uploads). The questionnaire must ask for them; coverage is enforced.
//   • ATTORNEY-supplied — values the attorney fills during review (internal
//     fields; review findings). Covered by internal:true questionnaire fields.
//   • SYSTEM — values the platform itself resolves: matter facts (matter_number,
//     client name/email from the booking contact), dates (today/letter_date/
//     effective_date), firm identity (firm_* from the firm_profile singleton),
//     the approving attorney's identity (attorney_name/attorney_email at
//     approve time), fee slots (service cost config), deterministic clause
//     slots, and render/sign-time artifacts (signature, citation).
//
// SYSTEM tokens must NEVER become client questions. Before this module existed,
// the questionnaire wizard's hard coverage rule forced a covering field for
// EVERY template token — which is how a C&D build asked the CLIENT for
// "Attorney email" and "Letter date". Every consumer (questionnaire authoring,
// the propose tools, the template⇄questionnaire sync) classifies through here,
// and a unit test pins SYSTEM_TOKENS ⊇ MERGE_SLOT_FIELDS so the classification
// and the merge engine can never drift apart.
// =============================================================================

import { MERGE_SLOT_FIELDS } from './templateMerge.js'

// Render/sign-time artifacts: never data, never merged, never asked. A
// {{signature}} line is placed by the e-sign flow; a {{citation}} is legal
// work product the drafting model/attorney supplies.
const RENDER_STATE_TOKENS = ['signature', 'citation'] as const

// The system-token set: every curated merge slot the platform can fill
// (MERGE_SLOT_FIELDS — kept a superset by construction, pinned by test) plus
// the render-state artifacts above. All lower-case; compare via isSystemToken.
export const SYSTEM_TOKENS: ReadonlySet<string> = new Set(
  [...MERGE_SLOT_FIELDS, ...RENDER_STATE_TOKENS].map((t) => t.toLowerCase()),
)

export function isSystemToken(name: string): boolean {
  return SYSTEM_TOKENS.has(name.trim().toLowerCase())
}

// Merge slots whose VALUE comes from the client's own intake answers (via the
// buildMergeData pick() aliases) — system-fillable, but legitimately client-
// facing when a questionnaire asks for them directly. They are excluded from
// coverage FORCING (an alias field may cover them) but must never be
// auto-coerced to internal:true, or the client could no longer be asked and
// the slot would render [[MISSING]] forever (the recon's false-positive risk).
const CLIENT_SOURCED_SLOTS: ReadonlySet<string> = new Set([
  'company_name',
  'business_description',
  // A service may legitimately ask the client for a desired effective date.
  'effective_date',
  // WP A2b — governing_jurisdiction is asked of the client directly (the
  // reusable field, intakeFieldLibrary.ts) even though the {{governing_jurisdiction}}
  // TOKEN resolves system-side from the matter's stored fact, not the raw
  // answer — same shape as effective_date above.
  'governing_jurisdiction',
])

// True when a proposed CLIENT-FACING questionnaire field with this id must be
// coerced to internal:true — i.e. the token is system-class AND the platform
// resolves it without client input (attorney/firm identity, dates, matter
// facts, fee/clause slots, render-state artifacts).
export function isAutoInternalToken(name: string): boolean {
  const t = name.trim().toLowerCase()
  return SYSTEM_TOKENS.has(t) && !CLIENT_SOURCED_SLOTS.has(t)
}

// ── Unresolved-token honesty (generation integrity) ─────────────────────────
// The AI drafting prompt instructs the model to LEAVE a `{{variable}}` token IN
// PLACE UNCHANGED when it cannot honestly fill it (bundledPrompts.ts /
// templateAuthoring.ts), rather than invent a value or write bracketed filler.
// That is the correct behavior — but a token left in place is only honest to
// the CLIENT if the attorney reviewing the draft is told about it too. The
// model's own free-text `ambiguities` list is not a reliable signal for this
// (a model can leave a token in place without mentioning it there), so this is
// a deterministic scan of the produced body itself: the platform's own honesty
// net, independent of what the model chose to self-report.
const RAW_TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g

// Every distinct `{{token}}` still present in a produced document body,
// lower-cased and de-duplicated, sorted for a deterministic result. Empty when
// the body is fully resolved — the common, expected case. Render-state
// artifacts are excluded: {{signature}}/{{citation}} legitimately remain in the
// text (RENDER_STATE_TOKENS above), and the e-sign markers ({{sign:key}},
// {{date:key}}, …) never match RAW_TOKEN_RE at all (the colon is outside its
// character class) — neither is a data gap the attorney needs a warning about.
export function findUnresolvedTokens(body: string): string[] {
  const found = new Set<string>()
  for (const m of body.matchAll(RAW_TOKEN_RE)) {
    const token = m[1]?.toLowerCase()
    if (token && !(RENDER_STATE_TOKENS as readonly string[]).includes(token)) {
      found.add(token)
    }
  }
  return [...found].sort()
}
