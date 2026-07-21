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
  /** ES-MULTIDOC-1: which document in the envelope this placement lands on
   *  (0-based index into the envelope's ordered document set). ABSENT means
   *  document 0 — so every single-document envelope's placements (and every
   *  pre-multidoc envelope) read byte-identically without this key. `rect.page`
   *  is the page WITHIN this document; (docIndex, rect.page) together bind a
   *  placement to (document, page) unambiguously. Only written when > 0. */
  docIndex?: number
  /** ALWAYS present: normalized page coords (0..1 of page width/height), y from top. */
  rect: PlacementRect
  /** ES-2 (§5.3): the send-time resolved auto-fill value for a data-bound
   *  placement (name/email/title/phone/address/company). Written by the send
   *  path via resolvePlacementData; null/absent = signer-fillable. NEVER a
   *  guessed or FIRM_DEFAULTS value. */
  value?: string | null
}

export function isPlacementFieldType(value: unknown): value is PlacementFieldType {
  return typeof value === 'string' && (PLACEMENT_FIELD_TYPES as string[]).includes(value)
}

// ─────────────────────────────────────────────────────────────────────────
// ES-2 (§4/§5.2) — default box sizes + the normalized-coordinate contract.
//
// Every rect is stored NORMALIZED: x/y/w/h are fractions of the page's
// width/height (0..1), y measured from the TOP of the page. That makes a
// placement resolution-independent — the canvas renders at any zoom, the
// signer overlay at any device width, and the pdf-lib stamper at true PDF
// points, all from the SAME record. The two conversions below are exact
// inverses (round-trip tested) so a box the attorney drops on a 900px-wide
// canvas stamps at the identical spot on the 612pt PDF page.
//
// ESIGN-ROTATE-FIX — the canonical storage space is the ROTATED, VISUAL page
// (what the human sees). pdfjs's default getViewport honors each page's /Rotate
// (90/270 swap width & height), so the fraction is taken against the visual
// page dimensions the canvas laid out — NOT the raw MediaBox. A page with no
// /Rotate has visual dims == MediaBox dims, so every existing zero-rotation
// envelope is byte-compatible and no migration is needed. The one place that
// must undo this is the pdf-lib executed-copy stamper (stampPdf.ts), which
// draws in unrotated MediaBox points — see placementRectToMediaBox there.
// ─────────────────────────────────────────────────────────────────────────

/** Default box size per field type, in PDF POINTS (72pt = 1in), per §5.2. */
export const DEFAULT_FIELD_POINTS: Record<PlacementFieldType, { w: number; h: number }> = {
  sign: { w: 200, h: 48 },
  initial: { w: 96, h: 40 },
  date: { w: 128, h: 32 },
  name: { w: 200, h: 28 },
  title: { w: 200, h: 28 },
  text: { w: 200, h: 28 },
  check: { w: 24, h: 24 },
  email: { w: 200, h: 28 },
  company: { w: 200, h: 28 },
  phone: { w: 160, h: 28 },
  address: { w: 220, h: 44 },
}

/** US Letter, the platform's one render size (draftPdf renders LETTER). */
export const LETTER_POINTS = { w: 612, h: 792 } as const

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/** Clamp a normalized rect so it always sits within the page box (w/h never
 *  push x/y past the right/bottom edge). Idempotent. */
export function clampRect(rect: PlacementRect): PlacementRect {
  const w = clamp01(rect.w)
  const h = clamp01(rect.h)
  const x = Math.min(clamp01(rect.x), 1 - w)
  const y = Math.min(clamp01(rect.y), 1 - h)
  return { page: rect.page, x: clamp01(x), y: clamp01(y), w, h }
}

/** A pixel/point rect (origin top-left) → normalized rect, given the page's
 *  rendered pixel/point size. Clamped to the page. */
export function normalizeRect(
  px: { x: number; y: number; w: number; h: number },
  page: number,
  pageWidth: number,
  pageHeight: number,
): PlacementRect {
  if (!(pageWidth > 0) || !(pageHeight > 0)) return { page, x: 0, y: 0, w: 0, h: 0 }
  return clampRect({
    page,
    x: px.x / pageWidth,
    y: px.y / pageHeight,
    w: px.w / pageWidth,
    h: px.h / pageHeight,
  })
}

/** Normalized rect → a pixel/point rect (origin top-left) at the given rendered
 *  page size. The exact inverse of normalizeRect (pre-clamp). */
export function denormalizeRect(
  rect: PlacementRect,
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: rect.x * pageWidth,
    y: rect.y * pageHeight,
    w: rect.w * pageWidth,
    h: rect.h * pageHeight,
  }
}

/** The default normalized box for a type dropped at a point, given the page's
 *  point size (defaults to LETTER). Used both by drag-drop placement and by
 *  the marker→rect bridge (§5.2). */
export function defaultRectForType(
  type: PlacementFieldType,
  page: number,
  topLeft: { x: number; y: number },
  pagePoints: { w: number; h: number } = LETTER_POINTS,
): PlacementRect {
  const pts = DEFAULT_FIELD_POINTS[type]
  return clampRect({
    page,
    x: topLeft.x,
    y: topLeft.y,
    w: pts.w / pagePoints.w,
    h: pts.h / pagePoints.h,
  })
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
  if (typeof o.value === 'string' && o.value) placement.value = o.value
  // ES-MULTIDOC-1: only carry docIndex when it's a positive integer — a 0 or
  // absent value IS document 0, so single-doc plans never grow the key and read
  // byte-identically (parseEnvelopePlacements round-trip tests assert this).
  if (isFiniteNumber(o.docIndex) && o.docIndex >= 1) placement.docIndex = Math.floor(o.docIndex)
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

// ─────────────────────────────────────────────────────────────────────────
// ES-MULTIDOC-1 — one envelope, many documents. The placement plan is a FLAT
// list; each entry's `docIndex` (default 0) says which document it lands on.
// These pure helpers are the one place the "absent = doc 0" convention lives,
// so the handler, the stamp planner, and the canvas all group identically.
// ─────────────────────────────────────────────────────────────────────────

/** A placement's document index (0-based). Absent/negative ⇒ 0 (document 0). */
export function placementDocIndex(p: FieldPlacement): number {
  const d = p.docIndex ?? 0
  return Number.isFinite(d) && d >= 1 ? Math.floor(d) : 0
}

/** The placements that land on one document, in input order. */
export function placementsForDoc(placements: FieldPlacement[], docIndex: number): FieldPlacement[] {
  return placements.filter((p) => placementDocIndex(p) === docIndex)
}

/** Group placements by document index → a map keyed by 0-based docIndex. Every
 *  document that owns at least one placement appears; a document with none does
 *  not (callers iterate the envelope's document set, not this map, so a
 *  field-less document is still stamped/rendered — it just has no fields). */
export function groupPlacementsByDoc(placements: FieldPlacement[]): Map<number, FieldPlacement[]> {
  const byDoc = new Map<number, FieldPlacement[]>()
  for (const p of placements) {
    const d = placementDocIndex(p)
    const list = byDoc.get(d)
    if (list) list.push(p)
    else byDoc.set(d, [p])
  }
  return byDoc
}

/** The highest document index any placement references (0 when the plan is
 *  empty or entirely on document 0). Lets a reader size the document set from
 *  the placements alone when it has nothing else to go on. */
export function maxPlacementDocIndex(placements: FieldPlacement[]): number {
  let max = 0
  for (const p of placements) {
    const d = placementDocIndex(p)
    if (d > max) max = d
  }
  return max
}
