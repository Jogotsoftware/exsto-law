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
//   2. No slug at all → the DEMOTED env default (LEGAL_CLIENT_TENANT_ID, dev tenant).
//      Kept only so the bare host pre-DNS still resolves and nothing 500s; a request
//      that named a firm never lands here.
//
// The per-tenant intake ACTOR is resolved the same way the /book/{slug} front door does
// (resolvePublicIntakeActor) — tenant zero's …0005 FK-fails for any other tenant.

// Demoted last-resort default. NOT deleted this phase (Phase 2 removes it once every
// public entry carries a firm). Only reached when no slug was supplied at all.
const DEFAULT_TENANT_ID =
  process.env.LEGAL_CLIENT_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'

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

// A named firm did not resolve. Routes map this to a clear "firm not found" response
// (never a dev-tenant write) — see A3.
export class FirmNotFoundError extends Error {
  constructor(public readonly slug: string) {
    super(`Unknown firm: ${slug}`)
    this.name = 'FirmNotFoundError'
  }
}

export async function resolvePublicTenant(request: Request): Promise<PublicTenant> {
  const slug = (request.headers.get(FIRM_SLUG_HEADER) ?? '').trim().toLowerCase() || null

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

  // No firm named anywhere → demoted env default (Phase 1 no-regression on the bare host).
  return {
    tenantId: DEFAULT_TENANT_ID,
    actorId: await resolvePublicIntakeActor(DEFAULT_TENANT_ID),
    firmName: null,
    slug: null,
  }
}
