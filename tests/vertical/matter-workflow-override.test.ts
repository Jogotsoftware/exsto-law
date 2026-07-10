// ADR 0045 PR6 — per-matter workflow CUSTOMIZATION, end to end through the real
// action layer (submitAction → legal.matter.set_workflow). Covers the four behaviors
// migration 0108 + the handler add:
//
//   (a) ORPHAN GUARD — an override whose graph drops the matter's CURRENT stage key
//       is rejected (the critical safety check: a customization must never strand the
//       matter on a stage the graph no longer has).
//   (b) WRITE + SUPERSEDE — a valid linear override is written to states_override, and
//       loadInstanceForMatter then returns the OVERRIDE graph for that matter (the
//       per-instance graph supersedes the bound version — invariant 17).
//   (c) VALIDATION — a non-linear graph and an out-of-catalog action.kind are rejected
//       (the same closed-vocabulary + linear rules the service authoring path obeys).
//   (d) SERVICE DEFAULT UNCHANGED — after the per-matter override, the SERVICE'S
//       workflow_definition.states is byte-for-byte the bound graph (the core product
//       invariant: tailoring one matter never touches the service default).
//
// DB-gated: skipped cleanly without a connection string. Requires migrations 0093 +
// 0108 applied to the test DB. The engine is flag-gated; turned on for this suite so
// matter.open stands up an instance for a service with an authored lifecycle. The
// throwaway service/matter are cleaned up in afterAll.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

process.env.LEGAL_WORKFLOW_ENGINE = '1'

import { createService } from '@exsto/legal'
import { setMatterWorkflow } from '@exsto/legal'
import { loadInstanceForMatter } from '@exsto/legal'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { withSuperuser, withTenant, closeDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const PUBLIC_INTAKE = '00000000-0000-0000-0001-000000000005'
const attorneyCtx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }
const intakeCtx: ActionContext = { tenantId: TENANT, actorId: PUBLIC_INTAKE }

// The bound (service-default) graph — a minimal authored-shaped, linear lifecycle.
const BOUND_GRAPH = [
  {
    key: 'intake_submitted',
    label: 'Client Intake',
    entry: true,
    action: { kind: 'view_intake' },
    advances_to: [{ to: 'in_review', gate: 'attorney', via: 'legal.matter.advance' }],
  },
  {
    key: 'in_review',
    label: 'Review & Send document',
    action: { kind: 'review_send_document' },
    advances_to: [{ to: 'closed', gate: 'attorney', via: 'legal.matter.advance' }],
  },
  {
    key: 'closed',
    label: 'Complete',
    terminal: true,
    action: { kind: 'complete_matter' },
    advances_to: [],
  },
]

// A VALID per-matter override: keeps the current entry stage (intake_submitted),
// inserts a new manual_task step, then ends. Linear, closed-catalog kinds.
const VALID_OVERRIDE = [
  {
    key: 'intake_submitted',
    label: 'Client Intake',
    entry: true,
    action: { kind: 'view_intake' },
    advances_to: [{ to: 'extra_step', gate: 'attorney', via: 'legal.matter.advance' }],
  },
  {
    key: 'extra_step',
    label: 'Extra task for THIS matter',
    action: { kind: 'manual_task' },
    advances_to: [{ to: 'closed', gate: 'attorney', via: 'legal.matter.advance' }],
  },
  {
    key: 'closed',
    label: 'Complete',
    terminal: true,
    action: { kind: 'complete_matter' },
    advances_to: [],
  },
]

const createdServiceKeys: string[] = []
const createdMatterIds: string[] = []

