// Workflow STEP library (migration 0095, ADR 0045 PR4c). A workflow_step_template
// entity is a reusable workflow STEP (a LifecycleStage WITHOUT edges) not bound to
// a service. create → list/get → update → archive removes it. The stored stage
// round-trips and carries NO advances_to (a half-edge would fail validateLifecycle).
// DB-gated (skip-when-no-DB).
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import {
  createWorkflowStepTemplate,
  updateWorkflowStepTemplate,
  archiveWorkflowStepTemplate,
  getWorkflowStepTemplate,
  listWorkflowStepTemplates,
  type StepStage,
} from '@exsto/legal'
import { closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

run('Workflow step library (live DB)', { timeout: 120_000 }, () => {
  afterAll(async () => {
    await closeDbPool()
  })

  it('creates, lists, gets, updates and archives a reusable workflow step', async () => {
    const tag = `wst-${Date.now()}`
    const stage: StepStage = {
      label: `${tag} Review & send`,
      client_label: 'Document review',
      blocking: true,
      gate: 'attorney',
      action: { kind: 'review_send_document' },
      documents: [{ docKind: 'operating_agreement', label: 'Operating Agreement' }],
    }

    const created = await createWorkflowStepTemplate(ctx, {
      name: `${tag} Review step`,
      description: 'A reusable review-and-send step.',
      stage,
    })
    const id = created.workflowStepTemplateId
    expect(created.name).toBe(`${tag} Review step`)
    // The stored stage round-trips exactly…
    expect(created.stage.label).toBe(stage.label)
    expect(created.stage.action.kind).toBe('review_send_document')
    expect(created.stage.gate).toBe('attorney')
    expect(created.stage.documents?.[0]?.docKind).toBe('operating_agreement')
    // …and carries NO advances_to (a half-edge would fail validateLifecycle).
    expect('advances_to' in created.stage).toBe(false)
    expect('key' in created.stage).toBe(false)
    expect('entry' in created.stage).toBe(false)
    expect('terminal' in created.stage).toBe(false)

    // Listed and individually fetchable.
    expect(
      (await listWorkflowStepTemplates(ctx)).some((s) => s.workflowStepTemplateId === id),
    ).toBe(true)
    const fetched = await getWorkflowStepTemplate(ctx, id)
    expect(fetched?.name).toBe(`${tag} Review step`)
    expect('advances_to' in (fetched?.stage ?? {})).toBe(false)

    // Update the stage (append-only supersession); the new stage still has no edges.
    const updated = await updateWorkflowStepTemplate(ctx, {
      workflowStepTemplateId: id,
      stage: { ...stage, blocking: false, gate: 'automatic' },
    })
    expect(updated.stage.gate).toBe('automatic')
    expect(updated.stage.blocking).toBe(false)
    expect('advances_to' in updated.stage).toBe(false)

    // Archive removes it from active listings.
    await archiveWorkflowStepTemplate(ctx, id)
    expect(
      (await listWorkflowStepTemplates(ctx)).some((s) => s.workflowStepTemplateId === id),
    ).toBe(false)
    expect(await getWorkflowStepTemplate(ctx, id)).toBeNull()
  })

  it('rejects a saved step that carries advances_to (no half-edges)', async () => {
    const bad = {
      label: 'Bad step with an edge',
      gate: 'attorney',
      action: { kind: 'manual_task' },
      advances_to: [{ to: 'somewhere', gate: 'attorney' }],
    } as unknown as StepStage
    await expect(
      createWorkflowStepTemplate(ctx, { name: 'should fail', stage: bad }),
    ).rejects.toThrow(/advances_to/)
  })
})
