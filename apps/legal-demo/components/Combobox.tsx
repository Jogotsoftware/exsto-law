'use client'

// A searchable single-select (typeahead) — beta feedback: matter/contact pickers
// on the calendar should be searchable, not long scrollable <select> lists. Filters
// the options client-side (correct at firm scale — tens/hundreds of records); the
// caller loads the full list once. Keyboard: ↑/↓ to move, Enter to pick, Esc to
// close; closes on outside click. Reusable anywhere a long picker is clunky.
import { useEffect, useId, useRef, useState } from 'react'

export interface ComboboxOption {
  value: string
  label: string
  // Optional secondary text shown dimmed (e.g. the client name under a matter #).
  // Also searched, so typing a client name finds their matter.
  hint?: string
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Search…',
  disabled = false,
  ariaLabel,
}: {
  options: ComboboxOption[]
  value: string | null
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const selected = options.find((o) => o.value === value) ?? null
  const q = query.trim().toLowerCase()
  const filtered =
    open && q
      ? options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q))
      : options

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function choose(o: ComboboxOption) {
    onChange(o.value)
    setQuery('')
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlight((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      if (open && filtered[highlight]) {
        e.preventDefault()
        choose(filtered[highlight]!)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="cbx" ref={rootRef}>
      <input
        className="cbx-input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        disabled={disabled}
        placeholder={placeholder}
        value={open ? query : (selected?.label ?? '')}
        onFocus={() => {
          setOpen(true)
          setQuery('')
          setHighlight(0)
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setHighlight(0)
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="cbx-list" role="listbox" id={listId}>
          {filtered.length === 0 && <li className="cbx-empty">No matches</li>}
          {filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`cbx-option${i === highlight ? ' active' : ''}`}
              // onMouseDown (not onClick) fires before the input blur closes the
              // list; preventDefault keeps focus so the selection lands.
              onMouseDown={(e) => {
                e.preventDefault()
                choose(o)
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              <span className="cbx-option-label">{o.label}</span>
              {o.hint && <span className="cbx-option-hint">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
