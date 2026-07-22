'use client'

// ESIGN-ATTORNEY-REVIEW-1 — attorney signing surface: the attorney signs their
// OWN countersignature request (added via #476) in-app, instead of only being
// able to view status. Mirrors app/portal/sign/[requestId]/page.tsx, but calls
// the attorney MCP route (legal.esign.sign_load / sign_submit / sign_decline)
// instead of the client-portal one. Reuses the shared SignDocument surface.
import { use, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { SignDocument, type SignableDoc } from '@/components/SignDocument'

export default function AttorneySignPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = use(params)
  const [doc, setDoc] = useState<(SignableDoc & { envelopeId: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callAttorneyMcp<SignableDoc & { envelopeId: string }>({
      toolName: 'legal.esign.sign_load',
      input: { requestId },
    })
      .then((r) => setDoc(r))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [requestId])

  if (error)
    return (
      <div className="page">
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      </div>
    )
  if (!doc)
    return (
      <div className="page">
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      </div>
    )

  return (
    <div className="page">
      <SignDocument
        doc={doc}
        fileUrl={doc.isFile ? `/api/attorney/esign/${doc.envelopeId}/file` : null}
        // ES-MULTIDOC-1 — each document streams through the attorney file
        // route with its ?doc=N index; markdown documents render inline.
        fileUrlForDoc={(i) => `/api/attorney/esign/${doc.envelopeId}/file?doc=${i}`}
        onSign={async ({ signatureName, signatureData, fieldValues, consent }) => {
          const r = await callAttorneyMcp<{ completed: boolean }>({
            toolName: 'legal.esign.sign_submit',
            input: { requestId, signatureName, signatureData, fieldValues, consent },
          })
          return { completed: Boolean(r.completed) }
        }}
        onDecline={async () => {
          await callAttorneyMcp({
            toolName: 'legal.esign.sign_decline',
            input: { requestId },
          })
        }}
      />
    </div>
  )
}
