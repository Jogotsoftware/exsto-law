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
import { validateLifecycle, validateLinearLifecycle, diagnoseEdgeTransition } from '@exsto/legal'
import {
  buildMatterGraph,
  type CatalogGate,
} from '../../apps/legal-demo/app/attorney/matters/[id]/workflowGraph'
import {
  graphToSteps,
  stepsToGraph,
  defaultTrigger,
  type WfGate,
  type WfActionKind,
  type WfLifecycle,
} from '../../apps/legal-demo/lib/workflowBuilderModel'

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

// A legacy graph whose edges carry tokens OUTSIDE the gate-transition vocabulary —
// including the old dead 'event' default — must survive load+save byte-identically:
// the builder model never rewrites a trigger it didn't edit. (Saving it is the
// SERVER's call to reject — see the P12 save-guard test.)
const LEGACY: WfLifecycle = [
  {
    key: 'client_intake',
    entry: true,
    label: 'Client intake',
    action: { kind: 'view_intake' },
    advances_to: [{ to: 'hold_for_filing', via: 'client.submits.paperwork', gate: 'client' }],
  },
  {
    key: 'hold_for_filing',
    label: 'Hold for filing',
    action: { kind: 'manual_task' },
    advances_to: [{ to: 'complete', on: 'event', gate: 'system' }],
  },
  {
    key: 'complete',
    label: 'Complete matter',
    action: { kind: 'complete_matter' },
    terminal: true,
    advances_to: [],
  },
]

describe('P8 — off-vocabulary triggers round-trip losslessly (the "Current:" pathway is UI-only)', () => {
  it('an off-vocabulary via/on survives graphToSteps → stepsToGraph byte-identically', () => {
    const rt = stepsToGraph(graphToSteps(LEGACY))
    expect(valid(rt).errors).toEqual([])
    expect(rt).toEqual(LEGACY)
  })
})

describe('P8/P12 — defaultTrigger never emits a dead token (keyed off the PRECEDING step)', () => {
  const gates: WfGate[] = ['automatic', 'attorney', 'client', 'system']
  const kinds: WfActionKind[] = [
    'view_intake',
    'view_consultation',
    'generate_document',
    'review_send_document',
    'approve_send_invoice',
    'await_payment',
    'manual_task',
    'complete_matter',
    'invoke_capability',
  ]

  it("never returns 'event' or 'condition' for any gate × preceding kind", () => {
    for (const g of gates) {
      for (const k of kinds) {
        const t = defaultTrigger(g, k)
        expect(t).not.toBe('event')
        expect(t).not.toBe('condition')
      }
    }
  })

  it('the incoming default derives from what completes the PRECEDING step, else empty', () => {
    // A step after an invoice step is reached when the invoice is paid.
    expect(defaultTrigger('system', 'approve_send_invoice')).toBe('invoice.paid')
    expect(defaultTrigger('system', 'await_payment')).toBe('invoice.paid')
    // A step after the e-signature capability is reached when the envelope completes.
    expect(defaultTrigger('system', 'invoke_capability', { capability_slug: 'esignature' })).toBe(
      'esign.completed',
    )
    expect(
      defaultTrigger('system', 'invoke_capability', {
        capability_slug: 'request_client_materials',
      }),
    ).toBe('')
    expect(defaultTrigger('system', 'invoke_capability')).toBe('')
    expect(defaultTrigger('system', 'manual_task')).toBe('')
    expect(defaultTrigger('automatic', 'generate_document')).toBe('')
    // A step after a review step is reached by the attorney's approval; any other
    // attorney gate defaults to the generic Continue action.
    expect(defaultTrigger('attorney', 'review_send_document')).toBe('draft.approve')
    expect(defaultTrigger('attorney', 'manual_task')).toBe('legal.matter.advance')
    expect(defaultTrigger('attorney')).toBe('legal.matter.advance')
  })

  it('an empty default is left OFF the saved edge, never written as ""', () => {
    const steps = graphToSteps(V5)
    // Regate a middle step's INCOMING edge to system with a blank trigger, where the
    // preceding step (generate_document) yields no default: the saved edge must OMIT
    // `on` (so the validator's missing-'on' check fires) rather than carry a dead or
    // empty token.
    const edited = steps.map((s) =>
      s.key === 'review_send_will' ? { ...s, gate: 'system' as WfGate, trigger: '' } : s,
    )
    const out = stepsToGraph(edited)
    const edge = out.find((s) => s.key === 'generate_will')!.advances_to[0]
    expect(edge.to).toBe('review_send_will')
    expect(edge.on).toBeUndefined()
    expect(edge.via).toBeUndefined()
    expect(valid(out).ok).toBe(false)
  })
})

