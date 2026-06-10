// Importing the handlers module registers all legal action handlers with the
// substrate's action handler registry. Consumers (MCP server, workers) import
// this package once at startup to wire the vertical.
import './handlers/index.js'

export * from './api/index.js'
export * from './queries/index.js'
export * from './templates/loader.js'
export type { ClaudeDraftRequest, ClaudeDraftResult } from './adapters/claude.js'
