// Single source of truth for the product's user-facing name.
//
// Why two names: the "(beta)" product identity (PRODUCT_NAME) brands the
// internal attorney console — the browser tab, the sidebar crest. Client-facing
// artifacts (emails to clients, the public draft/portal views) carry the firm
// name alone (FIRM_NAME); a real client's inbox should never see an internal
// "(beta)" label. Keep both reading from here so the name propagates from one place.
export const FIRM_NAME = 'Pacheco Law'
export const PRODUCT_TAGLINE = 'Legal Instruments'
export const PRODUCT_STAGE = 'beta'
export const PRODUCT_NAME = `${FIRM_NAME} — ${PRODUCT_TAGLINE} (${PRODUCT_STAGE})`
