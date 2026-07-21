// WF-FIX-1 (WP7) — authoring-hygiene warnings on validateProposedLifecycle. All are
// WARNINGS, never rejections: existing saved graphs keep validating; the builder and
// step editor surface them so the stuck-matter shapes (the live Pacheco repro) are
// caught at authoring time. These cases avoid serviceKey and invoke_capability
// stages so the validator runs DB-free.
import { describe, it, expect } from 'vitest'
import {
  validateProposedLifecycle,
  isProducedDocumentSignable,
  graphHasEsignStep,
  type Lifecycle,
} from '@exsto/legal'

const CTX = { tenantId: '00000000-0000-0000-0000-000000000001', actorId: 'a' }

// The Pacheco v5 shape, minus the service linkage: non-blocking consultation entry,
// intake gated on transcript.received, no consultation is ever scheduled.
const STUCK_SHAPE: Lifecycle = [
  {
    key: 'consultation',
    label: 'Client consultation',
    entry: true,
    blocking: false,
    action: { kind: 'view_consultation' },
    advances_to: [{ to: 'intake', gate: 'system', on: 'transcript.received' }],
  },
  {
    key: 'intake',
    label: 'Client intake',
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

describe('validateProposedLifecycle warnings (WF-FIX-1 WP7)', () => {
  it('warns on transcript.received when nothing schedules a consultation, and on non-blocking tokens', async () => {
    const res = await validateProposedLifecycle(CTX, STUCK_SHAPE)
    expect(res.errors).toEqual([])
    expect(res.warnings.some((w) => w.includes("'intake.completed'"))).toBe(true)
    expect(res.warnings.some((w) => w.includes('informational (non-blocking)'))).toBe(true)
  })

  it('does not warn about transcript.received when the workflow books a consultation', async () => {
    const graph: Lifecycle = [
      {
        key: 'book',
        label: 'Book a consultation',
        entry: true,
        action: { kind: 'view_consultation' },
        advances_to: [{ to: 'consulted', gate: 'client', via: 'booking.create' }],
      },
      {
        key: 'consulted',
        label: 'Consultation held',
        blocking: true,
        action: { kind: 'view_consultation' },
        advances_to: [{ to: 'done', gate: 'system', on: 'transcript.received' }],
      },
      {
        key: 'done',
        label: 'Done',
        terminal: true,
        action: { kind: 'complete_matter' },
        advances_to: [],
      },
    ]
    const res = await validateProposedLifecycle(CTX, graph)
    expect(res.warnings.filter((w) => w.includes('no transcript will ever arrive'))).toEqual([])
  })

  it('warns when no step is marked terminal', async () => {
    const graph: Lifecycle = [
      {
        key: 'a',
        label: 'A',
        entry: true,
        action: { kind: 'manual_task' },
        advances_to: [{ to: 'b', gate: 'attorney', via: 'legal.matter.advance' }],
      },
      { key: 'b', label: 'B', action: { kind: 'manual_task' }, advances_to: [] },
    ]
    const res = await validateProposedLifecycle(CTX, graph)
    expect(res.warnings.some((w) => w.includes('never be completed'))).toBe(true)
  })

  it('warns on a client-gated wait that shows the client nothing to act on', async () => {
    const graph: Lifecycle = [
      {
        key: 'wait',
        label: 'Wait for the client',
        entry: true,
        action: { kind: 'manual_task' },
        advances_to: [{ to: 'done', gate: 'client', via: 'client.message.post' }],
      },
      {
        key: 'done',
        label: 'Done',
        terminal: true,
        action: { kind: 'complete_matter' },
        advances_to: [],
      },
    ]
    const res = await validateProposedLifecycle(CTX, graph)
    expect(res.warnings.some((w) => w.includes('nothing to act on'))).toBe(true)
  })

  it('a clean blocking graph with client-facing asks draws none of the new warnings', async () => {
    const graph: Lifecycle = [
      {
        key: 'intake',
        label: 'Client intake',
        entry: true,
        action: { kind: 'view_intake' },
        advances_to: [{ to: 'review', gate: 'system', on: 'intake.completed' }],
      },
      {
        key: 'review',
        label: 'Review & send the agreement',
        client_label: 'Review your agreement',
        action: { kind: 'review_send_document' },
        documents: [{ docKind: 'operating_agreement' }],
        advances_to: [{ to: 'done', gate: 'attorney', via: 'draft.approve' }],
      },
      {
        key: 'done',
        label: 'Done',
        terminal: true,
        action: { kind: 'complete_matter' },
        advances_to: [],
      },
    ]
    const res = await validateProposedLifecycle(CTX, graph)
    expect(res.errors).toEqual([])
    expect(res.warnings).toEqual([])
  })
})

// ESIGN-AUTHORING-BRIDGE — the same-turn template-signability bridge, tested at the
// pure decision level (DB-free, like the composition-contract idiom). The full
// validator/pre-gate walk needs a live firm library (listStandaloneTemplates) and is
// DB-gated elsewhere; these pin the load-bearing logic: does a produced document read
// as signable given persisted state + templates proposed earlier THIS turn.
const SERVICE = 'nc_single_member_llc_formation'
const DOC_KIND = 'operating_agreement'
const TEMPLATE_ID = 'tmpl-oa-1'

// A persisted firm template that is NOT signable (the live repro: the model just
// proposed signability, but the persisted twin still declares required:false).
const UNSIGNED_LIB = [
  {
    templateEntityId: TEMPLATE_ID,
    docKind: DOC_KIND,
    signature: { required: false, signer_roles: [] },
    esignConfig: { signable: false, roles: [] },
  },
]

// The same template, persisted as signable (the attorney approved it earlier).
const SIGNED_LIB = [
  {
    templateEntityId: TEMPLATE_ID,
    docKind: DOC_KIND,
    signature: { required: true, signer_roles: ['client'] },
    esignConfig: { signable: false, roles: [] },
  },
]

describe('isProducedDocumentSignable — same-turn template bridge', () => {
  it('(a) an esignature stage + a same-turn signable template proposal → signable', () => {
    // Persisted is unsigned, but a template proposed THIS turn (signature) marks it
    // signable — the case that dead-ended before the bridge.
    const viaSignature = isProducedDocumentSignable([TEMPLATE_ID], UNSIGNED_LIB, SERVICE, [
      {
        serviceKey: SERVICE,
        docKind: DOC_KIND,
        signature: { required: true, signer_roles: ['client'] },
      },
    ])
    expect(viaSignature).toBe(true)
    // The esignConfig shape (ES-3, supersedes signature) works the same way.
    const viaEsignConfig = isProducedDocumentSignable([TEMPLATE_ID], UNSIGNED_LIB, SERVICE, [
      { serviceKey: SERVICE, docKind: DOC_KIND, esignConfig: { signable: true } },
    ])
    expect(viaEsignConfig).toBe(true)
  })

  it('(b) no signable template anywhere → not signable (the pre-gate/error path)', () => {
    // Persisted unsigned, and the only same-turn proposal is unsigned / for another
    // docKind → nothing declares signability.
    expect(isProducedDocumentSignable([TEMPLATE_ID], UNSIGNED_LIB, SERVICE, [])).toBe(false)
    expect(
      isProducedDocumentSignable([TEMPLATE_ID], UNSIGNED_LIB, SERVICE, [
        {
          serviceKey: SERVICE,
          docKind: DOC_KIND,
          signature: { required: false, signer_roles: [] },
        },
      ]),
    ).toBe(false)
    // A signable proposal for a DIFFERENT docKind must not count.
    expect(
      isProducedDocumentSignable([TEMPLATE_ID], UNSIGNED_LIB, SERVICE, [
        { serviceKey: SERVICE, docKind: 'engagement_letter', esignConfig: { signable: true } },
      ]),
    ).toBe(false)
  })

  it('(c) a persisted-signable template still passes with no proposals', () => {
    expect(isProducedDocumentSignable([TEMPLATE_ID], SIGNED_LIB, SERVICE, undefined)).toBe(true)
    // esignConfig.signable on the persisted twin counts too.
    const esignPersisted = [
      {
        templateEntityId: TEMPLATE_ID,
        docKind: DOC_KIND,
        signature: { required: false, signer_roles: [] },
        esignConfig: { signable: true, roles: [] },
      },
    ]
    expect(isProducedDocumentSignable([TEMPLATE_ID], esignPersisted, SERVICE, undefined)).toBe(true)
  })
})

describe('graphHasEsignStep', () => {
  it('detects both the first-class esign kind and invoke_capability{esignature}', () => {
    const firstClass: Lifecycle = [
      { key: 'a', label: 'A', entry: true, action: { kind: 'esign' }, advances_to: [] },
    ]
    const capability: Lifecycle = [
      {
        key: 'a',
        label: 'A',
        entry: true,
        action: { kind: 'invoke_capability', config: { capability_slug: 'esignature' } },
        advances_to: [],
      },
    ]
    const neither: Lifecycle = [
      { key: 'a', label: 'A', entry: true, action: { kind: 'manual_task' }, advances_to: [] },
    ]
    expect(graphHasEsignStep(firstClass)).toBe(true)
    expect(graphHasEsignStep(capability)).toBe(true)
    expect(graphHasEsignStep(neither)).toBe(false)
  })
})
