'use client'

// A focused detail "window" over the page — the dialog beta feedback asks for when
// clicking into a matter workflow step. Mirrors the settings dialog markup (the
// shared .modal-* CSS) and closes on backdrop click or Escape; locks body scroll
// while open.
import { useEffect, useId, useRef } from 'react'

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const titleId = useId()
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Remember what was focused so we can restore it when the dialog closes.
    const prevFocus = document.activeElement as HTMLElement | null
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Move focus into the dialog on open (the card is tabIndex=-1).
    cardRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-card"
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
