'use client'

// ESIGN-GUIDED-1 — the sticky DocuSign-style action bar for the guided
// click-to-sign walk: document title, step/progress readout, and a single
// primary CTA whose label tracks the walk (Start → Next → Finish). Decline
// stays reachable throughout (§ founder brief); "Edit signature" only shows
// once the document stage has been reached (there's nothing to edit yet on
// the up-front adopt screen — that screen IS the editor).
import { EditIcon } from '@/components/icons'

export function GuidedSignBar({
  title,
  stepLabel,
  ctaLabel,
  onPrimary,
  primaryDisabled,
  onDecline,
  declineDisabled,
  onEditSignature,
  busy,
}: {
  title: string
  /** "Step 1 of 2 — Adopt your signature" or "2 of 5 required fields complete". */
  stepLabel: string
  ctaLabel: string
  onPrimary: () => void
  primaryDisabled?: boolean
  onDecline: () => void
  declineDisabled?: boolean
  onEditSignature?: () => void
  busy?: 'sign' | 'decline' | null
}) {
  return (
    <div className="li-esp-guidebar">
      <div className="li-esp-guidebar-info">
        <div className="li-esp-guidebar-title">{title}</div>
        <div className="li-esp-guidebar-step">{stepLabel}</div>
      </div>
      <div className="li-esp-guidebar-actions">
        {onEditSignature && (
          <button
            type="button"
            className="li-cp-btn li-cp-btn--ghost li-cp-btn--sm li-esp-guidebar-edit"
            disabled={Boolean(busy)}
            onClick={onEditSignature}
          >
            <EditIcon size={14} /> Edit signature
          </button>
        )}
        <button
          type="button"
          className="li-cp-btn li-cp-btn--danger li-cp-btn--sm"
          disabled={declineDisabled || Boolean(busy)}
          onClick={onDecline}
        >
          {busy === 'decline' ? 'Declining…' : 'Decline'}
        </button>
        <button
          type="button"
          className="li-cp-btn li-esp-guidebar-cta"
          disabled={primaryDisabled || Boolean(busy)}
          onClick={onPrimary}
        >
          {busy === 'sign' && <span className="spinner" />}
          {busy === 'sign' ? 'Signing…' : ctaLabel}
        </button>
      </div>
    </div>
  )
}
