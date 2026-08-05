'use client'

// UIWALK-2 (PR-3) — the brand-color control: a full in-page color wheel
// (react-colorful's saturation square + hue slider) with a hex input and a
// Reset. Replaces the native <input type="color"> row, whose OS-dialog picker
// read as a limited swatch set on some platforms (walkthrough finding: "org
// color should be a full color wheel"). Normalizes to #rrggbb before calling
// onChange; the server re-validates on save (handlers/firmProfile.ts).
//
// Reusable: the invoice-template accent picker can adopt this control later —
// props are a plain value/onChange/defaultHex trio, nothing firm-specific.

import { useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import { HEX_RE } from '@/lib/brandColor'

export function ColorWheelField({
  value,
  onChange,
  defaultHex,
  label,
}: {
  // null = unset (product default applies).
  value: string | null
  onChange: (hex: string | null) => void
  // Shown in the wheel when unset, e.g. the product navy.
  defaultHex: string
  // Accessible name for the hex input / wheel.
  label: string
}) {
  // The hex box edits freely (partial input while typing); only a valid
  // #rrggbb commits upward. Null when not editing — display the stored value.
  const [text, setText] = useState<string | null>(null)

  function commitText(raw: string): void {
    setText(raw)
    const v = raw.trim().startsWith('#') ? raw.trim() : `#${raw.trim()}`
    if (HEX_RE.test(v)) onChange(v.toLowerCase())
    else if (raw.trim() === '') onChange(null)
  }

  return (
    <span className="li-colorwheel">
      <HexColorPicker
        color={value ?? defaultHex}
        onChange={(hex) => {
          setText(null)
          onChange(hex.toLowerCase())
        }}
        aria-label={label}
      />
      <span className="li-colorwheel-row">
        <span className="li-colorwheel-swatch" style={{ background: value ?? defaultHex }} />
        <input
          className="li-set-input"
          value={text ?? value ?? ''}
          placeholder="Default navy"
          spellCheck={false}
          aria-label={`${label} hex value`}
          onChange={(e) => commitText(e.target.value)}
          onBlur={() => setText(null)}
        />
        {value && (
          <button
            type="button"
            className="li-set-btn"
            onClick={() => {
              setText(null)
              onChange(null)
            }}
          >
            Reset
          </button>
        )}
      </span>
    </span>
  )
}
