// S9 WP9.3 — user-management wiring (pure, no DB). Proves the legal.user.*
// surface is actually registered through the operation core: action handlers in
// the substrate registry (so submitAction routes to them, not a silent no-op —
// invariant 9) and MCP tools in the shared registry with the right read/write
// modes. The live "takes effect" behaviour is covered by the DB-gated through-
// core receipt (scripts/s9-user-mgmt-receipt.mjs) and the WP9.2 enforcement
// receipt; this guards the wiring on every CI run without a database.
import { describe, it, expect } from 'vitest'
import { hasActionHandler } from '@exsto/substrate'
import '@exsto/legal' // registers core + legal action handlers (side effect)
import '@exsto/legal/mcp' // registers the legal MCP tools (side effect)
import { findTool } from '@exsto/mcp-tools'

describe('S9 WP9.3 user-management wiring (no DB)', () => {
  it('registers the legal.user.* action handlers so submitAction routes to them', () => {
    const missing = ['legal.user.invite', 'legal.user.assign_role', 'legal.user.deactivate'].filter(
      (k) => !hasActionHandler(k),
    )
    expect(missing).toEqual([])
  })

  it('registers the legal.user.* MCP tools with the correct modes', () => {
    expect(findTool('legal.user.me')?.mode).toBe('read')
    expect(findTool('legal.user.list')?.mode).toBe('read')
    expect(findTool('legal.user.invite')?.mode).toBe('write')
    expect(findTool('legal.user.assign_role')?.mode).toBe('write')
    expect(findTool('legal.user.deactivate')?.mode).toBe('write')
  })
})
