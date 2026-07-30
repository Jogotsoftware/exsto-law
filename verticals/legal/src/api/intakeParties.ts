// MULTI-PARTY-1 — intake parties. A service whose intake carries a repeating
// per-person group (members_repeater: LLC members, partners, additional
// signers) captures N people as rows inside ONE questionnaire answer. This
// module is the ONE place that answer shape is interpreted: it walks the
// service's questionnaire schema, finds the repeater fields, and normalizes
// each row to an IntakeParty (name/email/phone/title) so:
//   • matter.open can create each party as a REAL client_contact and link it to
//     the matter (matter_contact) — first-class CRM people, not merge strings;
//   • the e-sign repeat-per-party expansion can count/name the signers.
// Pure and defensive — no DB, never throws on malformed rows; a row with
// neither a name nor an email is not a party and is dropped.

export interface IntakeParty {
  name: string | null
  email: string | null
  phone: string | null
  title: string | null
}

// The questionnaire shapes this module needs — structural, so it accepts the
// service QuestionnaireDoc without importing the (server-adjacent) services
// module and staying import-cycle-free.
export interface PartyFieldLike {
  id?: string
  type?: string
  memberFields?: PartyFieldLike[]
}
export interface PartySchemaLike {
  sections?: Array<{ fields?: PartyFieldLike[] }>
}

// Repeater field types: the canonical members_repeater plus the legacy repo-file
// spelling 'repeater' (verticals/legal/templates/intake-nc-llc-multi-member.json).
const REPEATER_TYPES = new Set(['members_repeater', 'repeater'])

// Per-slot key candidates, in priority order. Exact ids first, then any key
// with the matching suffix (member_name, party_email, signer_phone, …).
const NAME_KEYS = ['name', 'full_name', 'member_name', 'party_name', 'signer_name']
const EMAIL_KEYS = ['email', 'member_email', 'party_email', 'signer_email']
const PHONE_KEYS = ['phone', 'member_phone', 'party_phone', 'signer_phone']
const TITLE_KEYS = ['title', 'role', 'member_title', 'member_role', 'party_role']

function pickSlot(row: Record<string, unknown>, exact: string[], suffix: string): string | null {
  for (const k of exact) {
    const v = row[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase().endsWith(suffix) && typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// One raw repeater row → a party, or null when the row carries no identity.
export function partyFromRow(raw: unknown): IntakeParty | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const name = pickSlot(row, NAME_KEYS, '_name')
  const rawEmail = pickSlot(row, EMAIL_KEYS, '_email')
  // A malformed email is dropped (delivery would bounce) but the party survives
  // on their name — honest partial capture, never an invented address.
  const email = rawEmail && EMAIL_RE.test(rawEmail) ? rawEmail.toLowerCase() : null
  const phone = pickSlot(row, PHONE_KEYS, '_phone')
  const title = pickSlot(row, TITLE_KEYS, '_title') ?? pickSlot(row, [], '_role')
  if (!name && !email) return null
  return { name, email, phone, title }
}

// The repeater field ids a questionnaire schema declares (top-level fields only —
// a repeater cannot nest).
export function repeaterFieldIds(schema: PartySchemaLike | null | undefined): string[] {
  const ids: string[] = []
  for (const s of schema?.sections ?? []) {
    for (const f of s.fields ?? []) {
      if (f?.id && typeof f.type === 'string' && REPEATER_TYPES.has(f.type)) ids.push(f.id)
    }
  }
  return ids
}

// Extract every intake party from a submitted answer map. Schema-driven when a
// schema is available (each repeater field's answer, with the legacy hardcoded
// 'members' answer key as fallback for old submissions); with no schema, the
// legacy 'members' key alone is consulted. Rows dedupe by email (first row
// wins) so a double-entered member becomes one party.
export function extractIntakeParties(
  schema: PartySchemaLike | null | undefined,
  responses: Record<string, unknown> | null | undefined,
): IntakeParty[] {
  if (!responses || typeof responses !== 'object') return []
  const answerArrays: unknown[][] = []
  const fieldIds = repeaterFieldIds(schema)
  const consumed = new Set<string>()
  for (const id of fieldIds) {
    const v = responses[id]
    if (Array.isArray(v)) {
      answerArrays.push(v)
      consumed.add(id)
    }
  }
  // Legacy fallback: the /book funnel historically wrote repeater rows under the
  // fixed key 'members' regardless of the field's id.
  if (!consumed.has('members') && Array.isArray(responses.members)) {
    if (fieldIds.length === 0 || fieldIds.some((id) => !Array.isArray(responses[id]))) {
      answerArrays.push(responses.members)
    }
  }
  const out: IntakeParty[] = []
  const seenEmails = new Set<string>()
  for (const rows of answerArrays) {
    for (const raw of rows) {
      const party = partyFromRow(raw)
      if (!party) continue
      if (party.email) {
        if (seenEmails.has(party.email)) continue
        seenEmails.add(party.email)
      }
      out.push(party)
    }
  }
  return out
}
