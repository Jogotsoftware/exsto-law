// ESIGN-UNIFY-1 ES-2 (§5.3) — send-time data auto-fill for placements.
//
// Data-bound placements (name/email/title/phone/address/company) auto-populate
// when the envelope is sent, from the bound contact/matter. The sender sees the
// resolved value in the canvas; the executed render stamps it; an unresolvable
// field degrades to signer-fillable — NEVER an invented value, and NEVER a
// FIRM_DEFAULTS identity value (the same forgery doctrine as
// tenantSettings.ts:244-252, where firm identity degrades to EMPTY rather than
// leaking a template default into a merged document).
//
// Pure (no DB): the caller reads the same buildMergeData-class sources the
// document-merge seam uses and passes them in as plain facts. This module then
// resolves per placement in a fixed order and, belt-and-braces, reads matter
// facts through an ALLOW-LIST so a firm-identity key that ever slipped into the
// merge blob can never surface on a signature field.

import type { FieldPlacement } from './placements.js'

/** A recipient row as the resolver needs it — the signer's OWN facts win first
 *  (a signer's `name` field fills with THEIR name, not the primary contact's). */
export interface PlacementRecipient {
  signerKey: string
  name?: string | null
  email?: string | null
  title?: string | null
}

/** The bound contact entity's own attributes (email/phone/address/company). */
export interface PlacementContactFacts {
  email?: string | null
  phone?: string | null
  address?: string | null
  /** The contact's company_name attribute — contact-sourced, never firm identity. */
  company?: string | null
}

// The ONLY matter-merge keys a placement may read. Firm-identity keys
// (firm_name, attorney_name, attorney_email, firm_address, …) are deliberately
// ABSENT — the poison guard. If a value for a forbidden key ever rides in the
// merge blob it is never surfaced onto a field.
export const ALLOWED_MATTER_KEYS = ['company_name'] as const
export type AllowedMatterKey = (typeof ALLOWED_MATTER_KEYS)[number]

export interface ResolvePlacementDataInput {
  recipients: PlacementRecipient[]
  /** The bound contact's facts, or null (standalone envelope). */
  contact?: PlacementContactFacts | null
  /** Matter merge facts (buildMergeData output). Read via the allow-list only. */
  matter?: Record<string, unknown> | null
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  return t ? t : null
}

/** Read a matter merge fact — allow-listed keys only. Anything not in
 *  ALLOWED_MATTER_KEYS returns null even if present in the blob (poison guard). */
function matterFact(
  matter: Record<string, unknown> | null | undefined,
  key: AllowedMatterKey,
): string | null {
  if (!matter) return null
  if (!(ALLOWED_MATTER_KEYS as readonly string[]).includes(key)) return null
  return str(matter[key])
}

/**
 * Resolve each placement to its auto-fill value (or null = signer-fillable).
 * Order per §5.3: the placement's signer's own recipient row → the bound
 * contact entity → matter merge facts (allow-listed). `sign`/`initial`/`text`/
 * `check` are always signer-completed (null); `date` is null here and auto-fills
 * with the actual signing date at the SIGNING moment (never pre-typed, §15.7).
 */
export function resolvePlacementData(
  placements: FieldPlacement[],
  input: ResolvePlacementDataInput,
): Record<string, string | null> {
  const bySignerKey = new Map<string, PlacementRecipient>()
  for (const r of input.recipients) bySignerKey.set(r.signerKey, r)
  const contact = input.contact ?? null

  const out: Record<string, string | null> = {}
  for (const p of placements) {
    const me = bySignerKey.get(p.signerKey)
    out[p.id] = resolveOne(p, me, contact, input.matter ?? null)
  }
  return out
}

function resolveOne(
  p: FieldPlacement,
  me: PlacementRecipient | undefined,
  contact: PlacementContactFacts | null,
  matter: Record<string, unknown> | null,
): string | null {
  switch (p.type) {
    case 'name':
      return str(me?.name)
    case 'email':
      return str(me?.email) ?? str(contact?.email)
    case 'title':
      return str(me?.title)
    case 'phone':
      return str(contact?.phone)
    case 'address':
      return str(contact?.address)
    case 'company':
      return str(contact?.company) ?? matterFact(matter, 'company_name')
    // sign/initial/text/check → the signer adopts/fills. date → auto at sign.
    default:
      return null
  }
}
