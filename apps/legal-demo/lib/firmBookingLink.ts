'use client'

import { useEffect, useState } from 'react'
import { callAttorneyMcp } from './mcpAttorney'

// MULTI-TENANT-1 — a firm-scoped public booking URL for an attorney to SHARE. The
// public /book funnel now resolves which firm it's for from the request (host
// subdomain, or the ?firm= selector pre-DNS). So an attorney's shared link must
// carry THEIR firm's slug, or a prospect who opens it lands on the env-default
// tenant instead of the attorney's firm. Slug-less only as a last resort (unknown
// slug) — then the funnel's own default applies, same as a bare visit.
export function buildFirmBookingUrl(
  origin: string,
  slug: string | null,
  opts?: { serviceKey?: string },
): string {
  const params = new URLSearchParams()
  if (slug) params.set('firm', slug)
  if (opts?.serviceKey) params.set('service', opts.serviceKey)
  const qs = params.toString()
  return `${origin}/book${qs ? `?${qs}` : ''}`
}

// The signed-in firm's public slug (from its booking rules — the same source the
// Settings "public booking link" uses). Null until loaded, or if the firm has no
// slug yet. Attorney context: the tenant comes from the session, never a literal.
export function useFirmPublicSlug(): string | null {
  const [slug, setSlug] = useState<string | null>(null)
  useEffect(() => {
    callAttorneyMcp<{ publicSlug: string | null }>({ toolName: 'legal.booking_rules.get' })
      .then((r) => setSlug(r.publicSlug))
      .catch(() => setSlug(null))
  }, [])
  return slug
}
