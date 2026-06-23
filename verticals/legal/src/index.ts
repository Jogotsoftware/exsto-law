// Importing the handlers module registers all legal action handlers with the
// substrate's action handler registry. Consumers (MCP server, workers) import
// this package once at startup to wire the vertical.
import '@exsto/primitives' // registers the generic primitive handlers (event.record, raw_event.ingest, ...)
import './handlers/index.js'

export * from './api/index.js'
export * from './queries/index.js'
export * from './templates/loader.js'
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
export type { ClaudeDraftRequest, ClaudeDraftResult, ClientTool } from './adapters/claude.js'
export {
  resolveAnthropicApiKey,
  clientToolUses,
  runClientTools,
  buildChatRequest,
  stripThinkingBlocks,
} from './adapters/claude.js'
export { resolvePerplexityApiKey } from './adapters/perplexity.js'
export type { ResearchRequest, ResearchResult } from './adapters/perplexity.js'
export { redactSecret } from './adapters/redact.js'
export { sanitizeEmailHtml } from './adapters/sanitizeEmailHtml.js'
export { signOAuthState, verifyOAuthState } from './adapters/oauthState.js'
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
