import { resolvePublicFirm, resolvePublicIntakeActor } from '@exsto/legal'

// MULTI-TENANT-1 (Phase 1) — the ONE server-side resolver for "which firm is this
// PUBLIC funnel request for?". Every public seam (client MCP route + the three intake
// routes) calls this instead of a module-level hardcoded tenant const, so a booking
// made under firm X writes to firm X's tenant with firm X's public-intake actor.
//
// Precedence (the slug itself is decided at the edge by middleware.ts, which parses
// host / ?firm= / cookie into the x-firm-slug header — no DB at the edge):
//   1. x-firm-slug header present → resolve it through public.resolve_public_firm
//      (SECURITY DEFINER, migration 0119). Unknown slug ⇒ FAIL CLOSED (throw), never a
//      silent fall-through to dev.
//   2. No slug at all → FAIL CLOSED too (SECOND-FIRM-1). The old demoted env default
//      (DEFAULT_TENANT_ID → the Dev Firm) is GONE: a slug-less public request on the
//      legacy host used to silently land its writes in the dev tenant — wrong the
//      moment a real second firm exists. Old booking links keep working because they
//      carry ?firm= (buildFirmBookingUrl); firm subdomains carry the slug in the host.
//
// The per-tenant intake ACTOR is resolved the same way the /book/{slug} front door does
// (resolvePublicIntakeActor) — tenant zero's …0005 FK-fails for any other tenant.

const FIRM_SLUG_HEADER = 'x-firm-slug'

export interface PublicTenant {
  tenantId: string
  // The tenant's own public-intake system actor (writes are attributed to it).
  actorId: string
  // The resolved firm's public name, when a firm was resolved from a slug; null on
  // the env-default path (the branding read tool reads the name from the tenant).
  firmName: string | null
  // The slug that resolved the firm, or null on the env-default path.
  slug: string | null
}

// A named firm did not resolve — or no firm was named at all. Routes map this to a
// clear "firm not found" response (never a dev-tenant write) — see A3.
export class FirmNotFoundError extends Error {
  constructor(
    public readonly slug: string,
    message?: string,
  ) {
    super(message ?? `Unknown firm: ${slug}`)
    this.name = 'FirmNotFoundError'
  }
}

export async function resolvePublicTenant(request: Request): Promise<PublicTenant> {
  const slug = (request.headers.get(FIRM_SLUG_HEADER) ?? '').trim().toLowerCase() || null
  const fromFirmHost = request.headers.get('x-firm-host') === '1'

  if (slug) {
    const firm = await resolvePublicFirm(slug)
    if (!firm) throw new FirmNotFoundError(slug) // fail closed — no silent dev fallback
    return {
      tenantId: firm.tenantId,
      actorId: await resolvePublicIntakeActor(firm.tenantId),
      firmName: firm.firmName,
      slug,
    }
  }

  // HOST-TENANCY-1 belt-and-suspenders: a firm HOST with no resolvable slug must
  // never fall through — middleware always sets both headers together, so this is
  // unreachable unless something upstream broke. Fail closed.
  if (fromFirmHost) throw new FirmNotFoundError('(firm host without slug)')

  // SECOND-FIRM-1: no firm named anywhere (legacy host, no ?firm=, no cookie) —
  // FAIL CLOSED with actionable copy instead of silently landing on the Dev Firm.
  throw new FirmNotFoundError(
    '(no firm specified)',
    'No firm was specified. Use your firm’s own link — its subdomain, or a link carrying ?firm=<your-firm> — to reach this page.',
  )
}
