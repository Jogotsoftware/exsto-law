// ADR 0045 PR3 — the configurable workflow ENGINE write path, end to end through the
// real action layer (submitAction). Covers the four behaviors migration 0093 + the
// legal.matter.advance handler add:
//
//   1. version binding — matter.open with LEGAL_WORKFLOW_ENGINE on, against a service
//      whose workflow_definition has a non-empty `states`, creates a workflow_instance
//      bound to the ACTIVE version's id (invariant 17), starting in the entry stage.
//   2. status mirror — after a successful legal.matter.advance, the matter_status
//      attribute equals workflow_instance.current_state.
//   3. transition guard — an illegal transition (to_state not reachable via an edge of
//      the given gate) is rejected; a repeated advance to the current state is an
//      idempotent no-op.
//   4. actor/gate authority — a NON-system actor submitting gate:'system' is rejected
//      (a human cannot forge a system/automatic transition).
//
// DB-gated: skipped cleanly without a connection string. Requires migration 0093
// applied to the test DB. The flag is set on this process (process.env) before the
// engine code runs; matter.open reads it at submit time.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

// The engine is flag-gated and a perfect no-op when off; turn it on for this suite so
// matter.open stands up an instance for a service that has an authored lifecycle.
process.env.LEGAL_WORKFLOW_ENGINE = '1'

import { createService } from '@exsto/legal'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { withSuperuser, closeDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
// Seeded actors (supabase/seed/0001_initial_data.sql): 0001 is the SYSTEM actor
// (actor_type='system'), 0002 is a HUMAN. The system-gate authority test depends on
// this distinction.
const SYSTEM = '00000000-0000-0000-0001-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const PUBLIC_INTAKE = '00000000-0000-0000-0001-000000000005'
const systemCtx: ActionContext = { tenantId: TENANT, actorId: SYSTEM }
const attorneyCtx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }
const intakeCtx: ActionContext = { tenantId: TENANT, actorId: PUBLIC_INTAKE }

// A minimal authored-shaped graph (same gates/shape as NC_SMLLC_AUTHORED) for the
// service we create per test. validateLifecycle accepts it; the engine binds it.
const GRAPH = [
  {
    key: 'intake_submitted',
    label: 'Client Intake',
    entry: true,
    action: { kind: 'view_intake' },
    advances_to: [{ to: 'consultation_booked', gate: 'client', via: 'booking.create' }],
  },
  {
    key: 'consultation_booked',
    label: 'Client Consultation',
    blocking: false,
    action: { kind: 'view_consultation' },
    advances_to: [{ to: 'in_review', gate: 'attorney', via: 'legal.matter.advance' }],
  },
  {
    key: 'in_review',
    label: 'Review & Send document',
    action: { kind: 'review_send_document' },
    advances_to: [{ to: 'approved', gate: 'attorney', via: 'draft.approve' }],
  },
  {
    key: 'approved',
    label: 'Approve & Send invoice',
    action: { kind: 'approve_send_invoice' },
    advances_to: [{ to: 'closed', gate: 'system', on: 'invoice.paid' }],
  },
  {
    key: 'closed',
    label: 'Complete',
    terminal: true,
    action: { kind: 'complete_matter' },
    advances_to: [],
  },
]

