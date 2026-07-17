'use client'

// Settings → Signature (WP-G). Split out of the old settings monolith — two
// distinct signatures, both routed here since the comp's "signature" section
// title is Email signature and neither is its own rail item:
//   1. Email signature — appended to outbound client email (legal.settings.
//      signature.get/set). Restyled to the comp's card.
//   2. Document signature — the attorney's standing e-signature applied when
//      signing documents (SignatureCapture, self-contained). Not in the comp
//      (drawn/typed/uploaded capture predates it); kept here rather than
//      dropped since it's a live, wired control, not comp chrome.
import { useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { MailComposer } from '@/components/MailComposer'
import { SignatureCapture } from '@/components/SignatureCapture'
import { SettingsHeader, SettingsLoading, SettingsAlert } from '../shared'

interface FirmSignature {
  signature: string | null
  signatureHtml: string | null
  enabled: boolean
  isDefault: boolean
  resolved: string
  resolvedHtml: string | null
}

interface SignatureSettings {
  signature: FirmSignature
  sendAsDisplayName: string
}

// Seed HTML for the rich editor from a plain-text signature (legacy saves and
// the firm-derived default are plain text).
function signatureTextToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

export default function SignaturePage(): React.ReactElement {
  const [sig, setSig] = useState<SignatureSettings | null>(null)
  const [sigDraft, setSigDraft] = useState('')
  const [sigDraftHtml, setSigDraftHtml] = useState('')
  // Seed for the rich editor + a key so it remounts (reseeds) after each load/save.
  const [sigSeed, setSigSeed] = useState<{ html: string; nonce: number }>({ html: '', nonce: 0 })
  const [sigEnabled, setSigEnabled] = useState(true)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callAttorneyMcp<SignatureSettings>({ toolName: 'legal.settings.signature.get' })
      .then((r) => {
        setSig(r)
        const text = r.signature.signature ?? r.signature.resolved ?? ''
        const html = r.signature.signatureHtml ?? signatureTextToHtml(text)
        setSigDraft(text)
        setSigDraftHtml(r.signature.signatureHtml ?? '')
        setSigSeed((s) => ({ html, nonce: s.nonce + 1 }))
        setSigEnabled(r.signature.enabled)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const r = await callAttorneyMcp<SignatureSettings>({
        toolName: 'legal.settings.signature.set',
        input: { signature: sigDraft, signatureHtml: sigDraftHtml || null, enabled: sigEnabled },
      })
      setSig(r)
      const text = r.signature.signature ?? r.signature.resolved ?? ''
      setSigDraft(text)
      setSigDraftHtml(r.signature.signatureHtml ?? '')
      setSigEnabled(r.signature.enabled)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingsHeader title="Email signature" />
      {error && <SettingsAlert tone="error">{error}</SettingsAlert>}
      {saved && (
        <SettingsAlert tone="success">Saved. New emails will use this signature.</SettingsAlert>
      )}

      {!sig ? (
        <SettingsLoading />
      ) : (
        <div className="li-set-card li-set-card--narrow">
          <p className="li-set-hint" style={{ margin: '0 0 16px', fontSize: '13.5px' }}>
            Appended automatically to every outbound client email — manual sends, replies, booking
            confirmations and invoices. Sent as <strong>{sig.sendAsDisplayName}</strong> from your
            connected Gmail.
          </p>
          <label className="li-set-check-row" style={{ marginBottom: 16 }}>
            <input
              type="checkbox"
              checked={sigEnabled}
              onChange={(e) => {
                setSigEnabled(e.target.checked)
                setSaved(false)
              }}
            />
            <span>Append a signature to outbound email</span>
          </label>
          <MailComposer
            key={sigSeed.nonce}
            initialHtml={sigSeed.html}
            disabled={!sigEnabled}
            minHeight={110}
            placeholder={'Best regards,\nJuan Carlos Pacheco\nPacheco Law Firm'}
            onChange={(v) => {
              setSigDraft(v.text)
              setSigDraftHtml(v.html)
              setSaved(false)
            }}
          />
          {sigEnabled && sig.signature.isDefault && (
            <p className="li-set-hint">
              Until you save your own, emails are signed with a signature derived from your firm
              details.
            </p>
          )}
          {!sigEnabled && <p className="li-set-hint">Outbound email will not carry a signature.</p>}
          <div className="li-set-actions-row">
            <button className="li-set-btn li-set-btn-primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save signature'}
            </button>
          </div>
        </div>
      )}

      <div className="li-set-card li-set-card--narrow">
        <p className="li-set-hint" style={{ margin: '0 0 16px', fontSize: '13.5px' }}>
          Your standing signature for documents you sign electronically — type it, draw it, or
          upload an image.
        </p>
        <SignatureCapture />
      </div>
    </>
  )
}
