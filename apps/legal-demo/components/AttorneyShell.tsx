'use client'

// UIWALK-2 (PR-3) — the attorney console shell, now brand-aware. Fetches the
// firm's brand color (Settings → Firm Details, substrate attr
// firm_header_color) once and sets --li-brand / --li-brand-deep on the
// .li-shell root; tail rules in globals.css tint the top bar and rail from
// those vars with the product navy as fallback. Best-effort: while loading or
// when unset, no vars are set and the defaults apply. This replaces the old
// per-component inline style on AttorneyTopBar so every chrome consumer reads
// ONE source.

import { useEffect, useState, type ReactNode } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { brandVars } from '@/lib/brandColor'

export function AttorneyShell({ children }: { children: ReactNode }): React.ReactElement {
  const [brand, setBrand] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    callAttorneyMcp<{ settings: { headerColor: string | null } }>({
      toolName: 'legal.settings.get',
    })
      .then((r) => {
        if (!cancelled) setBrand(r.settings.headerColor)
      })
      .catch(() => {
        /* default navy chrome */
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="li-shell" style={brandVars(brand)}>
      {children}
    </div>
  )
}
