// ESIGN-FIELDS-1 — one drag-and-drop contract for merge-field {{tokens}}, shared
// by every drag SOURCE (the Merge-fields cards, the Standard-fields chips) and
// every drop TARGET (the editor canvas → insert the token; a signer role's
// identity slots → bind the token). Single-sourced so a chip dragged out of one
// panel is understood by every drop zone, and so the payload never drifts.

import type { DragEvent } from 'react'

// A private mime so an intra-app token drop is distinguishable from arbitrary
// text dropped in from outside (a pasted URL, a file). text/plain carries the
// literal {{token}} too, as a graceful fallback for drops onto plain inputs.
export const MERGE_FIELD_MIME = 'application/x-exsto-mergefield'

// The token grammar tokens use everywhere (lower snake_case). A dropped value is
// normalized through this so a stray label or casing can never bind a bad token.
export function normalizeToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^\{\{|\}\}$/g, '')
    .replace(/[^a-z0-9_]/g, '')
}

// Spread onto any element that should be a draggable merge-field chip.
export function mergeFieldDragProps(token: string): {
  draggable: true
  onDragStart: (e: DragEvent) => void
} {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(MERGE_FIELD_MIME, token)
      e.dataTransfer.setData('text/plain', `{{${token}}}`)
      e.dataTransfer.effectAllowed = 'copy'
    },
  }
}

// Read a dropped merge-field token, or null if the drop isn't one of ours. Falls
// back to parsing a text/plain {{token}} so a token dragged from an external
// source that only exposes text still resolves.
export function readDroppedToken(e: DragEvent): string | null {
  const direct = e.dataTransfer.getData(MERGE_FIELD_MIME)
  if (direct) return normalizeToken(direct)
  const text = e.dataTransfer.getData('text/plain')
  if (text && /^\{\{[a-z0-9_]+\}\}$/i.test(text.trim())) return normalizeToken(text)
  return null
}

// True when a drag carries a merge-field token — for dragover highlighting.
// (dataTransfer.types is readable during dragover even though getData is not.)
export function dragHasToken(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(MERGE_FIELD_MIME)
}