// Create a service (writes its workflow_definition through the action layer) and then
// seed its ACTIVE version's `states` with GRAPH. There is no action-layer set_lifecycle
// on this branch (PR4), so the states are written as a TEST FIXTURE via withSuperuser
// — migration 0093's immutability trigger guards workflow_instance, not the (still
// open) workflow_definition row, so this UPDATE is legal at the DB layer. Returns the
// service key and the active version's workflow_definition id (the binding target).
async function serviceWithLifecycle(): Promise<{ serviceKey: string; activeDefId: string }> {
  const created = await createService(attorneyCtx, {
    displayName: `WF Engine ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    description: null,
    route: 'manual',
  })
  const serviceKey = created.serviceKey
  const activeDefId = await withSuperuser(async (client) => {
    const r = await client.query<{ id: string }>(
      `UPDATE workflow_definition
          SET states = $3::jsonb, status = 'active'
        WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL
        RETURNING id`,
      [TENANT, serviceKey, JSON.stringify(GRAPH)],
    )
    return r.rows[0]!.id
  })
  return { serviceKey, activeDefId }
}

// Run an intake + matter.open for a service, returning the opened matter id.
async function openMatter(serviceKey: string): Promise<string> {
  const tag = `wfe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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
  return (opened.effects[0] as { matterEntityId: string }).matterEntityId
}

// Read a matter's running workflow_instance (id, current_state, definition id).
async function readInstance(
  matterId: string,
): Promise<{ id: string; current_state: string; workflow_definition_id: string } | null> {
  return withSuperuser(async (client) => {
    const r = await client.query<{
      id: string
      current_state: string
      workflow_definition_id: string
    }>(
      `SELECT id, current_state, workflow_definition_id
         FROM workflow_instance
        WHERE tenant_id = $1 AND subject_entity_id = $2
        ORDER BY started_at DESC
        LIMIT 1`,
      [TENANT, matterId],
    )
    return r.rows[0] ?? null
  })
}

// The latest matter_status value (the mirror the read path uses).
async function readMatterStatus(matterId: string): Promise<string | null> {
  return withSuperuser(async (client) => {
    const r = await client.query<{ value: string }>(
      `SELECT a.value #>> '{}' AS value
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
        WHERE a.tenant_id = $1
          AND a.entity_id = $2
          AND akd.kind_name = 'matter_status'
          AND a.valid_to IS NULL
        ORDER BY a.valid_from DESC
        LIMIT 1`,
      [TENANT, matterId],
    )
    return r.rows[0]?.value ?? null
  })
}

run('workflow engine write path (live DB)', { timeout: 120_000 }, () => {
  beforeAll(() => {
    process.env.LEGAL_WORKFLOW_ENGINE = '1'
  })
  afterAll(async () => {
    delete process.env.LEGAL_WORKFLOW_ENGINE
    await closeDbPool()
  })

  it('binds a new matter to the ACTIVE workflow_definition version, starting in the entry stage', async () => {
    const { serviceKey, activeDefId } = await serviceWithLifecycle()
    const matterId = await openMatter(serviceKey)

    const instance = await readInstance(matterId)
    expect(instance).not.toBeNull()
    // Bound to the version the matter was opened against (invariant 17).
    expect(instance!.workflow_definition_id).toBe(activeDefId)
    // Started in the graph's entry stage.
    expect(instance!.current_state).toBe('intake_submitted')
  })

  it('rejects an illegal transition, is idempotent on a no-op, and mirrors matter_status on success', async () => {
    const { serviceKey } = await serviceWithLifecycle()
    const matterId = await openMatter(serviceKey)

    // ILLEGAL: from intake_submitted there is no attorney edge to in_review (the
    // attorney edge is consultation_booked → in_review). The graph, not the caller,
    // decides legality.
    await expect(
      submitAction(attorneyCtx, {
        actionKindName: 'legal.matter.advance',
        intentKind: 'adjustment',
        payload: { matter_entity_id: matterId, to_state: 'in_review', gate: 'attorney' },
      }),
    ).rejects.toThrow()

    // LEGAL: intake_submitted → consultation_booked is a client edge.
    const advanced = await submitAction(intakeCtx, {
      actionKindName: 'legal.matter.advance',
      intentKind: 'adjustment',
      payload: { matter_entity_id: matterId, to_state: 'consultation_booked', gate: 'client' },
    })
    expect((advanced.effects[0] as { advanced: boolean }).advanced).toBe(true)

    // STATUS MIRROR: matter_status now equals the instance's current_state.
    const instance = await readInstance(matterId)
    expect(instance!.current_state).toBe('consultation_booked')
    expect(await readMatterStatus(matterId)).toBe('consultation_booked')

    // IDEMPOTENT: advancing again to the state we are already in is a no-op.
    const again = await submitAction(intakeCtx, {
      actionKindName: 'legal.matter.advance',
      intentKind: 'adjustment',
      payload: { matter_entity_id: matterId, to_state: 'consultation_booked', gate: 'client' },
    })
    expect((again.effects[0] as { advanced: boolean }).advanced).toBe(false)
  })

  it('rejects a NON-system actor firing a system gate (no forging the audit trail)', async () => {
    const { serviceKey } = await serviceWithLifecycle()
    const matterId = await openMatter(serviceKey)

    // Walk to `approved`, whose only edge is system-gated (→ closed on invoice.paid).
    await submitAction(intakeCtx, {
      actionKindName: 'legal.matter.advance',
      intentKind: 'adjustment',
      payload: { matter_entity_id: matterId, to_state: 'consultation_booked', gate: 'client' },
    })
    await submitAction(attorneyCtx, {
      actionKindName: 'legal.matter.advance',
      intentKind: 'adjustment',
      payload: { matter_entity_id: matterId, to_state: 'in_review', gate: 'attorney' },
    })
    await submitAction(attorneyCtx, {
      actionKindName: 'legal.matter.advance',
      intentKind: 'adjustment',
      payload: { matter_entity_id: matterId, to_state: 'approved', gate: 'attorney' },
    })

    // A HUMAN attorney cannot fire the system gate to close the matter — only a
    // system actor may, and only through the real invoice.paid callback.
    await expect(
      submitAction(attorneyCtx, {
        actionKindName: 'legal.matter.advance',
        intentKind: 'adjustment',
        payload: { matter_entity_id: matterId, to_state: 'closed', gate: 'system' },
      }),
    ).rejects.toThrow()

    // The SYSTEM actor firing the same system edge is allowed and mirrors status.
    const closed = await submitAction(systemCtx, {
      actionKindName: 'legal.matter.advance',
      intentKind: 'automatic_sync',
      payload: { matter_entity_id: matterId, to_state: 'closed', gate: 'system' },
    })
    expect((closed.effects[0] as { advanced: boolean }).advanced).toBe(true)
    expect(await readMatterStatus(matterId)).toBe('closed')
  })
})
