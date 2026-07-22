// esign-executed-copy-complete — the shared executed-copy stamping helper
// (lib/esignStamping.ts), extracted from /api/sign/submit so the client-portal
// sign route can run the SAME loop (the bug this fix closes: a portal-signed
// envelope never got its `.executed.pdf`). Storage and the PDF stamper are
// mocked — this exercises the helper's OWN plan-handling logic: per-plan
// best-effort (one failure never drops the rest), the upload key/content-type
// it writes, and the docIndex→bytes map it hands to the completion-email step.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ExecutedStampPlan } from '@exsto/legal'

const stampExecutedPdfMock = vi.hoisted(() => vi.fn())
vi.mock('@exsto/legal', () => ({ stampExecutedPdf: stampExecutedPdfMock }))

const downloadObjectMock = vi.hoisted(() => vi.fn())
const uploadObjectMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/documentStorage', () => ({
  downloadObject: downloadObjectMock,
  uploadObject: uploadObjectMock,
}))

import { stampExecutedCopies, stampedBytesByDocIndex } from '../lib/esignStamping'

function plan(overrides: Partial<ExecutedStampPlan> = {}): ExecutedStampPlan {
  return {
    envelopeId: 'env-1',
    docIndex: 0,
    objectKey: 'tenant/doc.pdf',
    executedObjectKey: 'tenant/doc.pdf.executed.pdf',
    filename: 'doc.pdf',
    fields: [],
    certificate: {
      envelopeId: 'env-1',
      filename: 'doc.pdf',
      signers: [],
    } as unknown as ExecutedStampPlan['certificate'],
    ...overrides,
  }
}

describe('stampExecutedCopies', () => {
  beforeEach(() => {
    downloadObjectMock.mockReset()
    uploadObjectMock.mockReset()
    stampExecutedPdfMock.mockReset()
  })

  it('downloads the original, stamps it, and uploads to the derived executed key', async () => {
    downloadObjectMock.mockResolvedValue(Buffer.from('original-bytes'))
    stampExecutedPdfMock.mockResolvedValue(new Uint8Array([1, 2, 3]))
    uploadObjectMock.mockResolvedValue(undefined)

    const p = plan()
    const stamped = await stampExecutedCopies([p])

    expect(downloadObjectMock).toHaveBeenCalledWith('tenant/doc.pdf')
    expect(stampExecutedPdfMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pdfBytes: expect.any(Buffer),
        fields: p.fields,
        certificate: p.certificate,
      }),
    )
    expect(uploadObjectMock).toHaveBeenCalledWith(
      'tenant/doc.pdf.executed.pdf',
      expect.any(Buffer),
      'application/pdf',
    )
    expect(stamped).toHaveLength(1)
    expect(stamped[0]!.plan).toBe(p)
    expect(Array.from(stamped[0]!.bytes)).toEqual([1, 2, 3])
  })

  it('is best-effort per document: one failing plan never drops the others', async () => {
    downloadObjectMock
      .mockRejectedValueOnce(new Error('storage down'))
      .mockResolvedValueOnce(Buffer.from('ok'))
    stampExecutedPdfMock.mockResolvedValue(new Uint8Array([9]))
    uploadObjectMock.mockResolvedValue(undefined)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const bad = plan({ docIndex: 0, objectKey: 'tenant/bad.pdf' })
    const good = plan({ docIndex: 1, objectKey: 'tenant/good.pdf' })
    const stamped = await stampExecutedCopies([bad, good])

    expect(stamped).toHaveLength(1)
    expect(stamped[0]!.plan).toBe(good)
    expect(uploadObjectMock).toHaveBeenCalledTimes(1)
    errSpy.mockRestore()
  })

  it('returns an empty array (never throws) when every plan fails', async () => {
    downloadObjectMock.mockRejectedValue(new Error('storage down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const stamped = await stampExecutedCopies([plan()])

    expect(stamped).toEqual([])
    errSpy.mockRestore()
  })

  it('handles an empty plan list without touching Storage', async () => {
    const stamped = await stampExecutedCopies([])
    expect(stamped).toEqual([])
    expect(downloadObjectMock).not.toHaveBeenCalled()
    expect(uploadObjectMock).not.toHaveBeenCalled()
  })
})

describe('stampedBytesByDocIndex', () => {
  it('keys the stamped bytes by each plan.docIndex', () => {
    const a = { plan: plan({ docIndex: 0 }), bytes: Buffer.from('a') }
    const b = { plan: plan({ docIndex: 2 }), bytes: Buffer.from('b') }
    const map = stampedBytesByDocIndex([a, b])
    expect(map.get(0)).toBe(a.bytes)
    expect(map.get(2)).toBe(b.bytes)
    expect(map.has(1)).toBe(false)
  })

  it('returns an empty map for no stamped copies', () => {
    expect(stampedBytesByDocIndex([]).size).toBe(0)
  })
})
