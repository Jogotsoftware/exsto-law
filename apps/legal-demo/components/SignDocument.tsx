'use client'

// Shared signing surface used by BOTH the authenticated portal sign page and the
// public token-link fallback page. Renders the document, the signer's fields,
// the adopted-signature input + ESIGN/UETA consent, and Sign / Decline. The
// caller supplies onSign/onDecline (portal MCP vs /api/sign routes).
import { useState } from 'react'
import { renderMarkdown } from '@/lib/draftExport'

export interface SignField {
  id: string
  type: string
  label: string
  prefill?: string
}
export interface SignableDoc {
  documentTitle: string
  bodyMarkdown: string
  signerName: string | null
  signerEmail: string | null
  signerTitle: string | null
  signerStatus: string
  envelopeStatus: string | null
  fields: SignField[]
  canSign: boolean
  alreadyResolved: boolean
}

export const CONSENT_TEXT =
  'I agree to sign this document electronically and that my electronic signature ' +
  'is the legal equivalent of my handwritten signature (ESIGN / UETA).'

export function SignDocument({
  doc,
  onSign,
  onDecline,
}: {
  doc: SignableDoc
  onSign: (a: {
    signatureName: string
    fieldValues: Record<string, string>
    consent: string
  }) => Promise<{ completed: boolean }>
  onDecline: () => Promise<void>
}) {
  const [signatureName, setSignatureName] = useState(doc.signerName ?? '')
  const [consent, setConsent] = useState(false)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(doc.fields.filter((f) => f.prefill).map((f) => [f.id, f.prefill!])),
  )
  const [busy, setBusy] = useState<null | 'sign' | 'decline'>(null)
  const [done, setDone] = useState<null | 'signed' | 'completed' | 'declined'>(null)
  const [error, setError] = useState<string | null>(null)

  // Fields the signer actually fills here (the adopted signature covers {{sign:…}}).
  const inputFields = doc.fields.filter((f) => f.type !== 'sign')

  function head() {
    return (
      <div className="public-draft-head">
        <div>
          <div className="public-draft-firm">Pacheco Law</div>
          <h1 style={{ margin: 'var(--space-1) 0 0' }}>{doc.documentTitle}</h1>
        </div>
      </div>
    )
  }

  if (done) {
    const msg =
      done === 'declined'
        ? 'You declined to sign. The firm has been notified.'
        : done === 'completed'
          ? 'Signed. All parties have now signed — the executed copy has been filed to the matter.'
          : 'Signed. Thank you — we’ll let you know when the remaining parties have signed.'
    return (
      <div className="public-draft">
        {head()}
        <div className={`alert ${done === 'declined' ? 'alert-error' : 'alert-success'}`}>
          {msg}
        </div>
      </div>
    )
  }

  if (doc.alreadyResolved) {
    return (
      <div className="public-draft">
        {head()}
        <div className="alert">
          This request has already been {doc.signerStatus === 'declined' ? 'declined' : 'completed'}
          . No further action is needed.
        </div>
      </div>
    )
  }

  if (!doc.canSign) {
    return (
      <div className="public-draft">
        {head()}
        <div className="alert">
          This document isn’t ready for your signature yet — a prior signer must sign first. You’ll
          be notified when it’s your turn.
        </div>
      </div>
    )
  }

  async function submit() {
    setBusy('sign')
    setError(null)
    try {
      const r = await onSign({ signatureName, fieldValues, consent: CONSENT_TEXT })
      setDone(r.completed ? 'completed' : 'signed')
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
      await onDecline()
      setDone('declined')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="public-draft">
      {head()}
      <div className="text-sm text-muted">
        For signature{doc.signerName ? ` by ${doc.signerName}` : ''}
        {doc.signerTitle ? ` (${doc.signerTitle})` : ''}
      </div>

      <div
        className="doc-rendered"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.bodyMarkdown) }}
      />

      <div className="sign-panel" style={{ marginTop: 'var(--space-4)' }}>
        {inputFields.length > 0 && (
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <h3 className="h4">Your fields</h3>
            {inputFields.map((f) => (
              <div key={f.id} style={{ marginBottom: 'var(--space-2)' }}>
                <label className="text-sm">{f.label}</label>
                {f.type === 'check' ? (
                  <input
                    type="checkbox"
                    checked={fieldValues[f.id] === 'true'}
                    onChange={(e) =>
                      setFieldValues((v) => ({ ...v, [f.id]: e.target.checked ? 'true' : '' }))
                    }
                  />
                ) : (
                  <input
                    type="text"
                    value={fieldValues[f.id] ?? ''}
                    onChange={(e) => setFieldValues((v) => ({ ...v, [f.id]: e.target.value }))}
                    style={{ display: 'block', width: '100%' }}
                  />
                )}
              </div>
            ))}
          </div>
        )}

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
