// Importing the handlers module registers all legal action handlers with the
// substrate's action handler registry. Consumers (MCP server, workers) import
// this package once at startup to wire the vertical.
import '@exsto/primitives' // registers the generic primitive handlers (event.record, raw_event.ingest, ...)
import './handlers/index.js'

export * from './api/index.js'
export * from './queries/index.js'
export * from './templates/loader.js'
// Contract H — deterministic template merge (WP2.5).
export * from './lib/templates/render.js'
export type { ClaudeDraftRequest, ClaudeDraftResult } from './adapters/claude.js'
export { resolveAnthropicApiKey } from './adapters/claude.js'
export { resolvePerplexityApiKey } from './adapters/perplexity.js'
export type { ResearchRequest, ResearchResult } from './adapters/perplexity.js'
export { redactSecret } from './adapters/redact.js'
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
