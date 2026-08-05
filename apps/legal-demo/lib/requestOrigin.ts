// ORIGIN-1 rule 2 — the origin for redirects WITHIN a request flow (login/logout/
// bridge responses). These must stay on the host the user is currently on: session
// cookies are host-only, so a cross-host redirect right after Set-Cookie would strand
// the cookie on a host the user just left.
//
// Why not request.url? On Netlify, Next.js receives request.url with the platform's
// internal port baked in (the old google/callback workaround hardcoded the base for
// exactly that reason). The forwarded HOST header is reliable; the port is not — so we
// read the host and force https ourselves.
//
// Hostile Host headers cannot mint arbitrary origins: anything that isn't the canonical
// host, a *.netlify.app host (legacy/previews), localhost, or a valid firm label under
// TENANT_BASE_DOMAIN falls back to the canonical base URL.

import { appBaseUrl, tenantBaseDomain } from '@exsto/legal'

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62})$/

function isAllowedHost(host: string): boolean {
  if (host === 'localhost' || host.startsWith('localhost:')) return true
  if (host.endsWith('.netlify.app')) return true
  try {
    if (host === new URL(appBaseUrl()).host) return true
  } catch {
    // unparseable canonical base — fall through to the remaining checks
  }
  const base = tenantBaseDomain()
  if (base) {
    if (host === base) return true
    if (host.endsWith(`.${base}`)) {
      const label = host.slice(0, host.length - base.length - 1)
      return !label.includes('.') && SLUG_RE.test(label)
    }
  }
  return false
}

export function requestOrigin(request: Request): string {
  const raw = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? ''
  const host = raw.split(',')[0].trim().toLowerCase()
  if (!host || !isAllowedHost(host)) return appBaseUrl()
  const proto = host.startsWith('localhost') ? 'http' : 'https'
  return `${proto}://${host}`
}
