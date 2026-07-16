import { NextResponse, type NextRequest } from 'next/server'

// MULTI-TENANT-1 (Phase 1) — resolve WHICH firm a public funnel request is for,
// source-agnostically, at the edge. This runs in the Edge runtime, so it does NO
// database work: it only decides a firm SLUG from the request and injects it as the
// `x-firm-slug` request header. The Node-side helper resolvePublicTenant() turns that
// slug into a tenant id via the SECURITY DEFINER resolver. DNS is not wired yet, so
// the subdomain path is dormant until TENANT_BASE_DOMAIN is set; the ?firm= selector
// keeps the funnel testable on the bare Netlify host / localhost in the meantime.
//
// Slug precedence: firm subdomain of TENANT_BASE_DOMAIN  >  ?firm= query  >  firm_slug
// cookie. A ?firm= selection is persisted to a short-lived cookie so later navigations
// and the funnel's own /api/client/* calls (which drop the query) keep the same firm.
// No slug found ⇒ no header injected, and the Node helper falls back to the demoted env
// default. An incoming x-firm-slug is always cleared first, so only this middleware —
// never a forged request header — decides the slug.

// A firm slug is a single DNS label: lowercase alphanumerics + hyphens.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62})$/
// Persist a ?firm= selection for an hour so the bare-host funnel keeps its firm across
// the multi-step wizard without threading the query onto every fetch.
const FIRM_COOKIE = 'firm_slug'
const FIRM_COOKIE_MAX_AGE = 60 * 60

function sanitizeSlug(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().toLowerCase()
  return s && SLUG_RE.test(s) ? s : null
}

// The firm subdomain of the configured base domain, if any. Dormant (returns null)
// until TENANT_BASE_DOMAIN is set — so localhost / *.netlify.app never misparse.
// Only a single-label subdomain counts ('pacheco' in pacheco.instruments.legal);
// the apex and 'www' are not firms.
function slugFromHost(hostname: string): string | null {
  const base = (process.env.TENANT_BASE_DOMAIN ?? '').trim().toLowerCase()
  if (!base) return null
  const host = hostname.toLowerCase()
  if (host === base || !host.endsWith(`.${base}`)) return null
  const label = host.slice(0, host.length - base.length - 1)
  if (!label || label === 'www' || label.includes('.')) return null
  return sanitizeSlug(label)
}

export function middleware(request: NextRequest): NextResponse {
  const fromHost = slugFromHost(request.nextUrl.hostname)
  const fromQuery = sanitizeSlug(request.nextUrl.searchParams.get('firm'))
  const fromCookie = sanitizeSlug(request.cookies.get(FIRM_COOKIE)?.value)
  const slug = fromHost ?? fromQuery ?? fromCookie

  // Rebuild the request headers: strip any client-supplied x-firm-slug (only this
  // middleware may set it), then inject the resolved slug for the Node helper.
  const headers = new Headers(request.headers)
  headers.delete('x-firm-slug')
  if (slug) headers.set('x-firm-slug', slug)

  const response = NextResponse.next({ request: { headers } })

  // Persist an explicit ?firm= choice so the rest of the funnel stays on that firm.
  // A subdomain needs no cookie (the host carries it every request); the cookie is
  // purely the bare-host / preview fallback. Only refresh it when the query differs
  // from what's already stored, to keep the TTL sliding sensibly.
  if (fromQuery && fromQuery !== fromCookie) {
    response.cookies.set(FIRM_COOKIE, fromQuery, {
      path: '/',
      maxAge: FIRM_COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    })
  }
  return response
}

// Only the PUBLIC funnel: the booking page and the unauthenticated client API. The
// attorney and authed-portal surfaces resolve tenant from their session cookie and are
// deliberately untouched.
export const config = {
  matcher: ['/book', '/api/client/:path*'],
}
