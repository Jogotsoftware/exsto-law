// PR5 — AI workflow authoring vocabulary + provenance invariants.
//
// (a)+(b) are PURE validator checks (no DB): a graph whose stage.action.kind is not
// in the closed catalog is rejected by validateLifecycle, and a non-linear graph
// (a stage with >1 outgoing edge) is rejected by validateLinearLifecycle — both
// BEFORE any workflow_definition write could happen.
//
// (c)+(d) are DB-gated (skipped without a connection string + the seeded legal
// action kinds + tenant): the AI approve path (setServiceLifecycleAI) attaches a
// reasoning_trace authored by the Claude AGENT actor, and the write seals the prior
// version and inserts version+1. Importing '@exsto/legal' registers the legal
// action handlers (set_lifecycle/upsert/retire) as a side effect.
import { describe, it, expect, afterAll } from 'vitest'
import type { ActionContext } from '@exsto/substrate'
import { closeDbPool } from '@exsto/shared'
import {
  validateLifecycle,
  validateLinearLifecycle,
  setServiceLifecycleAI,
  type Lifecycle,
} from '@exsto/legal'
// Side effect: registers the legal action handlers + the legal MCP tools.
import '@exsto/legal'
import { submitAction, withActionContext } from '@exsto/substrate'

// The Claude agent actor the AI write path sources to (mirrors generateDraft).
const CLAUDE_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'

// ── (a) + (b): pure validator checks, always run (no DB needed) ─────────────────
describe('PR5: workflow authoring closed-vocabulary + linear-only (pure)', () => {
  // A valid 2-stage linear graph we mutate per case.
  const base: Lifecycle = [
    {
      key: 'start',
      label: 'Start',
      entry: true,
      action: { kind: 'view_intake' },
      advances_to: [{ to: 'done', gate: 'attorney', via: 'legal.matter.advance' }],
    },
    {
      key: 'done',
      label: 'Done',
      terminal: true,
      action: { kind: 'complete_matter' },
      advances_to: [],
    },
  ]

  it('(a) rejects an out-of-catalog stage.action.kind before any write', () => {
    const bad: Lifecycle = JSON.parse(JSON.stringify(base))
    ;(bad[0].action as { kind: string }).kind = 'frobnicate_document'
    const v = validateLifecycle(bad)
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/unknown action kind "frobnicate_document"/)
  })

  it('action is OPTIONAL — a stage without action still validates (legacy/seeded graphs)', () => {
    const noAction: Lifecycle = JSON.parse(JSON.stringify(base))
    delete noAction[0].action
    delete noAction[1].action
    expect(validateLifecycle(noAction).ok).toBe(true)
  })

  it('(b) rejects a non-linear graph (a stage with >1 outgoing edge)', () => {
    const branching: Lifecycle = [
      {
        key: 'start',
        label: 'Start',
        entry: true,
        action: { kind: 'view_intake' },
        advances_to: [
          { to: 'a', gate: 'attorney', via: 'legal.matter.advance' },
          { to: 'b', gate: 'attorney', via: 'legal.matter.advance' },
        ],
      },
      {
        key: 'a',
        label: 'A',
        action: { kind: 'manual_task' },
        advances_to: [{ to: 'done', gate: 'attorney' }],
      },
      {
        key: 'b',
        label: 'B',
        action: { kind: 'manual_task' },
        advances_to: [{ to: 'done', gate: 'attorney' }],
      },
      {
        key: 'done',
        label: 'Done',
        terminal: true,
        action: { kind: 'complete_matter' },
        advances_to: [],
      },
    ]
    // The structural validator permits branching; the linear-only guard rejects it.
    const linear = validateLinearLifecycle(branching)
    expect(linear.ok).toBe(false)
    expect(linear.errors.join(' ')).toMatch(/outgoing edges — workflows must be linear/)
  })

  it('a valid linear graph passes both checks', () => {
    expect(validateLifecycle(base).ok).toBe(true)
    expect(validateLinearLifecycle(base).ok).toBe(true)
  })
})

