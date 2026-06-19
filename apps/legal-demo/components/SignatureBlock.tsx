'use client'

// SignatureBlock — the firm email signature, shown beneath the composer like the
// signature block in a real mail client, with inline editing. Reads/writes the
// SAME firm signature as Settings → Email signature (legal.settings.signature.*),
// so editing here updates everywhere. The signature is appended to outbound mail
// server-side by the central send path; this is its preview + a convenient editor,
// not a per-message body field.
import { useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

export interface FirmSignature {
  signature: string | null
  enabled: boolean
  isDefault: boolean
  resolved: string
}

export function SignatureBlock({
  value,
  onChange,
}: {
  value: FirmSignature | null
  onChange: (v: FirmSignature) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function startEdit() {
    setDraft(value?.signature ?? value?.resolved ?? '')
    setErr(null)
    setEditing(true)
  }

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      const r = await callAttorneyMcp<{ signature: FirmSignature }>({
        toolName: 'legal.settings.signature.set',
        input: { signature: draft, enabled: true },
      })
      onChange(r.signature)
      setEditing(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="composer-signature is-editing">
        <span className="composer-signature-label">Signature</span>
        <textarea
          className="composer-signature-input"
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Your name, firm, phone…"
        />
        {err && <div className="composer-signature-err">{err}</div>}
        <div className="composer-signature-actions">
          <button className="primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save signature'}
          </button>
          <button disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  const enabled = value?.enabled ?? true
  const text = value?.resolved?.trim() ?? ''
  return (
    <div className="composer-signature">
      <div className="composer-signature-head">
        <span className="composer-signature-label">Signature</span>
        <button type="button" className="composer-signature-edit" onClick={startEdit}>
          Edit
        </button>
      </div>
      <div
        className={`composer-signature-text ${enabled && text ? '' : 'composer-signature-muted'}`}
      >
        {enabled && text
          ? text
          : enabled
            ? 'No signature yet — click Edit to add one.'
            : 'Signature is turned off (Settings → Email signature).'}
      </div>
    </div>
  )
}