// Create a service and seed its ACTIVE version's `states` with BOUND_GRAPH (test
// fixture, exactly as workflow-engine.test.ts does — the immutability trigger guards
// workflow_instance, not the open workflow_definition row). Returns key + def id.
async function serviceWithLifecycle(): Promise<{ serviceKey: string; activeDefId: string }> {
  const created = await createService(attorneyCtx, {
    displayName: `WF Override ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    description: null,
    route: 'manual',
  })
  const serviceKey = created.serviceKey
  createdServiceKeys.push(serviceKey)
  const activeDefId = await withSuperuser(async (client) => {
    const r = await client.query<{ id: string }>(
      `UPDATE workflow_definition
          SET states = $3::jsonb, status = 'active'
        WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL
        RETURNING id`,
      [TENANT, serviceKey, JSON.stringify(BOUND_GRAPH)],
    )
    return r.rows[0]!.id
  })
  return { serviceKey, activeDefId }
}

// Run an intake + matter.open for a service, returning the opened matter id.
async function openMatter(serviceKey: string): Promise<string> {
  const tag = `wfo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const intake = await submitAction(intakeCtx, {
    actionKindName: 'intake.submit',
    intentKind: 'enforcement',
    payload: {
      client_full_name: `${tag} Client`,
      client_email: `${tag}@pilot.test`,
      client_phone: null,
      client_company_name: `${tag} Co`,
      service_key: serviceKey,
      intake_form_id: null,
      intake_responses: { note: tag },
    },
  })
  const { clientEntityId, questionnaireEntityId } = intake.effects[0] as {
    clientEntityId: string
    questionnaireEntityId: string
  }
  const opened = await submitAction(intakeCtx, {
    actionKindName: 'matter.open',
    intentKind: 'enforcement',
    payload: {
      service_key: serviceKey,
      workflow_route: 'manual',
      client_entity_id: clientEntityId,
      questionnaire_entity_id: questionnaireEntityId,
      client_display_name: `${tag} Co`,
    },
  })
  const matterId = (opened.effects[0] as { matterEntityId: string }).matterEntityId
  createdMatterIds.push(matterId)
  return matterId
}

// The service's CURRENT active workflow_definition.states (the default we must prove
// is untouched by a per-matter override).
async function readServiceStates(serviceKey: string): Promise<unknown> {
  return withSuperuser(async (client) => {
    const r = await client.query<{ states: unknown }>(
      `SELECT states FROM workflow_definition
        WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL
        ORDER BY version DESC LIMIT 1`,
      [TENANT, serviceKey],
    )
    return r.rows[0]?.states ?? null
  })
}

run('per-matter workflow customization (live DB)', { timeout: 120_000 }, () => {
  beforeAll(() => {
    process.env.LEGAL_WORKFLOW_ENGINE = '1'
  })
  afterAll(async () => {
    delete process.env.LEGAL_WORKFLOW_ENGINE
    // Best-effort cleanup of the throwaway matters + services.
    await withSuperuser(async (client) => {
      for (const m of createdMatterIds) {
        await client
          .query(`DELETE FROM workflow_instance WHERE tenant_id = $1 AND subject_entity_id = $2`, [
            TENANT,
            m,
          ])
          .catch(() => undefined)
      }
    }).catch(() => undefined)
    await closeDbPool()
  })

  it('(a) rejects an override that would orphan the current step', async () => {
    const { serviceKey } = await serviceWithLifecycle()
    const matterId = await openMatter(serviceKey)
    // The matter is parked on the entry stage `intake_submitted`. An override whose
    // graph has NO such stage would strand the matter — must be rejected.
    const ORPHANING = [
      {
        key: 'brand_new_entry',
        label: 'New entry',
        entry: true,
        action: { kind: 'view_intake' },
        advances_to: [{ to: 'closed', gate: 'attorney', via: 'legal.matter.advance' }],
      },
      {
        key: 'closed',
        label: 'Complete',
        terminal: true,
        action: { kind: 'complete_matter' },
        advances_to: [],
      },
    ]
    await expect(setMatterWorkflow(attorneyCtx, matterId, ORPHANING as never)).rejects.toThrow()
  })

  it('(b) writes a valid override that supersedes the bound graph for THIS matter', async () => {
    const { serviceKey } = await serviceWithLifecycle()
    const matterId = await openMatter(serviceKey)

    const res = await setMatterWorkflow(attorneyCtx, matterId, VALID_OVERRIDE as never)
    expect(res.stageCount).toBe(VALID_OVERRIDE.length)

    // loadInstanceForMatter now returns the OVERRIDE graph (supersedes the bound).
    const loaded = await withTenant(TENANT, (client) =>
      loadInstanceForMatter(client, attorneyCtx, matterId),
    )
    expect(loaded).not.toBeNull()
    expect(loaded!.graph.map((s) => s.key)).toEqual(['intake_submitted', 'extra_step', 'closed'])
  })

  it('(c) rejects a non-linear graph and an out-of-catalog action kind', async () => {
    const { serviceKey } = await serviceWithLifecycle()
    const matterId = await openMatter(serviceKey)

    // NON-LINEAR: the entry stage has TWO outgoing edges.
    const NON_LINEAR = [
      {
        key: 'intake_submitted',
        label: 'Client Intake',
        entry: true,
        action: { kind: 'view_intake' },
        advances_to: [
          { to: 'a', gate: 'attorney', via: 'legal.matter.advance' },
          { to: 'closed', gate: 'attorney', via: 'legal.matter.advance' },
        ],
      },
      {
        key: 'a',
        label: 'A',
        action: { kind: 'manual_task' },
        advances_to: [{ to: 'closed', gate: 'attorney', via: 'legal.matter.advance' }],
      },
      {
        key: 'closed',
        label: 'Complete',
        terminal: true,
        action: { kind: 'complete_matter' },
        advances_to: [],
      },
    ]
    await expect(setMatterWorkflow(attorneyCtx, matterId, NON_LINEAR as never)).rejects.toThrow()

    // OUT-OF-CATALOG action.kind.
    const BAD_KIND = [
      {
        key: 'intake_submitted',
        label: 'Client Intake',
        entry: true,
        action: { kind: 'totally_made_up' },
        advances_to: [{ to: 'closed', gate: 'attorney', via: 'legal.matter.advance' }],
      },
      {
        key: 'closed',
        label: 'Complete',
        terminal: true,
        action: { kind: 'complete_matter' },
        advances_to: [],
      },
    ]
    await expect(setMatterWorkflow(attorneyCtx, matterId, BAD_KIND as never)).rejects.toThrow()
  })

  it('(d) leaves the SERVICE workflow_definition.states unchanged after a per-matter override', async () => {
    const { serviceKey } = await serviceWithLifecycle()
    const matterId = await openMatter(serviceKey)

    const before = await readServiceStates(serviceKey)
    await setMatterWorkflow(attorneyCtx, matterId, VALID_OVERRIDE as never)
    const after = await readServiceStates(serviceKey)

    // The service default is byte-for-byte the BOUND graph — the per-matter override
    // touched ONLY workflow_instance.states_override (the core product invariant).
    expect(after).toEqual(before)
    expect(after).toEqual(BOUND_GRAPH)
  })
})
