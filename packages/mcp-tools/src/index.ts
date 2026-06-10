export * from './tool.js'

// Generic, vertical-agnostic substrate tools. This package is the shared MCP
// adapter over the operation core and stays vertical-agnostic: it registers ONLY
// the generic substrate tools. Vertical tool sets (e.g. the legal surface) live in
// their own package and register into the same `@exsto/mcp-tools` registry — a
// consumer side-effect-imports them (e.g. `import '@exsto/legal/mcp'`). See
// ADR 0024/0038 (one core; generic adapter + per-vertical tool modules).
import './tools/substrateTools.js'
