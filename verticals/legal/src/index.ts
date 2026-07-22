// Importing the handlers module registers all legal action handlers with the
// substrate's action handler registry. Consumers (MCP server, workers) import
// this package once at startup to wire the vertical.
import '@exsto/primitives' // registers the generic primitive handlers (event.record, raw_event.ingest, ...)
import './handlers/index.js'
// legal.matter.advance's GUARD 2 rejection — exported so an HTTP adapter can map
// it to a 4xx instead of the generic 500 every other thrown handler error gets.
export { WorkflowAdvanceGuardError } from './handlers/workflow.js'
export { buildClientContactAttrs } from './handlers/intake.js'

export * from './api/index.js'
// ESIGN-UNIFY-1 ES-2 — executed-copy stamping (server-only: pdf-lib) plus the
// placement bridge/data/geometry helpers for server callers (the render route,
// the completion path, tests). Client components import the pure surface from
// '@exsto/legal/esign' (executionBlock.ts) instead — stampPdf must never reach
// a client bundle.
export {
  stampExecutedPdf,
  placementsToStampFields,
  type StampField,
  type StampInput,
} from './esign/stampPdf.js'
export { buildCertificateTextLines } from './esign/fileCertificate.js'
export { deriveMarkerMap, markerMapToPlacements, type MarkerMapEntry } from './esign/markerMap.js'
export {
  resolvePlacementData,
  ALLOWED_MATTER_KEYS,
  type PlacementRecipient,
  type PlacementContactFacts,
  type ResolvePlacementDataInput,
} from './esign/placementData.js'
export {
  parseEnvelopePlacements,
  denormalizeRect,
  normalizeRect,
  clampRect,
  defaultRectForType,
  DEFAULT_FIELD_POINTS,
  LETTER_POINTS,
  type PlacementRect,
  type PlacementAnchor,
} from './esign/placements.js'
export * from './queries/index.js'
export * from './templates/loader.js'
// Shared document-formatting standard injected into every generation path
// (draft/revise/template-AI/propose_template). Pure policy, no IO.
export { DOCUMENT_STYLE_INSTRUCTION, DOCUMENT_STYLE_BRIEF } from './templates/documentStyle.js'
// Platform control plane (ADR 0046) — cross-tenant operations behind guarded
// private.cp_* functions; the admin console's operation core.
export * from './controlPlane/index.js'
// Matter lifecycle engine (ADR 0045) — read-only resolver + derivation. Shadow in
// PR2 (nothing reads workflow_definition.states yet).
export * from './lifecycle/index.js'
// Contract H — deterministic template merge (WP2.5). `renderTemplate` +
// `RenderResult` are exported by api/templateMerge (the wired draft.merge render),
// so re-export only this module's editor utilities here to avoid the duplicate
// root-export ambiguity (TS2308). The editor imports render() from this module
// directly, so it's unaffected.
export {
  extractInputTokens,
  extractIncludeKeys,
  humanizeToken,
  questionnaireFromTemplate,
  type RenderOptions,
} from './lib/templates/render.js'
// AI-CONTEXT C1 — the central model router (pure policy: which Claude/
// Perplexity model an AI task runs on). Named exports only (not `export *`):
// AUTO_MODEL_ID/AUTO_MODEL_HAIKU_ID/AUTO_MODEL_SONNET_ID/chooseAutoModel are
// ALSO reachable via api/assistantModels.js's re-export of this same module —
// a plain `export *` here would re-surface those names a second time. Since
// both point at the identical original binding that's not an error, but it's
// needless duplication; list only what assistantModels.js doesn't already
// forward.
export type { AiTask, ModelTier, RouteSignals, ResolvedModel } from './lib/modelRouter.js'
export {
  TIER_MODEL,
  resolveModelForTask,
  resolveConcreteAssistantModelId,
  tierForModel,
} from './lib/modelRouter.js'
// AI-CONTEXT C3 — the pre-flight token-budget guard (pure policy, see the
// module header in lib/tokenGuard.ts). estimateTokens/INPUT_CEILING_BY_TIER
// are exported for tests and for any future caller that needs the raw
// estimate/ceiling without going through the full chat-turn guard.
export type { HistoryTurn, ChatBudgetParts, ChatBudgetResult } from './lib/tokenGuard.js'
export {
  estimateTokens,
  INPUT_CEILING_BY_TIER,
  guardChatBudget,
  assertDraftBudget,
  DraftBudgetExceededError,
  SCREEN_BEGIN,
  SCREEN_END,
} from './lib/tokenGuard.js'
export type { ClaudeDraftRequest, ClaudeDraftResult, ClientTool } from './adapters/claude.js'
export {
  resolveAnthropicApiKey,
  clientToolUses,
  runClientTools,
  buildChatRequest,
  workRateParams,
  stripThinkingBlocks,
  isRetryableAnthropicError,
  retryDelayMs,
  withTransientRetry,
  humanizeAnthropicError,
  extractApiErrorMessage,
} from './adapters/claude.js'
export { resolvePerplexityApiKey } from './adapters/perplexity.js'
export type { ResearchRequest, ResearchResult } from './adapters/perplexity.js'
export { redactSecret } from './adapters/redact.js'
export { sanitizeEmailHtml } from './adapters/sanitizeEmailHtml.js'
export { signOAuthState, verifyOAuthState } from './adapters/oauthState.js'
// Stripe adapter — payments config flags + webhook signature verify/interpret.
// The API surface (api/payments.ts) is exported via api/index; these helpers are
// exported for tests and the webhook plumbing.
export {
  isStripeConfigured,
  stripePublishableKey,
  constructWebhookEvent,
  interpretWebhookEvent,
  StripeNotConfiguredError,
  type NormalizedStripeEvent,
} from './adapters/stripe.js'
// Server-side credential store (Vault-backed) — exported for tests and ops
// tooling; never reachable from client bundles.
export {
  saveConnection,
  loadConnection,
  getConnectionInfo,
  listConnections,
  disconnect,
  resolveFirmPrimaryActor,
  isPerActorProvider,
} from './adapters/connectionStore.js'
// Contract A — the integration spine (provider credentials + connection status).
// FROZEN public surface imported by the comms (S3) and e-sign (S5) sessions.
export { getProviderCredential, getConnectionStatus } from './adapters/providerCredentials.js'
// Google capability probe + the scopes a connect must come back granted (WP1.1).
export {
  probeGoogleCapabilities,
  REQUIRED_CONNECT_SCOPES,
  GMAIL_MODIFY_SCOPE,
  CALENDAR_FULL_SCOPE,
} from './adapters/googleCalendar.js'
export type {
  CredentialProvider,
  GoogleCredential,
  ApiKeyCredential,
  GranolaCredential,
  ProviderCredential,
  ConnectionStatusResult,
} from './adapters/providerCredentials.js'
// Server-side markdown → PDF renderer for emailing a generated draft as a PDF
// attachment (no headless browser; @react-pdf/renderer). Pure + deterministic.
export { renderDraftPdf } from './render/draftPdf.js'
