// WF-FIX-1 (WP5) — producing runtimes must submit as THIS tenant's own agent/system
// actor, not tenant-zero's hardcoded agent. A 2nd firm has its own actor rows; the
// tenant-zero id resolves to no row there (FK/RLS breakage, automatic advances
// rejected as "human"). These tests pin the resolver's preference order and fallback.
import { describe, it, expect, vi } from 'vitest'

const rows: Array<{ id: string }> = []
vi.mock('@exsto/substrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exsto/substrate')>()
  return {
    ...actual,
    withActionContext: vi.fn(async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) =>
      fn({ query: async () => ({ rows, rowCount: rows.length }) }),
    ),
  }
})
import {
  resolveTenantAgentCtx,
  resolveTenantSystemActorId,
  TENANT_ZERO_AGENT_ACTOR_ID,
} from '@exsto/legal'

const CTX = { tenantId: 'ae5530a1-05c7-4241-a38e-79bd186c1bbb', actorId: 'caller' }

describe('resolveTenantSystemActorId (WF-FIX-1 WP5)', () => {
  it("returns the tenant's own agent/system actor when one exists", async () => {
    rows.length = 0
    rows.push({ id: 'pacheco-agent-actor' })
    expect(await resolveTenantSystemActorId(CTX)).toBe('pacheco-agent-actor')
    const agentCtx = await resolveTenantAgentCtx(CTX)
    expect(agentCtx).toEqual({ tenantId: CTX.tenantId, actorId: 'pacheco-agent-actor' })
  })

  it('falls back to the tenant-zero agent const only when the tenant seeds no actor', async () => {
    rows.length = 0
    expect(await resolveTenantSystemActorId(CTX)).toBe(TENANT_ZERO_AGENT_ACTOR_ID)
  })
})