describe('P12 — reorder is an edge re-thread: (gate, trigger) travels with its TARGET step', () => {
  it("swapping two middle steps keeps each step's INCOMING trigger and re-points `to`", () => {
    const steps = graphToSteps(V5)
    // move() is a pure adjacent swap; swap generate_will ↔ review_send_will.
    const swapped = [steps[0], steps[2], steps[1], steps[3], steps[4]]
    const out = stepsToGraph(swapped)
    expect(valid(out).errors).toEqual([])
    // review_send_will is still reached on document.generated (its pair moved with it)…
    expect(out[0].advances_to[0]).toEqual({
      to: 'review_send_will',
      gate: 'automatic',
      on: 'document.generated',
    })
    // …and generate_will is still reached via the client's upload.
    expect(out[1].advances_to[0]).toEqual({
      to: 'generate_will',
      gate: 'client',
      via: 'document.upload',
    })
    // The rest of the chain keeps its incoming pairs, `to` re-pointed by position.
    expect(out[2].advances_to[0]).toEqual({
      to: 'client_response',
      gate: 'attorney',
      via: 'draft.approve',
    })
    expect(out[3].advances_to[0]).toEqual({
      to: 'complete',
      gate: 'client',
      via: 'client.message.post',
    })
  })

  it('a step moved to LAST keeps its (gate, trigger) — nothing is silently dropped', () => {
    const steps = graphToSteps(V5)
    // Move client_response to the end (complete slides up). Under the old
    // source-anchoring this dropped client_response's pair entirely (a terminal
    // writes no outgoing edge) and invented a default for the former terminal.
    const moved = [steps[0], steps[1], steps[2], steps[4], steps[3]]
    const out = stepsToGraph(moved)
    expect(valid(out).errors).toEqual([])
    // complete is reached exactly as before…
    expect(out[2].advances_to[0]).toEqual({
      to: 'complete',
      gate: 'client',
      via: 'client.message.post',
    })
    // …and client_response KEEPS its attorney/draft.approve pair as the incoming
    // edge of the new terminal.
    expect(out[3].advances_to[0]).toEqual({
      to: 'client_response',
      gate: 'attorney',
      via: 'draft.approve',
    })
    expect(out[4].key).toBe('client_response')
    expect(out[4].terminal).toBe(true)
    expect(out[4].advances_to).toEqual([])
  })

  it('an unreachable stage appends defensively with a sane default pair and saves valid', () => {
    const withOrphan: WfLifecycle = [
      ...V5,
      // Not referenced by any edge — the load walk can't reach it.
      {
        key: 'paralegal_check',
        label: 'Paralegal check',
        action: { kind: 'manual_task' },
        advances_to: [],
      },
    ]
    const steps = graphToSteps(withOrphan)
    expect(steps).toHaveLength(6)
    const orphan = steps[5]
    expect(orphan.key).toBe('paralegal_check')
    expect(orphan.gate).toBe('attorney')
    expect(orphan.trigger).toBe('')
    const out = stepsToGraph(steps)
    // The former terminal now advances into the appended stage via the attorney
    // default (a REAL token, preceding complete_matter yields the generic advance).
    expect(out[4].advances_to[0]).toEqual({
      to: 'paralegal_check',
      gate: 'attorney',
      via: 'legal.matter.advance',
    })
    expect(out[5].terminal).toBe(true)
    expect(valid(out).errors).toEqual([])
  })

  it('a system step AFTER an e-signature capability defaults its incoming `on` to esign.completed', () => {
    const steps = graphToSteps(V5).map((s) => {
      if (s.key === 'client_response')
        return { ...s, config: { capability_slug: 'esignature', capability_config: {} } }
      if (s.key === 'complete') return { ...s, gate: 'system' as WfGate, trigger: '' }
      return s
    })
    const out = stepsToGraph(steps)
    expect(out.find((s) => s.key === 'client_response')!.advances_to[0]).toEqual({
      to: 'complete',
      gate: 'system',
      on: 'esign.completed',
    })
    expect(valid(out).errors).toEqual([])
  })

  it('the save guard rejects the legacy dead tokens the model faithfully preserved', () => {
    // Mirrors the legal.service.set_lifecycle handler's new vocabulary check: the
    // builder never rewrites an off-vocabulary trigger (see the P8 LEGACY test), but
    // saving one is now rejected with an actionable, per-edge message.
    const rt = stepsToGraph(graphToSteps(LEGACY))
    const errors = rt.flatMap((s) =>
      s.advances_to.flatMap((e) => {
        const msg = diagnoseEdgeTransition(
          s.key,
          e.to,
          e.gate as Parameters<typeof diagnoseEdgeTransition>[2],
          e.via,
          e.on,
        )
        return msg ? [msg] : []
      }),
    )
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('"client.submits.paperwork"')
    expect(errors[1]).toContain('"event"')
    expect(errors[1]).toContain('not a real advance token')
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
