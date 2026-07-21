// US jurisdiction reference data (WP A1 — firm jurisdiction data model).
//
// PURE, dependency-free (no DB, no ActionContext) so it can sit under both the
// handler layer (validation) and the api layer (display), and be unit-tested
// with zero fixtures. The 50 states + DC is deliberately the full closed set —
// the founder's doctrine is jurisdiction-agnostic services with an honest
// per-matter/per-firm fact, not a hardcoded short list (the 6-state map this
// replaces in skillContext.ts was a jurisdiction-SKILL-MATCHING convenience,
// not a claim about which jurisdictions the firm operates in).
//
// normalizeJurisdiction accepts EITHER a 2-letter code or a full display name,
// case-insensitively, and always returns the canonical uppercase code. This
// matters because existing `governing_law` matter attribute rows (vertical seed
// 0001; handlers/intake.ts) hold the display string 'North Carolina', while new
// writes (this WP) store the short code — both must resolve to the same value.

export const US_STATES: Readonly<Record<string, string>> = Object.freeze({
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
})

// Ordered [code, displayName] pairs — Object.entries preserves insertion order
// for string keys, so this matches the declaration order above (US_STATES then
// DC last), handy for a Settings <select>.
export const US_STATE_ENTRIES: ReadonlyArray<readonly [string, string]> = Object.freeze(
  Object.entries(US_STATES),
)

// display name (lowercased, trimmed) -> code, built once.
const NAME_TO_CODE: ReadonlyMap<string, string> = new Map(
  Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]),
)

// Accepts a 2-letter code ("nc", "NC") or a full display name ("north carolina",
// "North Carolina") case-insensitively and returns the canonical uppercase code,
// or null when the input matches neither (including empty/whitespace-only input
// — an honest "not a jurisdiction", never a guess).
export function normalizeJurisdiction(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  const upper = trimmed.toUpperCase()
  if (upper in US_STATES) return upper
  const byName = NAME_TO_CODE.get(trimmed.toLowerCase())
  return byName ?? null
}

// Parse the US state from a free-form on-file postal address, returning the
// canonical state CODE (or null). DETERMINISTIC and position-anchored — no model
// call, no fuzzy match (WF-FIX-2 #3): a US address places "<state> <ZIP>" (or a
// bare "<state>") in its TAIL, after the city, so strip a trailing country then a
// trailing ZIP, and match the last comma segment — else that segment's last
// whitespace token — against the state code/name set via normalizeJurisdiction.
// Only the anchored tail is examined, so a street like "1 Virginia Ave, Reno, NV"
// resolves to NV, never VA. An address that doesn't yield an exact state
// code/name match returns null and the resolver falls through to the next rung.
export function parseUsStateFromAddress(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  let s = input.trim().replace(/[\s.]+$/, '')
  if (!s) return null
  // Drop a trailing country token so the ZIP/state land at the very end.
  s = s.replace(/[,\s]+(?:USA|U\.S\.A|United States(?: of America)?)$/i, '').trim()
  // Drop a trailing US ZIP (5 or ZIP+4), leaving the state at the tail.
  s = s.replace(/[,\s]+\d{5}(?:-\d{4})?$/, '').trim()
  if (!s) return null
  // Standard position: the last comma segment holds the state (code or full name).
  const lastSegment = s.includes(',') ? s.slice(s.lastIndexOf(',') + 1).trim() : s.trim()
  const bySegment = normalizeJurisdiction(lastSegment)
  if (bySegment) return bySegment
  // Fallback for "City ST" with no comma before a 2-letter code: the final token.
  const tokens = lastSegment.split(/\s+/)
  return normalizeJurisdiction(tokens[tokens.length - 1] ?? '')
}

// The full display name for a canonical code (case-insensitive on input), or
// null when the code is not recognized.
export function jurisdictionDisplayName(code: string | null | undefined): string | null {
  if (typeof code !== 'string') return null
  const upper = code.trim().toUpperCase()
  return US_STATES[upper] ?? null
}

// Spanish display names, parallel to US_STATES by code (WP A2b — Spanish intake
// copy for the reusable governing_jurisdiction question; the established
// label_i18n/options_i18n pattern, BUILDER-UX-2 WP-7). Display-only: the option
// VALUE an intake answer stores is always the English name in US_STATES (see
// optionLabelOf in apps/legal-demo/app/book/page.tsx, which looks up the
// localized label by index but submits the English option string) — so
// normalizeJurisdiction never needs to understand Spanish input.
export const US_STATE_NAMES_ES: Readonly<Record<string, string>> = Object.freeze({
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawái',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Luisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Míchigan',
  MN: 'Minnesota',
  MS: 'Misisipi',
  MO: 'Misuri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'Nuevo Hampshire',
  NJ: 'Nueva Jersey',
  NM: 'Nuevo México',
  NY: 'Nueva York',
  NC: 'Carolina del Norte',
  ND: 'Dakota del Norte',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregón',
  PA: 'Pensilvania',
  RI: 'Rhode Island',
  SC: 'Carolina del Sur',
  SD: 'Dakota del Sur',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'Virginia Occidental',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'Distrito de Columbia',
})
