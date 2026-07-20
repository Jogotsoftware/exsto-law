// Reusable intake field: governing jurisdiction (WP A2b — governing jurisdiction
// gathered from the client's own intake).
//
// Doctrine: jurisdiction is a PER-MATTER fact from the client's intake, with the
// firm's home jurisdiction as fallback (api/matterJurisdiction.ts) — services
// stay jurisdiction-agnostic shells. A service author who wants that fact
// collected at intake attaches THIS field rather than inventing an ad hoc one,
// so its answer id lines up with:
//   • handlers/intake.ts, which looks for this id in the submitted answers and
//     stamps the matter's governing_law attribute from it (normalized);
//   • the {{governing_jurisdiction}} template token (api/templateMerge.ts),
//     which resolves from the matter fact via resolveMatterJurisdiction — not
//     from the raw answer directly, so an attorney's later correction
//     (legal.matter.set_governing_law) is what documents actually merge.
//
// allow_unknown (not a synthetic "I'm not sure" option inside the dropdown) is
// the established honest-unset mechanism (Contract I, WP2.4): the client can
// decline to answer, which both handlers/intake.ts and templateMerge.ts already
// treat as an absent fact, never a guess.
//
// This is a single hardcoded reusable field (config a service author copies
// into transitions.intake_schema), not a new substrate kind — no migration.
// A first-class field-library surface (many reusable fields, stored as
// definition rows, with an attorney-facing picker UI) is a larger follow-up;
// this WP ships the definition + the wiring that makes it functional
// (matter stamp, template token, completeness nudge) end to end.
import type { ServiceField } from './services.js'
import { US_STATE_ENTRIES, US_STATE_NAMES_ES } from './jurisdictions.js'

export const GOVERNING_JURISDICTION_FIELD_ID = 'governing_jurisdiction'

const STATE_OPTIONS = US_STATE_ENTRIES.map(([, name]) => name)
// US_STATE_NAMES_ES is keyed by the exact same codes US_STATE_ENTRIES iterates
// (pinned by tests/vertical/jurisdictions.test.ts) — the fallback to the
// English name only guards a TS indexed-access widening, never a real gap.
const STATE_OPTIONS_ES = US_STATE_ENTRIES.map(([code, name]) => US_STATE_NAMES_ES[code] ?? name)

export const GOVERNING_JURISDICTION_FIELD: ServiceField = {
  id: GOVERNING_JURISDICTION_FIELD_ID,
  label: "Which state's law governs this matter?",
  type: 'select',
  options: STATE_OPTIONS,
  allow_unknown: true,
  label_i18n: { es: '¿Bajo la ley de qué estado se rige este asunto?' },
  options_i18n: { es: STATE_OPTIONS_ES },
}
