// ESIGN-UNIFY-1 ES-4 (design §7) — the workflow-embedded e-sign step.
//
// Three layers, no DB:
//   1. AUTO-ADD graph surgery (lifecycle/esignStage.ts): marking a service's
//      document signable inserts ONE e-sign stage right after the approve step
//      — approve's draft.approve edge retargets to it, and the stage holds the
//      matter on a system edge that fires on esign.completed. Idempotent; an
//      unsignable service's graph is returned UNTOUCHED (same reference).
//   2. STEP ADVANCE (executor proof, scripted client): esign.sent does NOT hop
//      the graph (it completes the step's own action — the modal flips to
//      "sent — awaiting signatures"), esign.completed DOES advance — via the
//      same signalEvent path handlers/esign.ts's existing lifecycle dispatch
//      calls (the #320 loop).
//   3. PREFILL INTEGRATION: the template's e-sign roles flow through
//      assembleRecipientRows into composer-ready rows with signer keys, roles,
//      and orders intact (the workflow-step seed shape).
import { describe, it, expect } from 'vitest'
import {
  NC_SMLLC_AUTHORED,
  assembleRecipientRows,
  edgesFrom,
  ensureEsignStage,
  ensureEsignStagesForConfigs,
  hasEsignStageFor,
  signalEvent,
  stepActionSpec,
  validateLifecycle,
  validateLinearLifecycle,
  type Lifecycle,
  type ResolvedIdentity,
  type TemplateEsignConfig,
} from '@exsto/legal'

const TENANT = '00000000-0000-0000-00fe-000000000001'
const MATTER = 'matter-1'
const ACTION = 'action-1'
const DOC_KIND = 'operating_agreement'

// ── 1. Auto-add graph surgery ───────────────────────────────────────────────

describe('ensureEsignStage: the builder auto-add (design §7)', () => {
  it('inserts the e-sign stage right after the approve step, rewiring only the approve edge', () => {
    const { graph, changed } = ensureEsignStage(NC_SMLLC_AUTHORED, DOC_KIND)
    expect(changed).toBe(true)

    // Display order: … in_review → esign → approved …
    const keys = graph.map((s) => s.key)
    const esignKey = `esign_${DOC_KIND}`
    expect(keys).toEqual([
      'intake_submitted',
      'consultation_booked',
      'in_review',
      esignKey,
      'approved',
      'closed',
    ])

    // The approve edge now lands on the e-sign stage (nothing else rewired).
    expect(edgesFrom(graph, 'in_review')).toEqual([
      { to: esignKey, gate: 'attorney', via: 'draft.approve' },
    ])

    // The step-advance hook: ONE system edge, fired by esign.completed through
    // the existing handlers/esign.ts lifecycle dispatch.
    expect(edgesFrom(graph, esignKey)).toEqual([
      { to: 'approved', gate: 'system', on: 'esign.completed' },
    ])

    const stage = graph.find((s) => s.key === esignKey)!
    expect(stage.action).toEqual({ kind: 'esign', config: { document_kind: DOC_KIND } })
    expect(stage.documents).toEqual([{ docKind: DOC_KIND, label: 'Operating agreement' }])

    // The patched graph is a VALID workflow (closed catalog accepts `esign`)
    // and stays linear — exactly what the set_lifecycle handler enforces.
    expect(validateLifecycle(graph).ok).toBe(true)
    expect(validateLinearLifecycle(graph).ok).toBe(true)
  })

  it('is idempotent: a graph that already carries the step comes back unchanged (same reference)', () => {
    const first = ensureEsignStage(NC_SMLLC_AUTHORED, DOC_KIND)
    const second = ensureEsignStage(first.graph, DOC_KIND)
    expect(second.changed).toBe(false)
    expect(second.graph).toBe(first.graph)
    expect(hasEsignStageFor(first.graph, DOC_KIND)).toBe(true)
  })

  it('never stacks onto an ESIGN-BLOCK-1 invoke_capability{esignature} stage', () => {
    const withCapabilityEsign: Lifecycle = NC_SMLLC_AUTHORED.map((s) =>
      s.key === 'approved'
        ? {
            ...s,
            action: {
              kind: 'invoke_capability',
              config: { capability_slug: 'esignature' },
            },
          }
        : s,
    )
    const result = ensureEsignStage(withCapabilityEsign, DOC_KIND)
    expect(result.changed).toBe(false)
    expect(result.graph).toBe(withCapabilityEsign)
  })

  it('a graph with no approve step is left untouched (nothing to hang the step on)', () => {
    const noApprove: Lifecycle = [
      {
        key: 'a',
        label: 'A',
        entry: true,
        advances_to: [{ to: 'b', gate: 'attorney', via: 'legal.matter.advance' }],
      },
      { key: 'b', label: 'B', terminal: true, advances_to: [] },
    ]
    const result = ensureEsignStage(noApprove, DOC_KIND)
    expect(result.changed).toBe(false)
    expect(result.graph).toBe(noApprove)
  })
})

