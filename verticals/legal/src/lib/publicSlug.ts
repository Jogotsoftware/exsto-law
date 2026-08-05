// SLUG-PROV-1 — the ONE definition of what a valid firm public slug is, shared by
// every layer that must agree: the Edge middleware (host label → slug), the
// control-plane write path (cp_set_tenant_slug wrapper), and the admin console's
// client-side validation. The SQL function re-encodes the same rules (defense in
// depth — SQL can't import this module), so a change here must also update
// migration 0197_cp_set_tenant_slug.sql.
//
// Deliberately dependency-free and DB-free: middleware.ts runs in the Edge runtime
// and must be able to import this without dragging in pg or node builtins.

// A single DNS label, 1–63 chars, lowercase alphanumerics + hyphens, no leading or
// TRAILING hyphen (tighter than the historical middleware regex, which allowed a
// trailing hyphen browsers/DNS tolerate but registrars reject).
export const PUBLIC_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

// Labels that can never be a firm: infrastructure hosts (www, mail, dns), the
// canonical app host (app) and auth/product surfaces we may ever want as shared
// subdomains, plus brand terms. A firm slug colliding with any of these would
// either shadow a real endpoint or be confusingly official.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www',
  'app',
  'api',
  'admin',
  'login',
  'signin',
  'signup',
  'auth',
  'mail',
  'smtp',
  'imap',
  'pop',
  'mx',
  'webmail',
  'ns1',
  'ns2',
  'autodiscover',
  'autoconfig',
  'dev',
  'staging',
  'test',
  'demo',
  'sandbox',
  'preview',
  'portal',
  'book',
  'sign',
  'docs',
  'help',
  'support',
  'status',
  'blog',
  'cdn',
  'static',
  'assets',
  'dashboard',
  'console',
  'internal',
  'billing',
  'pay',
  'exsto',
  'instruments',
  'legal',
])

export type SlugValidation = { ok: true; slug: string } | { ok: false; error: string }

// Normalize + validate a proposed slug. Returns the canonical (lowercased, trimmed)
// form on success so callers never persist a differently-cased duplicate.
export function validatePublicSlug(raw: string): SlugValidation {
  const slug = (raw ?? '').trim().toLowerCase()
  if (!slug) return { ok: false, error: 'Subdomain is required.' }
  if (slug.length > 63) return { ok: false, error: 'Subdomain must be 63 characters or fewer.' }
  if (!PUBLIC_SLUG_RE.test(slug)) {
    return {
      ok: false,
      error:
        'Subdomain may contain only lowercase letters, numbers and hyphens, and must start and end with a letter or number.',
    }
  }
  if (RESERVED_SLUGS.has(slug)) return { ok: false, error: `"${slug}" is reserved.` }
  return { ok: true, slug }
}
