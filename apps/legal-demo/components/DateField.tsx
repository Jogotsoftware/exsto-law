'use client'

// BUILDER-UX-1 WP-7 — the shared date-input primitive. Before this, date inputs
// were raw <input type="date"> scattered per-page with inconsistent styling and
// no shared affordance. Every date input in the app now routes through here so
// the picker looks and behaves the same everywhere. Thin on purpose: a native
// date input (best cross-platform picker) with the app's input styling and an
// optional label; extend here, never re-roll a raw date input elsewhere.
import type { InputHTMLAttributes, ReactNode } from 'react'

export interface DateFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange'
> {
  value: string
  onValueChange: (value: string) => void
  // Optional visible label rendered above the input.
  label?: ReactNode
}

export function DateField({
  value,
  onValueChange,
  label,
  className,
  ...rest
}: DateFieldProps): React.ReactElement {
  const input = (
    <input
      type="date"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      className={className ?? 'input'}
      {...rest}
    />
  )
  if (!label) return input
  return (
    <label className="uac-field-label">
      <span>{label}</span>
      {input}
    </label>
  )
}
