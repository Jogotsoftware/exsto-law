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
// ES-MULTIDOC-1 — one envelope, many documents: placement↔document grouping.
export {
  placementDocIndex,
  placementsForDoc,
  groupPlacementsByDoc,
  maxPlacementDocIndex,
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
// ESIGN-UNIFY-1 (ES-2) — placement geometry helpers (§4/§5.2).
export {
  DEFAULT_FIELD_POINTS,
  LETTER_POINTS,
  clamp01,
  clampRect,
  normalizeRect,
  denormalizeRect,
  defaultRectForType,
} from './placements.js'
// ES-2 (§5.2) — the anchor→rect bridge for drafts (marker map).
export { deriveMarkerMap, markerMapToPlacements, type MarkerMapEntry } from './markerMap.js'
// ES-2 (§5.3) — send-time data auto-fill for placements.
export {
  resolvePlacementData,
  ALLOWED_MATTER_KEYS,
  type PlacementRecipient,
  type PlacementContactFacts,
  type ResolvePlacementDataInput,
} from './placementData.js'
// ES-2 (§5.4) — executed-copy stamping (pdf-lib) for file envelopes.
export {
  stampExecutedPdf,
  placementsToStampFields,
  type StampField,
  type StampInput,
} from './stampPdf.js'
export { buildCertificateTextLines } from './fileCertificate.js'
