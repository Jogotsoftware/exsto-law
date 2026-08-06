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
import { brandVars, isHexColor } from '@/lib/brandColor'
import { RailShellProvider } from '@/components/RailShellState'

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
    // RAIL-FOLLOWUPS-1: `li-brandsurface` tells the CSS that a firm brand
    // color IS set, so surfaces that tint from it (now including the
    // expanded rail) can also flip their contrast palette — a var fallback
    // can pick the surface color but cannot branch the text color with it.
    <div
      className={`li-shell${isHexColor(brand) ? ' li-brandsurface' : ''}`}
      style={brandVars(brand)}
    >
      {/* RAIL-FOLLOWUPS-1: the top bar owns the brand lockup and the pin
          button while the rail owns the hover target, so both read the rail's
          open state from one provider here. */}
      <RailShellProvider storageKey="exsto.li.railPinned">{children}</RailShellProvider>
    </div>
  )
}
