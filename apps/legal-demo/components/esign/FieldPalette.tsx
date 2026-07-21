'use client'

// ESIGN-UNIFY-1 ES-2 (§4) — the searchable field palette (left rail). Drag a
// chip onto a page to place it at the drop point; clicking a chip places it at
// the center of the current page (keyboard/touch path — no dead controls).
// Signature is the marquee chip (gold accent, script-like glyph).
import { useState } from 'react'
import type { PlacementFieldType } from '@exsto/legal/esign'
import { SearchIcon } from '@/components/icons'
import { FIELD_DRAG_MIME, PALETTE_ORDER, placementGlyph } from './fieldMeta'

export function FieldPalette({
  onPick,
  disabled,
}: {
  /** Click-to-place: the parent drops the field at the visible page center. */
  onPick: (type: PlacementFieldType) => void
  disabled?: boolean
}) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const types = PALETTE_ORDER.filter(
    (t) => !query || placementGlyph(t).label.toLowerCase().includes(query),
  )

  return (
    <div className="li-esp-palette">
      <div className="li-esp-palette-search">
        <SearchIcon size={14} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search fields"
          aria-label="Search fields"
        />
      </div>
      <div className="li-esp-palette-list" role="list">
        {types.map((t) => {
          const glyph = placementGlyph(t)
          return (
            <button
              key={t}
              type="button"
              role="listitem"
              className={`li-esp-chip${glyph.marquee ? ' li-esp-chip--sig' : ''}`}
              draggable={!disabled}
              disabled={disabled}
              onDragStart={(e) => {
                e.dataTransfer.setData(FIELD_DRAG_MIME, t)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => onPick(t)}
              title={`Drag onto the document, or click to place — ${glyph.label}`}
            >
              <span className="li-esp-chip-ico" aria-hidden="true">
                {glyph.icon}
              </span>
              <span className="li-esp-chip-label">{glyph.label}</span>
            </button>
          )
        })}
        {types.length === 0 && <div className="li-esp-palette-empty">No matching fields.</div>}
      </div>
    </div>
  )
}
