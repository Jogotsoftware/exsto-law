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
import { rankOfScopes, canManage } from '@exsto/legal'

// The seeded ladder ranks — a mirror of permission_scope_definition.rank, which
// private.provision_firm_rbac seeds per tenant (migration 0078). The DB is the
// source of truth (the rank-ceiling RLS reads that column); these pure tests
// exercise the ranking HELPERS against a representative map. The live "the seed
// actually ranks this way and bites" check is the DB-gated rbac-enforcement test.
const LADDER: Record<string, number> = {
  'firm.super_admin': 100,
  'firm.admin': 80,
  'firm.attorney': 50,
  'firm.paralegal': 30,
}

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
    expect(LADDER['firm.super_admin']).toBeGreaterThan(LADDER['firm.admin'])
    expect(LADDER['firm.admin']).toBeGreaterThan(LADDER['firm.attorney'])
    expect(LADDER['firm.attorney']).toBeGreaterThan(LADDER['firm.paralegal'])
  })

  it('rankOfScopes takes the highest scope and treats unknown/empty as 0', () => {
    expect(rankOfScopes(['firm.paralegal', 'firm.admin'], LADDER)).toBe(LADDER['firm.admin'])
    expect(rankOfScopes(['something.custom'], LADDER)).toBe(0)
    expect(rankOfScopes([], LADDER)).toBe(0)
  })

  it('canManage: must strictly out-rank both the target and the granted role', () => {
    const sa = LADDER['firm.super_admin']
    const ad = LADDER['firm.admin']
    const at = LADDER['firm.attorney']
    const pa = LADDER['firm.paralegal']
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
