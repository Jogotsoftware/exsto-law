import type { ReactElement, ReactNode } from 'react'

// DocumentSheet — every document in the Legal Instruments redesign renders as
// a true proportional letter page through THIS component, so proportions are
// identical across the review reader, template editor + preview, gallery
// thumbnails, eSign previews, and assistant proposal cards
// (docs/design/legal-instruments — fidelity spec).
//
// Variants (all from the comp):
//   full       816×1056px (8.5in × 11in @ 96dpi), 96px padding — review
//              reader, eSign detail preview
//   editor     612×792px — template-editor canvas and its sample-data preview
//   thumb      fluid width, aspect-ratio 8.5/11, container queries (cqw) for
//              typography — template gallery, doc previews in cards
//   thumb-form aspect-ratio 8.5/9.5 — intake-form gallery cards

export type DocumentSheetVariant = 'full' | 'editor' | 'thumb' | 'thumb-form'

export type DocumentSheetProps = {
  variant?: DocumentSheetVariant
  /** EB Garamond body (template/agreement bodies). Letters stay sans per comp. */
  serif?: boolean
  /** Diagonal gold watermark text (e.g. "DRAFT — PENDING ATTORNEY APPROVAL"). */
  watermark?: string
  className?: string
  children: ReactNode
}

const VARIANT_CLASS: Record<DocumentSheetVariant, string> = {
  full: 'li-docsheet--full',
  editor: 'li-docsheet--editor',
  thumb: 'li-docsheet--thumb',
  'thumb-form': 'li-docsheet--thumb li-docsheet--thumb-form',
}

export function DocumentSheet({
  variant = 'full',
  serif = false,
  watermark,
  className,
  children,
}: DocumentSheetProps): ReactElement {
  const classes = ['li-docsheet', VARIANT_CLASS[variant]]
  if (serif) classes.push('li-docsheet--serif')
  if (className) classes.push(className)
  return (
    <div className={classes.join(' ')}>
      {watermark ? (
        <div className="li-docsheet-watermark" aria-hidden="true">
          <span>{watermark}</span>
        </div>
      ) : null}
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  )
}

/** The soft desk behind one or more sheets (comp: #EDF0F5 canvas, side-by-side capable). */
export function DocumentCanvas({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}): ReactElement {
  return (
    <div className={className ? `li-doc-canvas ${className}` : 'li-doc-canvas'}>{children}</div>
  )
}

/** Inline merge-token chip (gold), proportion-safe inside any sheet variant. */
export function TokenChip({ children }: { children: ReactNode }): ReactElement {
  return <span className="li-token-chip">{children}</span>
}
