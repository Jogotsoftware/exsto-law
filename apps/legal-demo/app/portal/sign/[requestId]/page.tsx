'use client'

// Client portal — sign one document (authenticated). The client reviews, fills
// their fields, and signs through the portal session (no token). Reuses the
// shared SignDocument surface.
import { use, useEffect, useState } from 'react'
import { callClientPortalMcp } from '@/lib/mcpClientPortal'
import { SignDocument, type SignableDoc } from '@/components/SignDocument'

export default function PortalSignPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = use(params)
  const [doc, setDoc] = useState<SignableDoc | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callClientPortalMcp<{ document: SignableDoc }>({
      toolName: 'legal.esign.portal.load',
      input: { requestId },
    })
      .then((r) => setDoc(r.document))
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
        onSign={async ({ signatureName, fieldValues, consent }) => {
          const r = await callClientPortalMcp<{ completed: boolean }>({
            toolName: 'legal.esign.portal.sign',
            input: { requestId, signatureName, fieldValues, consent },
          })
          return { completed: Boolean(r.completed) }
        }}
        onDecline={async () => {
          await callClientPortalMcp({
            toolName: 'legal.esign.portal.decline',
            input: { requestId },
          })
        }}
      />
    </div>
  )
}
