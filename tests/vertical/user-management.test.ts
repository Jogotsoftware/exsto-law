// S9 WP9.3 — user-management wiring (pure, no DB). Proves the legal.user.*
// surface is actually registered through the operation core: action handlers in
// the substrate registry (so submitAction routes to them, not a silent no-op —
// invariant 9) and MCP tools in the shared registry with the right read/write
// modes. The live "takes effect" behaviour (RLS gate + role ladder) is covered
// by the DB-gated tests/invariants/rbac-enforcement.test.ts; this guards the
// wiring + the rank hierarchy on every CI run without a database.
import { describe, it, expect } from 'vitest'
import { hasActionHandler } from '@exsto/substrate'
import '@exsto/legal' // registers core + legal action handlers (side effect)
import '@exsto/legal/mcp' // registers the legal MCP tools (side effect)
import { findTool } from '@exsto/mcp-tools'
import { ROLE_RANK, rankOfScopes, canManage } from '@exsto/legal'

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

describe('S9 role-ladder rank hierarchy (pure)', () => {
  it('orders the ladder super_admin > admin > attorney > paralegal', () => {
    expect(ROLE_RANK['firm.super_admin']).toBeGreaterThan(ROLE_RANK['firm.admin'])
    expect(ROLE_RANK['firm.admin']).toBeGreaterThan(ROLE_RANK['firm.attorney'])
    expect(ROLE_RANK['firm.attorney']).toBeGreaterThan(ROLE_RANK['firm.paralegal'])
  })

  it('rankOfScopes takes the highest scope and treats unknown/empty as 0', () => {
    expect(rankOfScopes(['firm.paralegal', 'firm.admin'])).toBe(ROLE_RANK['firm.admin'])
    expect(rankOfScopes(['something.custom'])).toBe(0)
    expect(rankOfScopes([])).toBe(0)
  })

  it('canManage: must strictly out-rank both the target and the granted role', () => {
    const sa = ROLE_RANK['firm.super_admin']
    const ad = ROLE_RANK['firm.admin']
    const at = ROLE_RANK['firm.attorney']
    const pa = ROLE_RANK['firm.paralegal']
    // super_admin manages an admin, can grant attorney
    expect(canManage(sa, ad, at)).toBe(true)
    // admin manages a paralegal, can grant attorney
    expect(canManage(ad, pa, at)).toBe(true)
    // admin may NOT touch another admin (no strict out-rank of the target)
    expect(canManage(ad, ad, pa)).toBe(false)
    // admin may NOT grant an admin (no strict out-rank of the role)
    expect(canManage(ad, pa, ad)).toBe(false)
    // no one mints a peer at their own rank
    expect(canManage(sa, pa, sa)).toBe(false)
  })
})
