'use client'

// ITEM-12 WP-2 — reusable Enter-to-add pills editor. Joe: "the instructions for
// each chat need [to] save as pills when you put an instruction in and hit
// enter. this way they can easily be added or removed." Generalizes two
// existing one-off chip patterns into a single reusable control:
//   - tpl-ai-skillchip (services/[serviceKey]/templates/page.tsx) — a picked
//     skill rendered as a removable chip.
//   - mail-attach-chip / li-uac-pendingdoc-chip (EmailComposeModal.tsx) — a
//     pending document rendered as a removable, wrapping chip.
// Type into the input, press Enter (or blur the field with text still in it)
// to commit a pill; click a pill's × or press Backspace on an empty input to
// remove the last one. Values dedupe case-insensitively — the same
// instruction can't be added twice.
import { useState } from 'react'

// ── Pure helpers ─────────────────────────────────────────────────────────────
// Exported so the add/remove/dedupe behavior is unit-testable without mounting
// React — this repo has no component-test harness (see apps/legal-demo/tests/),
// so these stay framework-free pure functions and the component below is a
// thin wrapper around them.

export interface TagInputLimits {
  maxItemChars?: number
  maxItems?: number
}

// Trims, caps, and dedupes (case-insensitive) a candidate value against the
// existing list. Returns the SAME array reference when nothing changes (empty
// after trim, over the item cap, or a duplicate) so callers can skip a
// no-op onChange.
export function addTag(values: string[], raw: string, limits: TagInputLimits = {}): string[] {
  const capped = limits.maxItemChars != null ? raw.slice(0, limits.maxItemChars) : raw
  const trimmed = capped.trim()
  if (!trimmed) return values
  if (limits.maxItems != null && values.length >= limits.maxItems) return values
  if (values.some((v) => v.toLowerCase() === trimmed.toLowerCase())) return values
  return [...values, trimmed]
}

export function removeTagAt(values: string[], index: number): string[] {
  return values.filter((_, i) => i !== index)
}

export function removeLastTag(values: string[]): string[] {
  return values.length ? values.slice(0, -1) : values
}

// ── Component ─────────────────────────────────────────────────────────────
export interface TagInputProps {
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  // Per-pill character cap and total pill-count cap (both optional — omit for
  // an unbounded list, e.g. practice areas). When maxItems is reached the
  // input disables and its placeholder explains why, rather than silently
  // swallowing further Enters.
  maxItemChars?: number
  maxItems?: number
  disabled?: boolean
}

export function TagInput({
  values,
  onChange,
  placeholder,
  maxItemChars,
  maxItems,
  disabled = false,
}: TagInputProps): React.ReactElement {
  const [draft, setDraft] = useState('')
  const atMax = maxItems != null && values.length >= maxItems

  function commit(): void {
    const next = addTag(values, draft, { maxItemChars, maxItems })
    if (next !== values) onChange(next)
    setDraft('')
  }

  return (
    <div className="li-taginput">
      {values.length > 0 && (
        <div className="li-taginput-pills">
          {values.map((v, i) => (
            <span key={`${v}-${i}`} className="li-taginput-pill">
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => onChange(removeTagAt(values, i))}
                disabled={disabled}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className="li-taginput-input"
        type="text"
        value={draft}
        placeholder={atMax ? `Limit reached (${maxItems})` : placeholder}
        disabled={disabled || atMax}
        maxLength={maxItemChars}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
            onChange(removeLastTag(values))
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit()
        }}
      />
    </div>
  )
}
