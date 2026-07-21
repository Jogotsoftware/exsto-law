// ESIGN-UNIFY-1 (ES-1) — the placement storage model (design §5.1).
//
// Anchor markers (esign/fields.ts) remain the authoring/storage representation
// inside document BODIES and templates; the ENVELOPE stores resolved coordinate
// placements. This module is pure (no DB, no React — mirrors fields.ts) so it is
// safe to import from the action handler, the send builder, and the (future,
// ES-2) placement canvas alike.
//
// `PlacementFieldType` extends the existing marker vocabulary (sign/initial/
// name/date/title/text/check) with data-bound types the placement surface adds
// (email/company/phone/address, §5.3 auto-fill). It is intentionally its OWN
// union here rather than re-exporting `EsignFieldType` from fields.ts — that
// grammar extension is ES-2's touch (fields.ts MARKER_TYPE_PATTERN + LABELS);
// this module must not force that change onto ES-1.

export type PlacementFieldType =
  | 'sign'
  | 'initial'
  | 'name'
  | 'date'
  | 'title'
  | 'text'
  | 'check'
  | 'email'
  | 'company'
  | 'phone'
  | 'address'

export const PLACEMENT_FIELD_TYPES: readonly PlacementFieldType[] = [
  'sign',
  'initial',
  'name',
  'date',
  'title',
  'text',
  'check',
  'email',
  'company',
  'phone',
  'address',
]

export interface PlacementAnchor {
  type: PlacementFieldType
  key: string
  occurrence: number
}

export interface PlacementRect {
  page: number
  x: number
  y: number
  w: number
  h: number
}

export interface FieldPlacement {
  /** 'p0', 'p1', … — envelope-stable (assigned when the placement is created). */
  id: string
  type: PlacementFieldType
  /** Matches a signature_request's signer_key. */
  signerKey: string
  required: boolean
  /** Caption shown to the signer. */
  label?: string
  source: 'anchor' | 'placed'
  /** Present when source='anchor': which body marker produced this placement. */
  anchor?: PlacementAnchor
  /** ALWAYS present: normalized page coords (0..1 of page width/height), y from top. */
  rect: PlacementRect
}

export function isPlacementFieldType(value: unknown): value is PlacementFieldType {
  return typeof value === 'string' && (PLACEMENT_FIELD_TYPES as string[]).includes(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseRect(value: unknown): PlacementRect | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  const page = Number(r.page)
  const x = Number(r.x)
  const y = Number(r.y)
  const w = Number(r.w)
  const h = Number(r.h)
  if (![page, x, y, w, h].every((n) => isFiniteNumber(n))) return null
  return { page, x, y, w, h }
}

function parseAnchor(value: unknown): PlacementAnchor | undefined {
  if (!value || typeof value !== 'object') return undefined
  const a = value as Record<string, unknown>
  if (!isPlacementFieldType(a.type)) return undefined
  if (typeof a.key !== 'string' || !a.key) return undefined
  if (!isFiniteNumber(a.occurrence)) return undefined
  return { type: a.type, key: a.key, occurrence: a.occurrence }
}

// Defensively parse a single placement. Never throws — an entry that doesn't
// shape-check is dropped rather than poisoning the whole read (a hand-edited or
// future-shaped JSON blob must not break every envelope that carries it).
function parsePlacement(value: unknown): FieldPlacement | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id) return null
  if (!isPlacementFieldType(o.type)) return null
  if (typeof o.signerKey !== 'string' || !o.signerKey) return null
  const rect = parseRect(o.rect)
  if (!rect) return null
  const placement: FieldPlacement = {
    id: o.id,
    type: o.type,
    signerKey: o.signerKey,
    required: Boolean(o.required),
    source: o.source === 'anchor' ? 'anchor' : 'placed',
    rect,
  }
  if (typeof o.label === 'string' && o.label) placement.label = o.label
  const anchor = parseAnchor(o.anchor)
  if (anchor) placement.anchor = anchor
  return placement
}

// Defensive read of the `envelope_placements` attribute (0186). Legacy
// envelopes never wrote this attribute (they only carry `envelope_fields`, the
// whole-line marker model) — a missing/null/non-array value degrades to an
// empty list rather than throwing, so every existing envelope keeps rendering
// through the current whole-line flow (§5.1). Malformed individual entries are
// dropped, not fatal to the rest of the list.
export function parseEnvelopePlacements(raw: unknown): FieldPlacement[] {
  if (!Array.isArray(raw)) return []
  const out: FieldPlacement[] = []
  for (const item of raw) {
    const parsed = parsePlacement(item)
    if (parsed) out.push(parsed)
  }
  return out
}

// Serialize for storage — a thin passthrough today (the attribute is JSON), but
// kept as the one seam so a future normalization step (e.g. clamping rects to
// [0,1]) has a single call site.
export function serializeEnvelopePlacements(placements: FieldPlacement[]): FieldPlacement[] {
  return placements
}
