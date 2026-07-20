// Single source of truth for the product's user-facing name.
//
// FB-C (de-Pacheco the app shell): this file used to hardcode a single firm's
// name (FIRM_NAME = 'Pacheco Law') into the product identity — wrong the
// moment a second tenant exists. PRODUCT_NAME is now the PRODUCT'S name only,
// never a firm's. Every surface that needs the CURRENT tenant's firm name
// resolves it live instead: authed pages via legal.settings.get
// (getTenantSettings/getFirmProfile), public/unauthenticated pages via
// legal.public.firm_branding (resolvePublicTenant). Neither falls back to a
// hardcoded firm literal — an unresolved name falls back to this tagline or
// generic wording ("the firm"), never a guess at whose name it is.
export const PRODUCT_TAGLINE = 'Legal Instruments'
export const PRODUCT_STAGE = 'beta'
export const PRODUCT_NAME = `${PRODUCT_TAGLINE} (${PRODUCT_STAGE})`