describe('ensureEsignStagesForConfigs: unsignable services are completely unaffected', () => {
  it('an unsignable (or empty) e-sign config map returns the IDENTICAL graph reference', () => {
    const unsignable: Record<string, TemplateEsignConfig> = {
      [DOC_KIND]: { signable: false, roles: [] },
    }
    expect(ensureEsignStagesForConfigs(NC_SMLLC_AUTHORED, unsignable).graph).toBe(NC_SMLLC_AUTHORED)
    expect(ensureEsignStagesForConfigs(NC_SMLLC_AUTHORED, unsignable).changed).toBe(false)
    expect(ensureEsignStagesForConfigs(NC_SMLLC_AUTHORED, {}).graph).toBe(NC_SMLLC_AUTHORED)
  })

  it('a signable config adds the stage for exactly that document kind', () => {
    const configs: Record<string, TemplateEsignConfig> = {
      [DOC_KIND]: {
        signable: true,
        roles: [
          {
            key: 'client',
            label: 'Client',
            recipientRole: 'needs_to_sign',
            bind: 'matter_primary_contact',
            order: 1,
          },
        ],
      },
      unsigned_kind: { signable: false, roles: [] },
    }
    const { graph, changed } = ensureEsignStagesForConfigs(NC_SMLLC_AUTHORED, configs)
    expect(changed).toBe(true)
    expect(hasEsignStageFor(graph, DOC_KIND)).toBe(true)
    expect(graph.some((s) => s.key === 'esign_unsigned_kind')).toBe(false)
  })
})

describe('the esign step registers as an own-action/system step (catalog)', () => {
  it('defaultGate is system and it blocks (holds the matter until signed)', () => {
    const spec = stepActionSpec('esign')
    expect(spec).toBeDefined()
    expect(spec!.defaultGate).toBe('system')
    expect(spec!.blocking).toBe(true)
    expect(spec!.deprecated).not.toBe(true)
  })
})

// ── 2. Executor proof: advance on sent vs completed ─────────────────────────
// Scripted client mirroring intake-edge-fix.test.ts's fake (no DB).

interface Captured {
  advances: Array<Record<string, unknown>>
}
function fakeClient(graph: Lifecycle, startState: string) {
  const captured: Captured = { advances: [] }
  let currentState = startState
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflow_instance')) {
        return {
          rows: [
            {
              id: 'wfi-1',
              workflow_definition_id: 'def-1',
              subject_entity_id: MATTER,
              current_state: currentState,
              state_history: [],
              status: 'active',
              states_override: null,
            },
          ],
          rowCount: 1,
        }
      }
      if (sql.includes('FROM workflow_definition')) {
        return { rows: [{ id: 'def-1', version: 1, states: graph, status: 'active' }], rowCount: 1 }
      }
      if (sql.includes('UPDATE workflow_instance')) {
        currentState = params?.[2] as string
        captured.advances.push(JSON.parse(params?.[4] as string))
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes('FROM event_kind_definition')) {
        return { rows: [{ id: 'ek-1' }], rowCount: 1 }
      }
      if (sql.includes('FROM attribute_kind_definition')) {
        return { rows: [{ id: 'ak-1' }], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO event')) return { rows: [], rowCount: 1 }
      if (sql.includes('INSERT INTO attribute')) return { rows: [], rowCount: 1 }
      throw new Error(`fakeClient: unscripted SQL: ${sql.slice(0, 80)}`)
    },
  }
  return {
    client: client as unknown as Parameters<typeof signalEvent>[0],
    captured,
    state: () => currentState,
  }
}

