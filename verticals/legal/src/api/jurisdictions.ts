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

// The full display name for a canonical code (case-insensitive on input), or
// null when the code is not recognized.
export function jurisdictionDisplayName(code: string | null | undefined): string | null {
  if (typeof code !== 'string') return null
  const upper = code.trim().toUpperCase()
  return US_STATES[upper] ?? null
}
