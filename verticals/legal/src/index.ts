// Importing the handlers module registers all legal action handlers with the
// substrate's action handler registry. Consumers (MCP server, workers) import
// this package once at startup to wire the vertical.
import '@exsto/primitives' // registers the generic primitive handlers (event.record, raw_event.ingest, ...)
import './handlers/index.js'

export * from './api/index.js'
export * from './queries/index.js'
export * from './templates/loader.js'
export type { ClaudeDraftRequest, ClaudeDraftResult } from './adapters/claude.js'
export { resolveAnthropicApiKey } from './adapters/claude.js'
// Server-side credential store (Vault-backed) — exported for tests and ops
// tooling; never reachable from client bundles.
export {
  saveConnection,
  loadConnection,
  getConnectionInfo,
  listConnections,
  disconnect,
} from './adapters/connectionStore.js'
