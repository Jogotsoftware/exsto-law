'use client'

// Public e-signature page (native sign-by-link). The signer arrives via the
// secure token in their emailed link, reviews the document, adopts a typed
// signature with explicit ESIGN/UETA consent, and signs — or declines. No
// session: the token IS the auth (delivered only to the signer's inbox).
import { use, useEffect, useState } from 'react'
import { renderMarkdown } from '@/lib/draftExport'

interface SignableDocument {
  documentTitle: string
  bodyMarkdown: string
  signerName: string | null
  signerEmail: string | null
  envelopeStatus: string | null
  signerStatus: string | null
  alreadyResolved: boolean
}

const CONSENT_TEXT =
  'I agree to sign this document electronically and that my electronic signature ' +
  'is the legal equivalent of my handwritten signature (ESIGN / UETA).'

export default function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [doc, setDoc] = useState<SignableDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [signatureName, setSignatureName] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState<null | 'sign' | 'decline'>(null)
  const [done, setDone] = useState<null | 'signed' | 'completed' | 'declined'>(null)

  useEffect(() => {
    fetch('/api/sign/load', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? 'This signing link is invalid or expired.')
        setDoc(data.document as SignableDocument)
        if (data.document?.signerName) setSignatureName(data.document.signerName)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [token])

  async function submit() {
    setBusy('sign')
    setError(null)
    try {
      const r = await fetch('/api/sign/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, signatureName, consent: CONSENT_TEXT }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? 'Could not record your signature.')
      setDone(data.completed ? 'completed' : 'signed')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function decline() {
    if (typeof window !== 'undefined' && !window.confirm('Decline to sign this document?')) return
    setBusy('decline')
    setError(null)
    try {
      const r = await fetch('/api/sign/decline', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? 'Could not record your decision.')
      setDone('declined')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (error && !doc) {
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

  if (done) {
    const msg =
      done === 'declined'
        ? 'You declined to sign. The firm has been notified.'
        : done === 'completed'
          ? 'Signed. All parties have now signed — the executed copy has been filed to your matter.'
          : 'Signed. Thank you — we’ll let you know when all parties have signed.'
    return (
      <div className="public-draft">
        <div className="public-draft-head">
          <div>
            <div className="public-draft-firm">Pacheco Law</div>
            <h1 style={{ margin: 'var(--space-1) 0 0' }}>{doc.documentTitle}</h1>
          </div>
        </div>
        <div className={`alert ${done === 'declined' ? 'alert-error' : 'alert-success'}`}>
          {msg}
        </div>
      </div>
    )
  }

  if (doc.alreadyResolved) {
    return (
      <div className="public-draft">
        <div className="public-draft-head">
          <div>
            <div className="public-draft-firm">Pacheco Law</div>
            <h1 style={{ margin: 'var(--space-1) 0 0' }}>{doc.documentTitle}</h1>
          </div>
        </div>
        <div className="alert">
          This request has already been {doc.signerStatus === 'declined' ? 'declined' : 'completed'}
          . No further action is needed.
        </div>
      </div>
    )
  }

  return (
    <div className="public-draft">
      <div className="public-draft-head">
        <div>
          <div className="public-draft-firm">Pacheco Law</div>
          <h1 style={{ margin: 'var(--space-1) 0 0' }}>{doc.documentTitle}</h1>
          <div className="text-sm text-muted" style={{ marginTop: 'var(--space-1)' }}>
            For signature{doc.signerName ? ` by ${doc.signerName}` : ''}
            {doc.signerEmail ? ` (${doc.signerEmail})` : ''}
          </div>
        </div>
      </div>

      <div
        className="doc-rendered"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.bodyMarkdown) }}
      />

      <div className="sign-panel" style={{ marginTop: 'var(--space-4)' }}>
        <label className="text-sm" htmlFor="sig">
          Type your full legal name to adopt your signature
        </label>
        <input
          id="sig"
          type="text"
          value={signatureName}
          onChange={(e) => setSignatureName(e.target.value)}
          placeholder="Your full name"
          style={{ display: 'block', width: '100%', marginTop: 'var(--space-1)' }}
        />
        <label
          className="text-sm"
          style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}
        >
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{CONSENT_TEXT}</span>
        </label>

        {error && (
          <div className="alert alert-error" style={{ marginTop: 'var(--space-2)' }}>
            {error}
          </div>
        )}

        <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
          <button
            className="ok"
            disabled={busy !== null || !signatureName.trim() || !consent}
            onClick={submit}
          >
            {busy === 'sign' && <span className="spinner" />}
            {busy === 'sign' ? 'Signing…' : 'Adopt & Sign'}
          </button>
          <button className="danger" disabled={busy !== null} onClick={decline}>
            {busy === 'decline' ? 'Declining…' : 'Decline'}
          </button>
        </div>
      </div>
    </div>
  )
}
