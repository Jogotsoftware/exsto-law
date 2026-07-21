'use client'

import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

// Reusable eye-toggle password input (PT-3, founder walk item 15.22) — every
// password field in the portal (set/claim, confirm, sign-in, reset) renders
// through this one component so the show/hide affordance, sizing, and a11y
// wiring never drift between them.
//
// Deliberately unopinionated about the surrounding design system: the caller
// passes its own input/wrap class names (li-cp-input + a bare wrap for the
// portal auth cards, bk-input + the existing bk-input-wrap for the booking
// flow's ContactField) and this component only adds the toggle button plus a
// shared `li-pw-input`/`li-pw-toggle` pair (styled once in globals.css,
// scoped-safe in both the --li-* and --bk-* token contexts).
export function PasswordField({
  id,
  label,
  value,
  onChange,
  inputClassName,
  wrapClassName,
  leadingIcon,
  placeholder,
  autoComplete,
  required,
  minLength,
  disabled,
}: {
  id?: string
  /** Rendered as a visible <label> when provided; omit when the caller renders its own. */
  label?: string
  value: string
  onChange: (value: string) => void
  inputClassName: string
  wrapClassName: string
  /** Left-side icon element for design systems that render one (e.g. bk-input-wrap). */
  leadingIcon?: React.ReactNode
  placeholder?: string
  autoComplete?: string
  required?: boolean
  minLength?: number
  disabled?: boolean
}) {
  const autoId = useId()
  const inputId = id ?? autoId
  const [visible, setVisible] = useState(false)
  const { t } = useI18n()
  const showLabel = t('pw.show', undefined, 'Show password')
  const hideLabel = t('pw.hide', undefined, 'Hide password')

  const field = (
    <div className={wrapClassName}>
      {leadingIcon && (
        <span className="bk-input-icon" aria-hidden>
          {leadingIcon}
        </span>
      )}
      <input
        id={inputId}
        type={visible ? 'text' : 'password'}
        className={`${inputClassName} li-pw-input`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        disabled={disabled}
      />
      <button
        type="button"
        className="li-pw-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        tabIndex={0}
      >
        {visible ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
      </button>
    </div>
  )

  if (!label) return field

  return (
    <>
      <label className="li-cp-label" htmlFor={inputId}>
        {label}
      </label>
      {field}
    </>
  )
}
