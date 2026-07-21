// ES-MULTIDOC-1 — the send round-trip at the API level: buildAndSubmitEnvelope
// forwards the ORDERED document set into the single esign.send payload. The
// action layer (submitAction) is mocked so this runs without a DB — it proves
// the contract the handler then persists (one envelope_of per document). A
// single-document call carries NO `documents` key (byte-identical pre-multidoc
// payload — the zero-regression guarantee at the API boundary).
import { describe, expect, it, vi, beforeEach } from 'vitest'

const submitActionMock = vi.hoisted(() => vi.fn())
vi.mock('@exsto/substrate', () => ({ submitAction: submitActionMock }))

import { buildAndSubmitEnvelope } from '../../verticals/legal/src/api/esignSend.js'

const CTX = { tenantId: '00000000-0000-0000-0000-000000000001', actorId: 'actor-1' }

function lastPayload(): Record<string, unknown> {
  const call = submitActionMock.mock.calls.at(-1)
  return (call?.[1] as { payload: Record<string, unknown> }).payload
}

describe('buildAndSubmitEnvelope — multi-document payload', () => {
  beforeEach(() => {
    submitActionMock.mockReset()
    submitActionMock.mockResolvedValue({
      effects: [
        {
          envelopeId: 'env-1',
          requestIds: ['req-1'],
          deliveredRequestIds: ['req-1'],
          status: 'sent',
          createdContacts: [],
        },
      ],
    })
  })

  it('forwards an ordered documents[] and keeps documents[0] as the primary', async () => {
    await buildAndSubmitEnvelope(CTX, {
      documentEntityId: 'docA',
      documentVersionId: 'verA',
      documents: [
        { documentEntityId: 'docA', documentVersionId: 'verA' },
        { documentEntityId: 'docB', documentVersionId: 'verB' },
        { documentEntityId: 'docC', documentVersionId: 'verC' },
      ],
      provider: 'native',
      dispatched: true,
      subject: 'Three documents',
      recipients: [{ email: 'signer@example.test', channel: 'link' }],
    })

    const payload = lastPayload()
    // The action carries every document, in order.
    expect(payload.documents).toEqual([
      { document_entity_id: 'docA', document_version_id: 'verA' },
      { document_entity_id: 'docB', document_version_id: 'verB' },
      { document_entity_id: 'docC', document_version_id: 'verC' },
    ])
    // The primary (envelope entity + single-doc readers) is documents[0].
    expect(payload.document_entity_id).toBe('docA')
    expect(payload.document_version_id).toBe('verA')
  })

  it('derives the primary from documents[0] even if the single fields disagree', async () => {
    await buildAndSubmitEnvelope(CTX, {
      // A caller that passes documents[] but stale single fields — documents wins.
      documentEntityId: 'stale',
      documentVersionId: 'stale-v',
      documents: [
        { documentEntityId: 'realA', documentVersionId: 'realA-v' },
        { documentEntityId: 'realB', documentVersionId: 'realB-v' },
      ],
      provider: 'native',
      dispatched: true,
      subject: 'Two documents',
      recipients: [{ email: 'signer@example.test', channel: 'link' }],
    })
    const payload = lastPayload()
    expect(payload.document_entity_id).toBe('realA')
    expect(payload.document_version_id).toBe('realA-v')
    expect((payload.documents as unknown[]).length).toBe(2)
  })

  it('a single-document send carries NO documents key (unchanged payload shape)', async () => {
    await buildAndSubmitEnvelope(CTX, {
      documentEntityId: 'docA',
      documentVersionId: 'verA',
      provider: 'native',
      dispatched: true,
      subject: 'One document',
      recipients: [{ email: 'signer@example.test', channel: 'link' }],
    })
    const payload = lastPayload()
    expect(payload.documents).toBeUndefined()
    expect(payload.document_entity_id).toBe('docA')
    expect(payload.document_version_id).toBe('verA')
  })

  it('an empty documents[] falls back to the single primary (no documents key)', async () => {
    await buildAndSubmitEnvelope(CTX, {
      documentEntityId: 'docA',
      documentVersionId: 'verA',
      documents: [],
      provider: 'native',
      dispatched: true,
      subject: 'One document',
      recipients: [{ email: 'signer@example.test', channel: 'link' }],
    })
    const payload = lastPayload()
    expect(payload.documents).toBeUndefined()
    expect(payload.document_entity_id).toBe('docA')
  })
})
