// STEP-EDITOR-1 — the two manual step editors must round-trip a saved workflow graph
// LOSSLESSLY and emit a graph the legal.matter.set_workflow validator accepts.
//
// Regression target: the per-matter editor used to rebuild every edge as
// `{ gate: <catalog default>, via: 'legal.matter.advance' }`, dropping the `on` event
// off an automatic edge (→ an INVALID graph the validator rejects) and rewriting every
// gate/trigger; the service editor dropped every stage's action.config (killing an
// invoke_capability step's capability_slug + capability_config). Both are fixed by
// preserving the saved structure. These tests run the REAL validator (@exsto/legal)
// against the REAL NC Will Drafting v5 graph.
import { describe, it, expect } from 'vitest'
import { validateLifecycle, validateLinearLifecycle } from '@exsto/legal'
import {
  buildMatterGraph,
  type CatalogGate,
} from '../../apps/legal-demo/app/attorney/matters/[id]/workflowGraph'
import {
  graphToSteps,
  stepsToGraph,
  type WfLifecycle,
} from '../../apps/legal-demo/app/attorney/services/[serviceKey]/workflow/workflowBuilderModel'

// The live, valid graph from workflow_definition de68d039 v5 (NC Will Drafting): five
// stages, generate_will→review_send_will on:document.generated (the automatic edge),
// and client_response — an invoke_capability step carrying capability_config.
const V5: WfLifecycle = [
  {
    key: 'client_intake',
    entry: true,
    label: 'Client intake',
    action: { kind: 'view_intake' },
    advances_to: [{ to: 'generate_will', via: 'document.upload', gate: 'client' }],
  },
  {
    key: 'generate_will',
    label: 'Draft the will',
    action: { kind: 'generate_document' },
    documents: [{ label: 'NC Last Will and Testament', docKind: 'last_will_and_testament' }],
    advances_to: [{ on: 'document.generated', to: 'review_send_will', gate: 'automatic' }],
  },
  {
    key: 'review_send_will',
    label: 'Review & send the will',
    action: { kind: 'review_send_document' },
    documents: [{ label: 'NC Last Will and Testament', docKind: 'last_will_and_testament' }],
    advances_to: [{ to: 'client_response', via: 'draft.approve', gate: 'attorney' }],
  },
  {
    key: 'client_response',
    label: 'Client reviews the draft',
    action: {
      kind: 'invoke_capability',
      config: {
        capability_slug: 'request_client_materials',
        capability_config: {
          message:
            "Your draft will is ready to review. Please look it over and let us know: reply here with any changes you'd like, or send a message to accept the draft as-is.",
        },
      },
    },
    advances_to: [{ to: 'complete', via: 'client.message.post', gate: 'client' }],
    client_label: 'Review your draft will',
  },
  {
    key: 'complete',
    label: 'Complete matter',
    action: { kind: 'complete_matter' },
    terminal: true,
    advances_to: [],
  },
]

// The closed catalog gates the per-matter builder consults for a freshly-added step.
const CATALOG: CatalogGate[] = [
  { kind: 'view_intake', defaultGate: 'client' },
  { kind: 'view_consultation', defaultGate: 'attorney' },
  { kind: 'generate_document', defaultGate: 'automatic' },
  { kind: 'review_send_document', defaultGate: 'attorney' },
  { kind: 'approve_send_invoice', defaultGate: 'attorney' },
  { kind: 'await_payment', defaultGate: 'system' },
  { kind: 'manual_task', defaultGate: 'attorney' },
  { kind: 'complete_matter', defaultGate: 'system' },
  { kind: 'invoke_capability', defaultGate: 'attorney' },
]

// The validator's Lifecycle type is the server's; our fixtures are the wire mirror.
// Structurally identical — cast at the boundary so the test stays app-type-free.
type Lc = Parameters<typeof validateLifecycle>[0]
const valid = (g: unknown) => {
  const structural = validateLifecycle(g as Lc)
  const linear = validateLinearLifecycle(g as Lc)
  return { errors: [...structural.errors, ...linear.errors], ok: structural.ok && linear.ok }
}

describe('STEP-EDITOR-1 — v5 is a valid fixture', () => {
  it('the live v5 graph validates', () => {
    expect(valid(V5).errors).toEqual([])
  })
})

