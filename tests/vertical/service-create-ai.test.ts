// createServiceAI (Build-Wizard Phase 1). The AI create path persists a
// reasoning_trace sourced to the Claude agent actor, then submits
// legal.service.upsert AS THE AGENT with intent 'exploration', producing a
// version-1, DISABLED service that carries the trace. Mirrors
// service-set-lifecycle.test.ts. DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { createServiceAI, getService, retireService } from '@exsto/legal'
import { withSuperuser, closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
// The seeded Claude agent actor — the source createServiceAI attributes its writes to.
const CLAUDE_AGENT_ACTOR = '00000000-0000-0000-0001-000000000004'
const attorneyCtx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

run('Create service via AI (live DB)', { timeout: 120_000 }, () => {
  const created: string[] = []
  afterAll(async () => {
    // Clean up the throwaway services this test created (seal them, no successor).
    for (const key of created) {
      await retireService(attorneyCtx, key).catch(() => {})
    }
    await closeDbPool()
  })

  it('writes a version-1 DISABLED service attached to a Claude-sourced reasoning trace, tenant-scoped', async () => {
    const displayName = `AI Service ${Date.now()}`
    const res = await createServiceAI(
      attorneyCtx,
      { displayName, description: 'Created by the build wizard', route: 'manual' },
      { conclusion: 'The firm needs this service.', confidence: 0.8 },
    )
    created.push(res.serviceKey)

    // (b) version 1, and (b) DISABLED — a freshly created service is never live.
    expect(res.version).toBe(1)
    const service = await getService(attorneyCtx, res.serviceKey)
    expect(service).not.toBeNull()
    expect(service!.isActive).toBe(false)
    expect(service!.displayName).toBe(displayName)

    // (a) the action carries a reasoning_trace sourced to the Claude agent actor,
    // (c) the whole chain is tenant-scoped. One superuser read confirms both: the
    // workflow_definition row, its action, the action's reasoning_trace, and that
    // trace's agent_actor_id — all on TENANT.
    const provenance = await withSuperuser(async (client) => {
      const r = await client.query<{
        wf_tenant: string
        action_intent: string
        action_tenant: string
        trace_tenant: string | null
        trace_agent: string | null
        trace_confidence: number | null
      }>(
        `SELECT wf.tenant_id AS wf_tenant,
                a.intent_kind AS action_intent,
                a.tenant_id   AS action_tenant,
                rt.tenant_id  AS trace_tenant,
                rt.agent_actor_id AS trace_agent,
                rt.confidence AS trace_confidence
           FROM workflow_definition wf
           JOIN action a ON a.id = wf.action_id
           LEFT JOIN reasoning_trace rt ON rt.id = a.reasoning_trace_id
          WHERE wf.tenant_id = $1 AND wf.kind_name = $2 AND wf.valid_to IS NULL`,
        [TENANT, res.serviceKey],
      )
      return r.rows[0]!
    })

    // Tenant-scoped end to end.
    expect(provenance.wf_tenant).toBe(TENANT)
    expect(provenance.action_tenant).toBe(TENANT)
    expect(provenance.trace_tenant).toBe(TENANT)
    // Creating a new service is intent 'exploration'.
    expect(provenance.action_intent).toBe('exploration')
    // The reasoning trace exists and is sourced to the Claude agent actor.
    expect(provenance.trace_agent).toBe(CLAUDE_AGENT_ACTOR)
    // Confidence is honest: clamped strictly below 1.0 (ADR 0006).
    expect(provenance.trace_confidence).not.toBeNull()
    expect(Number(provenance.trace_confidence)).toBeLessThan(1)
  })

  it('rejects a proposal whose derived key already exists (no second row written)', async () => {
    const displayName = `Dup Service ${Date.now()}`
    const first = await createServiceAI(
      attorneyCtx,
      { displayName, route: 'manual' },
      { conclusion: 'first' },
    )
    created.push(first.serviceKey)

    // The SAME display name slugifies to the SAME key, which now exists → reject.
    await expect(
      createServiceAI(attorneyCtx, { displayName, route: 'manual' }, { conclusion: 'dup' }),
    ).rejects.toThrow(/already exists/)
  })
})
