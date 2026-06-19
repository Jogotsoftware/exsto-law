'use client'

import type { ReactNode } from 'react'

// A settings section that collapses to a single header row. Built on native
// <details>/<summary> so it's keyboard- and screen-reader-accessible for free
// and needs no open/close state. Collapsed by default (no `open` attribute);
// pass defaultOpen to start expanded.
export function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string
  subtitle?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <details className="settings-section" {...(defaultOpen ? { open: true } : {})}>
      <summary className="settings-section-summary">
        <span className="settings-section-chevron" aria-hidden>
          ▸
        </span>
        <span className="settings-section-titles">
          <span className="settings-section-title">{title}</span>
          {subtitle && <span className="settings-section-subtitle">{subtitle}</span>}
        </span>
      </summary>
      <div className="settings-section-body">{children}</div>
    </details>
  )
}
