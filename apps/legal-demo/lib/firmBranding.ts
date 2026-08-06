'use client'

// FIRM-BRANDING-1 — the attorney console's one read of the firm's visual
// identity (name + brand color + logo), shared by every chrome consumer.
//
// WHY A STORE AND NOT A useEffect PER COMPONENT. Before this, AttorneyShell
// fetched legal.settings.get for the brand color and AttorneyTopBar fetched
// legal.settings.get AGAIN plus legal.firm.get_invoice_template for the logo —
// three calls on every page load for one fact, and a color saved in Settings →
// Firm Details only appeared after a full reload. One module-level store fixes
// both: a single in-flight fetch feeds every subscriber, and `refreshFirmBranding()`
// after a save re-reads once and pushes to all of them, so the header bar
// changes color the moment Save succeeds.
import { useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

export interface FirmBranding {
  firmName: string | null
  headerColor: string | null
  // BRANDING-SECTION-1 (migration 0204) — the firm's second brand color. When
  // set it IS the companion tone (rail, deep inks) instead of the darkened
  // primary; null keeps the derivation.
  secondaryColor: string | null
  logoDataUrl: string | null
  // Measured tone of that artwork. ADVISORY ONLY — nothing paints from it (the
  // automatic plate behind reversed logos was removed in BRANDING-SECTION-1);
  // the Settings uploader uses it to warn about a light mark on light pages.
  logoTone: 'light' | 'dark' | null
  // BRANDING-SECTION-1 (migration 0204) — the optional HEADER logo: a second
  // upload used only on the attorney console top bar, for firms whose main mark
  // is the wrong variant for a narrow dark strip. Null = the bar shows
  // logoDataUrl, exactly as before.
  headerLogoDataUrl: string | null
  headerLogoTone: 'light' | 'dark' | null
}

const EMPTY: FirmBranding = {
  firmName: null,
  headerColor: null,
  secondaryColor: null,
  logoDataUrl: null,
  logoTone: null,
  headerLogoDataUrl: null,
  headerLogoTone: null,
}

/**
 * The mark the ATTORNEY CONSOLE header bar shows: the dedicated header logo
 * when the firm uploaded one, otherwise the firm logo. One helper so the bar
 * and the Settings preview can never disagree about which file wins.
 */
export function headerMark(b: FirmBranding): string | null {
  return b.headerLogoDataUrl ?? b.logoDataUrl
}

let current: FirmBranding = EMPTY
let inFlight: Promise<FirmBranding> | null = null
const subscribers = new Set<(b: FirmBranding) => void>()

async function load(): Promise<FirmBranding> {
  const r = await callAttorneyMcp<{ branding: FirmBranding }>({
    toolName: 'legal.firm.get_branding',
  })
  return r.branding
}

function publish(next: FirmBranding): void {
  current = next
  for (const fn of subscribers) fn(next)
}

// Fetch once per page life unless forced. A failure resolves to the last known
// value (default chrome on first load) — branding is decoration, never a gate.
function ensure(force = false): Promise<FirmBranding> {
  if (!force && inFlight) return inFlight
  const p = load()
    .then((b) => {
      publish(b)
      return b
    })
    .catch(() => current)
  inFlight = p
  return p
}

/** Re-read the firm's branding and push it to every mounted consumer. */
export async function refreshFirmBranding(): Promise<void> {
  await ensure(true)
}

/**
 * Optimistic local update — used by the Settings editor so the header reflects
 * the picker instantly; the authoritative value follows from refreshFirmBranding().
 */
export function setFirmBrandingLocal(patch: Partial<FirmBranding>): void {
  publish({ ...current, ...patch })
}

export function useFirmBranding(): FirmBranding {
  const [branding, setBranding] = useState<FirmBranding>(current)
  useEffect(() => {
    subscribers.add(setBranding)
    void ensure().then((b) => setBranding(b))
    return () => {
      subscribers.delete(setBranding)
    }
  }, [])
  return branding
}
