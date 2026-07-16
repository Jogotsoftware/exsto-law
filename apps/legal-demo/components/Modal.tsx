'use client'

// A focused detail "window" over the page — the dialog beta feedback asks for when
// clicking into a matter workflow step. Mirrors the settings dialog markup (the
// shared .modal-* CSS) and closes on backdrop click or Escape; locks body scroll
// while open.
import { useEffect, useId, useRef } from 'react'

// Open-modal stack so Escape closes only the TOPMOST dialog. Modals now stack
// (e.g. an in-app confirm over the workflow runner — RUNNER-FIXES-1 WP3); every
// instance listens for Escape on document, so without this one keypress would
// close the whole stack at once.
const OPEN_MODALS: symbol[] = []

export function Modal({
  title,
  onClose,
  children,
  footer,
  // 'default' keeps the 640px confirm-box width. 'wide' sizes the card for real
  // work — the workflow runner's document steps (review/edit) need a two-pane
  // feel, not a confirm box (WORKFLOW-RUNNER-1 WP1).
  size = 'default',
}: {
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'default' | 'wide'
}) {
  const titleId = useId()
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Remember what was focused so we can restore it when the dialog closes.
    const prevFocus = document.activeElement as HTMLElement | null
    const token = Symbol('modal')
    OPEN_MODALS.push(token)
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && OPEN_MODALS[OPEN_MODALS.length - 1] === token) onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Move focus into the dialog on open (the card is tabIndex=-1).
    cardRef.current?.focus()
    return () => {
      const i = OPEN_MODALS.indexOf(token)
      if (i !== -1) OPEN_MODALS.splice(i, 1)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={size === 'wide' ? 'modal-card modal-card-wide' : 'modal-card'}
        ref={cardRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-head">
          <h2 id={titleId} style={{ margin: 0 }}>
            {title}
          </h2>
          <button onClick={onClose} aria-label="Close" className="modal-close" type="button">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
