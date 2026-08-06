// FIRM-LANDING-2 — the public, client-safe content of a firm's landing page
// ({slug}.instruments.legal root). ONE read composes everything the page
// renders: the firm's public identity (name, tagline, about, brand color),
// the contact fields the firm has set, and the same bookable-services list the
// /book funnel offers (listServices — active + authored lifecycle only).
//
// PUBLIC-SAFE BY CONSTRUCTION: toPublicFirmSite maps EXPLICITLY from the
// resolved settings/services to a closed output shape — private settings
// (rates, assistant instructions, jurisdiction internals, integrations) can
// never leak by omission of a filter, because nothing is spread through.
// Resolution fails closed: an unknown slug returns null (the page 404s), and
// a mis-provisioned tenant (no public-intake actor) throws rather than
// rendering under the wrong identity — same posture as the /book front door.
import type { ActionContext } from '@exsto/substrate'
import { resolvePublicFirm, resolvePublicIntakeActor } from './publicBooking.js'
import { getTenantSettings, type TenantSettings } from './tenantSettings.js'
import { listServices, type ServiceDefinition } from './services.js'
import { getInvoiceTemplate } from './invoiceTemplate.js'

// One service tile on the public landing page: display copy only — never the
// intake schema, cost config, or lifecycle internals.
export interface PublicSiteService {
  serviceKey: string
  title: string
  description: string | null
}

export interface PublicFirmSite {
  slug: string
  firmName: string
  tagline: string | null
  about: string | null
  attorneyName: string | null
  // Server-validated #rrggbb (handlers/firmProfile.ts) — a display color only.
  headerColor: string | null
  // COMP-RESTYLE-1 — the firm's uploaded logo (the invoice-template logo, the
  // one place firm art is uploaded — 0196's posture). A data: URL or null; the
  // landing/funnel/sign-in render it at fixed heights when set and fall back
  // to the generated mark + firm name when not.
  logoDataUrl: string | null
  // Only the contact fields the firm has SET render publicly; the landing page
  // hides the block entirely when all three are null.
  contact: {
    phone: string | null
    email: string | null
    address: string | null
  }
  services: PublicSiteService[]
}

// The landing page's service tiles: bookable services only (same gate as the
// /book picker — active AND authored lifecycle), preferring the client-facing
// copy the same way the funnel's tiles do (clientDisplayName/clientDescription
// win; attorney-facing displayName/description are the never-blank fallback).
export function toPublicSiteServices(services: ServiceDefinition[]): PublicSiteService[] {
  return services
    .filter((s) => s.bookable === true)
    .map((s) => ({
      serviceKey: s.serviceKey,
      title: s.clientDisplayName?.trim() ? s.clientDisplayName : s.displayName,
      description: s.clientDescription?.trim() ? s.clientDescription : s.description,
    }))
}

// PURE composition (unit-tested): resolved settings + services → the closed
// public shape. `firmName` prefers the profile value (what the funnel's
// firm_branding shows) and falls back to the slug resolver's answer (the
// tenant row's firm_name — always present for a resolvable firm).
export function toPublicFirmSite(args: {
  slug: string
  resolvedFirmName: string
  settings: TenantSettings
  services: ServiceDefinition[]
  logoDataUrl?: string | null
}): PublicFirmSite {
  const { slug, resolvedFirmName, settings, services } = args
  return {
    slug,
    firmName: settings.firmName ?? resolvedFirmName,
    tagline: settings.tagline,
    about: settings.about,
    attorneyName: settings.attorneyName,
    headerColor: settings.headerColor,
    logoDataUrl: args.logoDataUrl ?? null,
    contact: {
      phone: settings.firmPhone,
      email: settings.firmEmail,
      address: settings.firmAddress,
    },
    services: toPublicSiteServices(services),
  }
}

// The one read the root page calls. Fail closed: unknown/invalid slug → null.
export async function getPublicFirmSite(slug: string): Promise<PublicFirmSite | null> {
  const firm = await resolvePublicFirm(slug)
  if (!firm) return null
  // Reads run as the tenant's OWN public-intake system actor (ADR 0035), the
  // same attribution as every other public surface for this firm.
  const ctx: ActionContext = {
    tenantId: firm.tenantId,
    actorId: await resolvePublicIntakeActor(firm.tenantId),
  }
  const [settings, services, invoiceTemplate] = await Promise.all([
    getTenantSettings(ctx),
    listServices(ctx),
    getInvoiceTemplate(ctx),
  ])
  return toPublicFirmSite({
    slug,
    resolvedFirmName: firm.firmName,
    settings,
    services,
    logoDataUrl: invoiceTemplate.logoDataUrl,
  })
}
