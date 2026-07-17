'use client'

import type { ReactElement, ReactNode } from 'react'
import { GemSparkle } from '@/components/GemSparkle'

// WP-L — the ONE visual shell for every assistant proposal card (comp:
// legal-instruments.dc.html § ASSISTANT FAB + PANEL, `hasProposal`). Gradient
// header with a gemstar + uppercase KIND label, white body with the proposal
// title, the per-kind preview (facts grid / sections / doc thumb / steps) as
// children, and the action row (Approve + "Open & edit" per comp, plus each
// card's real extras). Purely presentational — every card keeps its own state,
// approve POST, and real editor modal.
export function ProposalCardShell({
  kind,
  title,
  meta,
  children,
  actions,
  footer,
}: {
  /** Uppercase kind label in the header (e.g. "New service", "Workflow"). */
  kind: string
  /** The proposal's display title (first line of the body). */
  title: ReactNode
  /** Small muted text right-aligned in the header (key, counts). */
  meta?: ReactNode
  children?: ReactNode
  /** The action row (comp: Approve + Open & edit [+ links]). */
  actions?: ReactNode
  /** Below the actions — error alerts, revise inputs, editor modals. */
  footer?: ReactNode
}): ReactElement {
  return (
    <div className="li-uac-prop">
      <div className="li-uac-prop-head">
        <GemSparkle size={14} />
        <span className="li-uac-prop-kind">{kind}</span>
        {meta ? <span className="li-uac-prop-meta">{meta}</span> : null}
      </div>
      <div className="li-uac-prop-body">
        <div className="li-uac-prop-title">{title}</div>
        {children}
        {actions ? <div className="li-uac-prop-actions">{actions}</div> : null}
        {footer}
      </div>
    </div>
  )
}

/** Comp facts grid (2-col, hairline dividers): label uppercase / value. */
export function ProposalFacts({
  facts,
}: {
  facts: Array<{ label: string; value: ReactNode }>
}): ReactElement {
  return (
    <div className="li-uac-facts">
      {facts.map((f, i) => (
        <div key={i} className="li-uac-fact">
          <div className="li-uac-fact-label">{f.label}</div>
          <div className="li-uac-fact-value">{f.value}</div>
        </div>
      ))}
    </div>
  )
}

/** Comp sections preview: uppercase section title + gold-dot items. */
export function ProposalSections({
  sections,
}: {
  sections: Array<{ title: string; items: ReactNode[] }>
}): ReactElement {
  return (
    <div className="li-uac-secs">
      {sections.map((s, i) => (
        <div key={i} className="li-uac-sec">
          <div className="li-uac-sec-title">{s.title}</div>
          {s.items.map((it, j) => (
            <div key={j} className="li-uac-sec-item">
              <span className="li-uac-sec-dot" aria-hidden="true" />
              <span>{it}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
