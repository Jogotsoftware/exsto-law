// FIRM-BRANDING-1 — the firm's visual identity, in ONE place.
//
// Before this, "the firm's logo" lived inside the INVOICE TEMPLATE config
// (invoice_template_config.logoDataUrl) and every other surface that wanted it —
// the attorney top bar, and now the client portal, the booking funnel, the
// public landing page, the signing pages — had to reach into a document
// template to find firm identity. The logo is a FIRM fact that the invoice
// consumes, not an invoice fact the console borrows. It now lives on the
// firm_profile singleton next to firm_header_color (migration 0202), written
// through the same legal.firm.set_profile action as every other profile field,
// and Settings → Firm Details is the one place it is uploaded.
//
// LEGACY FALLBACK, NOT A BACKFILL. Firms that uploaded a logo before 0202
// (Pacheco) keep it: when firm_logo has NEVER been set, the stored invoice
// template's logoDataUrl stands in. An EXPLICIT clear (a firm_logo row holding
// '') resolves to null and does NOT resurrect the old invoice logo — otherwise
// "remove logo" could never take. No history is rewritten either way.
import type { ActionContext } from '@exsto/substrate'
import { getTenantSettings, readFirmLogo } from './tenantSettings.js'
import { readStoredInvoiceTemplate } from './invoiceTemplate.js'

export interface FirmBranding {
  firmName: string | null
  // Server-validated #rrggbb (handlers/firmProfile.ts) — null means the
  // product's standard navy chrome.
  headerColor: string | null
  // An image data URL, or null for "no logo" (crest / wordmark fallback).
  logoDataUrl: string | null
  // 'light' = reversed artwork (needs a dark backdrop on light surfaces);
  // 'dark' = made for paper (needs a light chip on dark chrome); null = unknown,
  // which every surface renders bare.
  logoTone: 'light' | 'dark' | null
}

// The firm's logo, resolved: the firm-level value first, the legacy invoice
// template logo only where the firm-level one has never been set.
export async function getFirmLogo(ctx: ActionContext): Promise<string | null> {
  const own = await readFirmLogo(ctx)
  if (own !== undefined) return own // set, or explicitly cleared
  const legacy = await readStoredInvoiceTemplate(ctx)
  const fromTemplate = legacy?.logoDataUrl
  return typeof fromTemplate === 'string' && fromTemplate.trim() ? fromTemplate : null
}

// Everything the chrome of one firm's surfaces needs, in one read. Client-safe
// by construction: name + display color + logo, nothing else.
export async function getFirmBranding(ctx: ActionContext): Promise<FirmBranding> {
  const [settings, logoDataUrl] = await Promise.all([getTenantSettings(ctx), getFirmLogo(ctx)])
  return {
    firmName: settings.firmName,
    headerColor: settings.headerColor,
    logoDataUrl,
    logoTone: settings.logoTone,
  }
}
