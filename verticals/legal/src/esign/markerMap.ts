// ESIGN-UNIFY-1 ES-2 (§5.2) — the anchor→rect bridge (the "marker map").
//
// A draft's body carries `{{type:key}}` markers (fields.ts) that render as ruled
// signature lines in the PDF (draftPdf.ts). The placement canvas needs those
// pre-placed as COORDINATE boxes so the attorney adjusts rather than rebuilds
// (§4 "template-default placement pre-seeds this surface"). react-pdf renders to
// bytes and never exposes its internal layout, so we cannot read the true rect of
// each ruled line back out. Instead we DERIVE a marker map deterministically from
// the same source the renderer flows — walking the markdown lines against
// draftPdf's LETTER geometry (612×792pt, 44/40 padding) and stepping a point
// cursor down the page, wrapping to the next page on overflow. It is an
// approximation on purpose: the boxes land in reading order at sensible spots and
// the attorney nudges them — which is exactly the design's bar. Pure (no DB, no
// react-pdf), so it runs in the render route AND in unit tests.

import { parseMarkerLine } from './fields.js'
import {
  clamp01,
  defaultRectForType,
  LETTER_POINTS,
  type FieldPlacement,
  type PlacementAnchor,
  type PlacementFieldType,
  type PlacementRect,
} from './placements.js'

export interface MarkerMapEntry {
  anchor: PlacementAnchor
  /** Normalized page rect (0..1, y from top) — the same contract as FieldPlacement. */
  rect: PlacementRect
  /** The caption on the ruled line (marker prefix or the type's default label). */
  label: string
}

// draftPdf.ts LETTER geometry — kept in sync with its StyleSheet (page padding
// 44 vertical / 40 horizontal, base fontSize 11 × lineHeight 1.5 ≈ 16.5pt/line).
const CONTENT_TOP = 44
const CONTENT_BOTTOM = LETTER_POINTS.h - 44 // 748
const CONTENT_LEFT = 40
// A source line's contribution to the flow cursor. Blank lines separate blocks;
// a sig marker line reserves its own box height plus breathing room.
const LINE_STEP = 16.5
const BLANK_STEP = 8

/**
 * Derive the marker map for a markdown body: one entry per WHOLE-LINE marker
 * (the lines that render as ruled signature lines), in appearance order, each
 * with a normalized rect and its (type,key,occurrence) provenance. Inline
 * markers mid-sentence are intentionally skipped — they stay prose in the render
 * (executionBlock.ts) and have no standalone box.
 */
export function deriveMarkerMap(
  markdown: string,
  pagePoints: { w: number; h: number } = LETTER_POINTS,
): MarkerMapEntry[] {
  const out: MarkerMapEntry[] = []
  if (!markdown) return out
  const occ = new Map<string, number>() // `${type}:${key}` → count so far
  let page = 0
  let cursor = CONTENT_TOP
  const leftNorm = CONTENT_LEFT / pagePoints.w

  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line.trim()) {
      cursor += BLANK_STEP
      continue
    }
    const marker = parseMarkerLine(line)
    if (!marker) {
      cursor += LINE_STEP
      continue
    }
    const type = marker.type as PlacementFieldType
    const boxHeightPt = defaultRectForType(type, page, { x: 0, y: 0 }, pagePoints).h * pagePoints.h
    // Wrap to a new page when the box would run past the bottom margin.
    if (cursor + boxHeightPt > CONTENT_BOTTOM) {
      page += 1
      cursor = CONTENT_TOP
    }
    const key = `${type}:${marker.signerKey}`
    const occurrence = occ.get(key) ?? 0
    occ.set(key, occurrence + 1)
    const rect = defaultRectForType(
      type,
      page,
      { x: leftNorm, y: clamp01(cursor / pagePoints.h) },
      pagePoints,
    )
    out.push({
      anchor: { type, key: marker.signerKey, occurrence },
      rect,
      label: marker.label,
    })
    cursor += boxHeightPt + LINE_STEP
  }
  return out
}

const REQUIRED_BY_DEFAULT: ReadonlySet<PlacementFieldType> = new Set(['sign', 'initial'])

/**
 * Convert a marker map into anchor-sourced FieldPlacements the canvas seeds with.
 * Ids are envelope-stable positional (`p0`, `p1`, …) starting from `startIndex`
 * so anchor placements can coexist with free-placed ones. `signerKeyFor` maps a
 * marker's signer key onto a recipient's signer key (identity by default; the
 * composer may remap template role keys onto its recipient rows).
 */
export function markerMapToPlacements(
  entries: MarkerMapEntry[],
  opts?: { startIndex?: number; signerKeyFor?: (markerKey: string) => string },
): FieldPlacement[] {
  const start = opts?.startIndex ?? 0
  const signerKeyFor = opts?.signerKeyFor ?? ((k: string) => k)
  return entries.map((entry, i) => {
    const placement: FieldPlacement = {
      id: `p${start + i}`,
      type: entry.anchor.type,
      signerKey: signerKeyFor(entry.anchor.key),
      required: REQUIRED_BY_DEFAULT.has(entry.anchor.type),
      source: 'anchor',
      anchor: entry.anchor,
      rect: entry.rect,
    }
    if (entry.label) placement.label = entry.label
    return placement
  })
}
