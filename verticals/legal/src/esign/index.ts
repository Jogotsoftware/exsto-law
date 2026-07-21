// Provider-agnostic e-sign adapter surface (Session 5, WP5.1).
export * from './types.js'
export { getEsignDriver, registerEsignDriver, DEFAULT_ESIGN_PROVIDER } from './registry.js'
export { signSigningToken, verifySigningToken, type SigningTokenPayload } from './signingToken.js'
// ESIGN-UNIFY-1 (ES-1) — the coordinate placement storage model (§5.1).
export {
  parseEnvelopePlacements,
  serializeEnvelopePlacements,
  isPlacementFieldType,
  PLACEMENT_FIELD_TYPES,
  type FieldPlacement,
  type PlacementFieldType,
  type PlacementAnchor,
  type PlacementRect,
} from './placements.js'
// ESIGN-UNIFY-1 (ES-1) — pure role-aware routing decisions (§9.2).
export {
  normalizeRole,
  planInitialDispatch,
  planNextDelivery,
  copyRecipients,
  type SignerRole,
  type RoutingRequestState,
  type NextDeliveryPlan,
} from './routing.js'
