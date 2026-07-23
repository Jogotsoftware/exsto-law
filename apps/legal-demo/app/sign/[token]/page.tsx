'use client'

// Public e-signature page — the LINK fallback for non-portal signers. The signer
// arrives via the secure token in their emailed link. (Portal clients sign in the
// authenticated portal instead.) Uses the shared SignDocument surface.
import { use, useEffect, useState } from 'react'
import { SignDocument, type SavedSignature, type SignableDoc } from '@/components/SignDocument'
import { readDevSession } from '@/lib/auth'

// If the person opening the link is a signed-in ATTORNEY, their standing
// signature (Settings → Signature) prefills the surface — but only on their OWN
// request (account email must match the signer email). Raw fetch on purpose:
// callAttorneyMcp redirects the whole page on 401, and most visitors here are
// anonymous clients who must see zero change. Any failure — not signed in, no
// saved signature, slow route — resolves to null.
async function probeSavedSignature(signerEmail: string | null): Promise<SavedSignature | null> {
  if (!signerEmail) return null
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (process.env.NODE_ENV !== 'production') {
      const dev = readDevSession()
      if (dev) {
        headers['x-actor-id'] = dev.actorId
        headers['x-tenant-id'] = dev.tenantId
      }
    }
    const probe = fetch('/api/attorney/mcp', {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify({ toolName: 'legal.settings.attorney_signature.get' }),
    })
    // Never hold an anonymous signer hostage to the attorney route.
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))
    const res = await Promise.race([probe, timeout])
    if (!res || !res.ok) return null
    const data = (await res.json()) as {
      result?: { signature?: SavedSignature | null; attorneyEmail?: string | null }
    }
    const { signature, attorneyEmail } = data.result ?? {}
    if (!signature || !attorneyEmail) return null
    return attorneyEmail.toLowerCase() === signerEmail.toLowerCase() ? signature : null
  } catch {
    return null
  }
}

export default function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [doc, setDoc] = useState<SignableDoc | null>(null)
  const [saved, setSaved] = useState<SavedSignature | null | undefined>(undefined)
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
        const loaded = data.document as SignableDoc
        setDoc(loaded)
        setSaved(await probeSavedSignature(loaded.signerEmail))
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
      })
  }, [token])

  if (error) {
    return (
      <div className="public-draft">
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      </div>
    )
  }
  if (!doc || saved === undefined) {
    return (
      <div className="public-draft">
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      </div>
    )
  }

  return (
    <SignDocument
      doc={doc}
      fileUrl={doc.isFile ? `/api/sign/file?token=${encodeURIComponent(token)}` : null}
      // ES-MULTIDOC-1 — each document streams through the token file route with
      // its ?doc=N index; markdown documents ignore the URL and render inline.
      fileUrlForDoc={(i) => `/api/sign/file?token=${encodeURIComponent(token)}&doc=${i}`}
      savedSignature={saved}
      onSign={async ({ signatureName, signatureData, fieldValues, consent }) => {
        const r = await fetch('/api/sign/submit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, signatureName, signatureData, fieldValues, consent }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? 'Could not record your signature.')
        return {
          completed: Boolean(data.completed),
          awaitingAddDecision: Boolean(data.awaitingAddDecision),
        }
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
      onAddSigner={async ({ name, email }) => {
        const r = await fetch('/api/sign/add-signer', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, name, email }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? 'Could not add the next signer.')
      }}
      onFinishSigning={async () => {
        const r = await fetch('/api/sign/finish', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? 'Could not finish the envelope.')
        return { completed: Boolean(data.completed) }
      }}
    />
  )
}
