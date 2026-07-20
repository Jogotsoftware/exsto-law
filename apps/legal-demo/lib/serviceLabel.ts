'use client'

// FB-C — the ONE serviceKey → display label resolver. This collapses 5 copies
// of the same function (app/attorney/page.tsx, matters/page.tsx,
// matters/[id]/shared.tsx, crm/contacts/[id]/page.tsx, WeeklyCalendar.tsx) that
// each hardcoded `if (key === 'llc_formation') return 'NC LLC formation'` — a
// literal that was only ever right for one firm's one service. A service's
// real display name is attorney-configured data (workflow_definition.displayName,
// reached via legal.service.list); a key with no resolved name gets an honest
// generic humanization, never a guessed/hardcoded label.
import { useEffect, useState } from 'react'
import { callAttorneyMcp } from './mcpAttorney'

// Generic last-resort: 'llc_formation' → 'llc formation'. No special cases —
// whatever a firm actually calls a service lives in its config, not here.
export function humanizeServiceKey(key: string): string {
  if (!key) return '—'
  if (key === 'other') return 'Custom'
  return key.replace(/_/g, ' ')
}

// Prefers the resolved catalog's displayName; falls back to the generic
// humanization when the key is unknown (deleted/legacy service, or the
// catalog hasn't loaded yet). `displayNames` is optional — omit it (or pass
// null/undefined) to get the honest fallback alone.
export function serviceLabel(key: string, displayNames?: Record<string, string> | null): string {
  if (!key) return humanizeServiceKey(key)
  return displayNames?.[key] ?? humanizeServiceKey(key)
}

// Module-level cache: the service catalog rarely changes within a session and
// several attorney pages want the same serviceKey → displayName map, so one
// fetch is shared across every caller (component or plain function alike).
let cache: Record<string, string> | null = null
let inflight: Promise<Record<string, string>> | null = null

async function loadServiceDisplayNames(): Promise<Record<string, string>> {
  if (cache) return cache
  if (!inflight) {
    inflight = callAttorneyMcp<{ services: Array<{ serviceKey: string; displayName: string }> }>({
      toolName: 'legal.service.list',
    })
      .then((r) => {
        cache = Object.fromEntries(r.services.map((s) => [s.serviceKey, s.displayName]))
        return cache
      })
      .catch(() => {
        inflight = null // allow a retry on the next call
        return {}
      })
  }
  return inflight
}

// Whatever is cached RIGHT NOW, synchronously — for non-component call sites
// (e.g. shared.tsx's plain humanizeService helper) that can't hold hook state.
// Null until something has triggered a load (typically useServiceDisplayNames
// elsewhere on the same page).
export function getCachedServiceDisplayNames(): Record<string, string> | null {
  return cache
}

// Attorney-side hook: the live serviceKey → displayName map, cached/shared
// across every component that calls it (one network round trip per session,
// not per caller).
export function useServiceDisplayNames(): Record<string, string> | null {
  const [names, setNames] = useState<Record<string, string> | null>(cache)
  useEffect(() => {
    let cancelled = false
    loadServiceDisplayNames().then((m) => {
      if (!cancelled) setNames(m)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return names
}
