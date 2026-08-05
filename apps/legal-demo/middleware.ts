import { NextResponse, type NextRequest } from 'next/server'
import { PUBLIC_SLUG_RE, RESERVED_SLUGS } from '@exsto/legal/slug'

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

// A firm slug is a single DNS label — SLUG-PROV-1: the shared definition in
// @exsto/legal/slug (dependency-free, Edge-safe) so middleware, the control-plane
// write path, and the SQL validator can never disagree.
const SLUG_RE = PUBLIC_SLUG_RE
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
// the apex and 'www' are not firms. Exported for the unit test — Next only
// reads the `middleware`/`config` exports, so this is invisible to routing.
export function slugFromHost(hostname: string): string | null {
  const base = (process.env.TENANT_BASE_DOMAIN ?? '').trim().toLowerCase()
  if (!base) return null
  const host = hostname.toLowerCase()
  if (host === base || !host.endsWith(`.${base}`)) return null
  const label = host.slice(0, host.length - base.length - 1)
  if (!label || label.includes('.')) return null
  // Reserved labels (www, app, api, admin, …) are infrastructure/product hosts,
  // never firms — the canonical app host itself must resolve slug-less.
  if (RESERVED_SLUGS.has(label)) return null
  return sanitizeSlug(label)
}

export function middleware(request: NextRequest): NextResponse {
  const fromHost = slugFromHost(request.nextUrl.hostname)

  // Rebuild the request headers: strip any client-supplied x-firm-slug/x-firm-host
  // (only this middleware may set them), then inject the resolved slug for the Node
  // helpers.
  const headers = new Headers(request.headers)
  headers.delete('x-firm-slug')
  headers.delete('x-firm-host')

  // HOST-TENANCY-1: on a firm subdomain the HOST is the single source of truth.
  // ?firm= and the cookie are ignored entirely — a stale selector must never move
  // a request off the firm the user is literally standing on. x-firm-host lets
  // Node code distinguish "slug came from the host" (authoritative; unknown slug
  // must 404, session mismatch must fail closed) from "slug came from a query/
  // cookie fallback" (legacy hosts only).
  if (fromHost) {
    headers.set('x-firm-slug', fromHost)
    headers.set('x-firm-host', '1')
    return NextResponse.next({ request: { headers } })
  }

  // Legacy hosts (netlify.app, localhost, previews): the historical ?firm= >
  // cookie precedence, unchanged, so old booking links keep working.
  const fromQuery = sanitizeSlug(request.nextUrl.searchParams.get('firm'))
  const fromCookie = sanitizeSlug(request.cookies.get(FIRM_COOKIE)?.value)
  const slug = fromQuery ?? fromCookie
  if (slug) headers.set('x-firm-slug', slug)

  const response = NextResponse.next({ request: { headers } })

  // Persist an explicit ?firm= choice so the rest of the funnel stays on that firm.
  // Only refresh it when the query differs from what's already stored, to keep the
  // TTL sliding sensibly. Never set on firm hosts (the host carries the firm).
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

// HOST-TENANCY-1: every route except static assets. The firm slug must reach ALL
// surfaces on a firm host — the landing page at /, the authed portal/attorney
// layouts (which VALIDATE session-vs-host, see lib/hostTenantGuard.ts), /sign/*,
// /d/*, and the public funnel. The middleware itself stays cheap and DB-free, so
// running on every request costs a header rewrite, nothing more. Session-cookie
// tenancy is still decided by the session readers — x-firm-slug never authorizes.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|ico|css|js|map|txt|webp|woff2?)$).*)',
  ],
}