describe('step advance on sent/completed (executor, no DB)', () => {
  const patched = ensureEsignStage(NC_SMLLC_AUTHORED, DOC_KIND).graph
  const esignKey = `esign_${DOC_KIND}`

  it('esign.sent does NOT hop the graph — the step holds, sent is the own-action state', async () => {
    const { client, captured, state } = fakeClient(patched, esignKey)
    await signalEvent(client, { tenantId: TENANT, actorId: 'a' }, MATTER, 'esign.sent', ACTION)
    expect(captured.advances).toEqual([])
    expect(state()).toBe(esignKey)
  })

  it('esign.completed advances the workflow past the e-sign step (the #320 loop)', async () => {
    const { client, captured, state } = fakeClient(patched, esignKey)
    await signalEvent(client, { tenantId: TENANT, actorId: 'a' }, MATTER, 'esign.completed', ACTION)
    expect(captured.advances.map((a) => a.state)).toEqual(['approved'])
    expect(captured.advances[0]).toMatchObject({ gate: 'system', from: esignKey })
    expect(state()).toBe('approved')
  })

  it('approving the review step now lands ON the e-sign step (the post-approve slot)', () => {
    // The attorney-gate edge the review window's Approve advances.
    expect(edgesFrom(patched, 'in_review')[0]).toEqual({
      to: esignKey,
      gate: 'attorney',
      via: 'draft.approve',
    })
  })
})

// ── 3. Prefill integration: template roles → composer-ready recipient rows ──

describe('prefill integration: roles → recipients (assembleRecipientRows → workflow-step seed)', () => {
  const config: TemplateEsignConfig = {
    signable: true,
    roles: [
      {
        key: 'client',
        label: 'Client',
        recipientRole: 'needs_to_sign',
        bind: 'matter_primary_contact',
        order: 1,
      },
      {
        key: 'attorney',
        label: 'Attorney',
        recipientRole: 'needs_to_sign',
        bind: 'attorney_of_record',
        order: 2,
      },
      {
        key: 'observer',
        label: 'Observer',
        recipientRole: 'receives_copy',
        bind: 'manual',
        order: 2,
      },
    ],
  }

  const identities: Record<string, ResolvedIdentity> = {
    matter_primary_contact: {
      name: 'Ana López',
      email: 'ana@example.com',
      title: 'Managing Member',
      contactEntityId: 'contact-1',
    },
    attorney_of_record: {
      name: 'Joseph Pacheco',
      email: 'joe@pacheco.law',
      title: null,
      contactEntityId: null,
    },
  }

  it('resolved binds fill rows; manual stays an empty attorney-fillable row; keys/roles/orders survive', async () => {
    const rows = await assembleRecipientRows(config.roles, async (bind) => {
      return identities[bind] ?? { name: null, email: null, title: null, contactEntityId: null }
    })

    expect(rows.map((r) => r.signerKey)).toEqual(['client', 'attorney', 'observer'])
    expect(rows[0]).toMatchObject({
      signerKey: 'client',
      role: 'needs_to_sign',
      order: 1,
      resolved: true,
      name: 'Ana López',
      email: 'ana@example.com',
    })
    expect(rows[1]).toMatchObject({ signerKey: 'attorney', resolved: true, order: 2 })
    // manual → never invented: unresolved empty row the composer requires the
    // attorney to complete before Send.
    expect(rows[2]).toMatchObject({
      signerKey: 'observer',
      role: 'receives_copy',
      resolved: false,
      name: null,
      email: null,
    })

    // The workflow-step seed the composer consumes: keys, roles, and orders
    // intact so the body's {{type:key}} markers bind to the right signer.
    const seeds = rows.map((r) => ({
      name: r.name ?? '',
      email: r.email ?? '',
      title: r.title ?? '',
      role: r.role,
      order: r.order,
      key: r.signerKey,
    }))
    expect(seeds[0]).toEqual({
      name: 'Ana López',
      email: 'ana@example.com',
      title: 'Managing Member',
      role: 'needs_to_sign',
      order: 1,
      key: 'client',
    })
    expect(seeds.map((s) => s.order)).toEqual([1, 2, 2])
  })
})
