// The platform control-plane operation core (ADR 0046). Cross-tenant reads + the
// tenant lifecycle go through guarded private.cp_* functions; per-tenant config
// operations impersonate the target via submitAction. Every adapter (the /admin
// MCP route today, REST tomorrow) reaches the control plane through here.
export * from './context.js'
export * from './tenants.js'
export * from './modules.js'
export * from './promotion.js'
export * from './templatePromotion.js'
export * from './access.js'
