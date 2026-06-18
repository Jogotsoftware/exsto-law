'use client'

// Public e-signature page — the LINK fallback for non-portal signers. The signer
// arrives via the secure token in their emailed link. (Portal clients sign in the
// authenticated portal instead.) Uses the shared SignDocument surface.
import { use, useEffect, useState } from 'react'
import { SignDocument, type SignableDoc } from '@/components/SignDocument'

export default function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [doc, setDoc] = useState<SignableDoc | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/sign/load', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? 'This signing link is invalid or expired.')
        setDoc(data.document as SignableDoc)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [token])

  if (error) {
    return (
      <div className="public-draft">
        <div className="alert alert-error">{error}</div>
      </div>
    )
  }
  if (!doc) {
    return (
      <div className="public-draft">
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      </div>
    )
  }

  return (
    <SignDocument
      doc={doc}
      onSign={async ({ signatureName, fieldValues, consent }) => {
        const r = await fetch('/api/sign/submit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, signatureName, fieldValues, consent }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? 'Could not record your signature.')
        return { completed: Boolean(data.completed) }
      }}
      onDecline={async () => {
        const r = await fetch('/api/sign/decline', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? 'Could not record your decision.')
      }}
    />
  )
}
