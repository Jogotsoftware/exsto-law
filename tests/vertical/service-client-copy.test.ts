// Client-copy carry-forward (UI-BUILDER-FIX-1 Phase 1). workflow_definition is
// VERSIONED (seal + insert v+1); the load-bearing rule is that a new version
// written WITHOUT mentioning the client fields carries them forward untouched —
// otherwise client tile copy silently vanishes on the next service revision.
// Covers both write paths (legal.service.upsert via updateServiceMetadata, and
// legal.service.set_lifecycle via setServiceLifecycle) plus the server-side
// 70-char cap (Phase 2). DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import {
  createService,
  updateServiceMetadata,
  getService,
  retireService,
  setServiceLifecycle,
} from '@exsto/legal'
import { closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

run('Client copy carry-forward across versions (live DB)', { timeout: 120_000 }, () => {
  const created: string[] = []
  afterAll(async () => {
    for (const key of created) {
      await retireService(ctx, key).catch(() => {})
    }
    await closeDbPool()
  })

  it('carries client copy forward through metadata and lifecycle revisions', async () => {
    const svc = await createService(ctx, {
      displayName: `Client Copy CF ${Date.now()}`,
      description: 'attorney-facing description',
      clientDisplayName: 'Last Will & Testament',
      clientDescription: 'A will that protects your family',
      route: 'manual',
    })
    created.push(svc.serviceKey)
    expect(svc.clientDisplayName).toBe('Last Will & Testament')
    expect(svc.clientDescription).toBe('A will that protects your family')

    // Revision 1: metadata save that does NOT mention the client fields.
    const v2 = await updateServiceMetadata(ctx, {
      serviceKey: svc.serviceKey,
      displayName: `${svc.displayName} (renamed)`,
    })
    expect(v2.clientDisplayName).toBe('Last Will & Testament')
    expect(v2.clientDescription).toBe('A will that protects your family')

    // Revision 2: lifecycle authoring (set_lifecycle carries everything forward).
    await setServiceLifecycle(ctx, svc.serviceKey, [
      {
        key: 'intake_submitted',
        label: 'Client Intake',
        entry: true,
        action: { kind: 'view_intake' },
        advances_to: [{ to: 'closed', gate: 'attorney', via: 'legal.matter.advance' }],
      },
      {
        key: 'closed',
        label: 'Matter complete',
        terminal: true,
        action: { kind: 'complete_matter' },
        advances_to: [],
      },
    ])
    const v3 = await getService(ctx, svc.serviceKey)
    expect(v3!.clientDisplayName).toBe('Last Will & Testament')
    expect(v3!.clientDescription).toBe('A will that protects your family')

    // Explicit null CLEARS (distinct from omission).
    const v4 = await updateServiceMetadata(ctx, {
      serviceKey: svc.serviceKey,
      displayName: v3!.displayName,
      clientDisplayName: null,
    })
    expect(v4.clientDisplayName).toBeNull()
    // ...while the unmentioned sibling still carries forward.
    expect(v4.clientDescription).toBe('A will that protects your family')
  })

  it('caps over-long client copy server-side (truncate-and-flag, Phase 2)', async () => {
    const long =
      'A very long client description that keeps going well past the seventy character tile budget and would overflow'
    const svc = await createService(ctx, {
      displayName: `Client Copy Cap ${Date.now()}`,
      clientDescription: long,
      route: 'manual',
    })
    created.push(svc.serviceKey)
    expect(svc.clientDescription!.length).toBeLessThanOrEqual(70)
    expect(svc.clientDescription!.endsWith('…')).toBe(true)
  })
})