describe('NEW-E — per-matter editor round-trips losslessly (acceptance A/B)', () => {
  it('unchanged v5 rebuilds IDENTICAL and valid (A)', () => {
    const out = buildMatterGraph(V5, CATALOG)
    expect(valid(out).errors).toEqual([]) // no dropped `on`, no invalid edge
    expect(out).toEqual(V5) // byte-faithful: no drift, no rewritten gate/via
  })

  it('injects/duplicates NO node — exactly one generate_document survives', () => {
    const out = buildMatterGraph(V5, CATALOG)
    expect(out).toHaveLength(5)
    expect(out.filter((s) => s.action?.kind === 'generate_document')).toHaveLength(1)
  })

  it('the automatic edge KEEPS its `on` event (not rewritten to via)', () => {
    const out = buildMatterGraph(V5, CATALOG)
    const edge = out.find((s) => s.key === 'generate_will')!.advances_to[0]
    expect(edge.gate).toBe('automatic')
    expect(edge.on).toBe('document.generated')
    expect(edge.via).toBeUndefined()
  })

  it('reordering keeps every automatic edge valid — `on` preserved (B)', () => {
    // Move review_send_will ahead of generate_will.
    const reordered = [V5[0], V5[2], V5[1], V5[3], V5[4]]
    const out = buildMatterGraph(reordered, CATALOG)
    expect(valid(out).errors).toEqual([])
    const gen = out.find((s) => s.key === 'generate_will')!.advances_to[0]
    expect(gen).toMatchObject({
      gate: 'automatic',
      on: 'document.generated',
      to: 'client_response',
    })
    expect(gen.via).toBeUndefined()
  })

  it('adding a step saves a VALID graph; the new step gets a valid default edge (B)', () => {
    const added = [
      V5[0],
      V5[1],
      V5[2],
      {
        key: 'paralegal_review',
        label: 'Paralegal review',
        action: { kind: 'manual_task' as const },
        advances_to: [],
      },
      V5[3],
      V5[4],
    ]
    const out = buildMatterGraph(added, CATALOG)
    expect(valid(out).errors).toEqual([])
    // The automatic edge is still intact after the insert.
    expect(out.find((s) => s.key === 'generate_will')!.advances_to[0].on).toBe('document.generated')
    // The new step advances via an attorney action (catalog default), a valid edge.
    const inserted = out.find((s) => s.key === 'paralegal_review')!.advances_to[0]
    expect(inserted).toMatchObject({
      to: 'client_response',
      gate: 'attorney',
      via: 'legal.matter.advance',
    })
  })
})

describe('NEW-E — service editor round-trips losslessly (acceptance A/D)', () => {
  it('graphToSteps → stepsToGraph reproduces v5 (no config loss)', () => {
    const rt = stepsToGraph(graphToSteps(V5))
    expect(valid(rt).errors).toEqual([])
    expect(rt).toEqual(V5)
  })

  it('preserves the invoke_capability config (capability_slug + capability_config)', () => {
    const rt = stepsToGraph(graphToSteps(V5))
    const step = rt.find((s) => s.key === 'client_response')!
    expect(step.action?.config).toEqual({
      capability_slug: 'request_client_materials',
      capability_config: {
        message: expect.stringContaining('Your draft will is ready'),
      },
    })
  })
})

describe('NEW-G — step config is editable in place and round-trips (acceptance C)', () => {
  it('editing a capability step rubric/message is reflected after save (service)', () => {
    const steps = graphToSteps(V5)
    // Simulate the CapabilityConfigEditor: replace the capability_config message.
    const edited = steps.map((s) =>
      s.actionKind === 'invoke_capability'
        ? {
            ...s,
            config: { ...s.config, capability_config: { message: 'Please review and reply.' } },
          }
        : s,
    )
    const out = stepsToGraph(edited)
    expect(valid(out).errors).toEqual([])
    const cfg = out.find((s) => s.key === 'client_response')!.action?.config as {
      capability_config: { message: string }
    }
    expect(cfg.capability_config.message).toBe('Please review and reply.')
  })

  it('editing a step config survives the per-matter rebuild', () => {
    // Simulate updateStage: edit the capability step's message in place.
    const edited = V5.map((s) =>
      s.action?.kind === 'invoke_capability'
        ? {
            ...s,
            action: {
              ...s.action,
              config: { ...(s.action.config as object), capability_config: { message: 'Edited.' } },
            },
          }
        : s,
    )
    const out = buildMatterGraph(edited, CATALOG)
    expect(valid(out).errors).toEqual([])
    const cfg = out.find((s) => s.key === 'client_response')!.action?.config as {
      capability_config: { message: string }
    }
    expect(cfg.capability_config.message).toBe('Edited.')
  })
})