// ── (c) + (d): DB-gated AI approve-path provenance + versioning ─────────────────
const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const runDb = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'

runDb('PR5: AI approve path attaches a trace + uses the agent actor (live DB)', () => {
  const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

  afterAll(async () => {
    await closeDbPool()
  })

  // A valid linear authored graph (all action kinds in the closed catalog).
  const graph: Lifecycle = [
    {
      key: 'pr5_intake',
      label: 'PR5 Intake',
      entry: true,
      action: { kind: 'view_intake' },
      advances_to: [{ to: 'pr5_done', gate: 'attorney', via: 'legal.matter.advance' }],
    },
    {
      key: 'pr5_done',
      label: 'PR5 Done',
      terminal: true,
      action: { kind: 'complete_matter' },
      advances_to: [],
    },
  ]

  it('(c)+(d): authoring writes version+1, seals the prior version, traces to the agent actor', async () => {
    // Create a throwaway service to author onto (then retire it at the end).
    const created = await submitAction(ctx, {
      actionKindName: 'legal.service.upsert',
      intentKind: 'exploration',
      payload: { display_name: 'PR5 Authoring Probe Service' },
    })
    const { serviceKey, version: v1 } = created.effects[0] as {
      serviceKey: string
      version: number
    }
    expect(v1).toBe(1)

    try {
      // The AI approve path — the human gate's server call.
      const result = await setServiceLifecycleAI(ctx, serviceKey, graph, {
        conclusion: 'PR5 test: author a minimal linear workflow.',
        confidence: 0.8,
      })
      // (d) version + 1 inserted.
      expect(result.version).toBe(v1 + 1)

      await withActionContext(ctx, async (client) => {
        // (d) prior version sealed (valid_to set, deprecated); new version active+open.
        const versions = await client.query<{
          version: number
          valid_to: string | null
          status: string
        }>(
          `SELECT version, valid_to, status FROM workflow_definition
            WHERE tenant_id = $1 AND kind_name = $2 ORDER BY version`,
          [TENANT, serviceKey],
        )
        const prior = versions.rows.find((r) => r.version === v1)!
        const next = versions.rows.find((r) => r.version === v1 + 1)!
        expect(prior.valid_to).not.toBeNull()
        expect(prior.status).toBe('deprecated')
        expect(next.valid_to).toBeNull()

        // (c) the set_lifecycle action carries a reasoning_trace authored by the
        // CLAUDE AGENT actor (not the attorney). Find the action that produced v2.
        const act = await client.query<{
          actor_id: string
          reasoning_trace_id: string | null
        }>(
          `SELECT a.actor_id, a.reasoning_trace_id
             FROM workflow_definition wd
             JOIN action a ON a.id = wd.action_id
            WHERE wd.tenant_id = $1 AND wd.kind_name = $2 AND wd.version = $3`,
          [TENANT, serviceKey, v1 + 1],
        )
        const row = act.rows[0]!
        expect(row.actor_id).toBe(CLAUDE_AGENT_ACTOR_ID)
        expect(row.reasoning_trace_id).not.toBeNull()

        // The trace itself is agent-authored with confidence strictly below 1.0.
        const trace = await client.query<{ agent_actor_id: string; confidence: number }>(
          `SELECT agent_actor_id, confidence FROM reasoning_trace WHERE id = $1 AND tenant_id = $2`,
          [row.reasoning_trace_id, TENANT],
        )
        expect(trace.rows[0]!.agent_actor_id).toBe(CLAUDE_AGENT_ACTOR_ID)
        expect(Number(trace.rows[0]!.confidence)).toBeLessThan(1)
      })
    } finally {
      // Leave no probe service behind.
      await submitAction(ctx, {
        actionKindName: 'legal.service.retire',
        intentKind: 'correction',
        payload: { service_key: serviceKey },
      }).catch(() => {})
    }
  })
})
