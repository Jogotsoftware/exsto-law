'use client'

// The DocuSign-style "prepare for signature" form, extracted so it can be embedded
// anywhere a document gets sent — the standalone /attorney/sign/prepare page AND the
// signature-task window. The attorney adds signers (name/email/title/order), places
// fields by inserting anchor tags ({{sign:client}}, {{date:member}}, …), then sends.
//
// Embedded mode: pass onSent — it fires with the new envelopeId so the parent can
// link the envelope to a task and advance to tracking. Standalone mode: omit onSent
// and the form shows its own result table with the per-signer signing links.
import { useEffect, useMemo, useRef, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { renderDocumentHtml } from '@/lib/documentHtml'

interface DraftDetail {
  documentVersionId: string
  documentKind: string
  matterNumber: string
  bodyMarkdown: string
}
interface SignerRow {
  key: string
  name: string
  email: string
  title: string
  order: number
}
type FieldType = 'sign' | 'initial' | 'name' | 'date' | 'title' | 'text'
const FIELD_BUTTONS: Array<{ type: FieldType; label: string }> = [
  { type: 'sign', label: 'Signature' },
  { type: 'initial', label: 'Initials' },
  { type: 'name', label: 'Name' },
  { type: 'date', label: 'Date' },
  { type: 'title', label: 'Title' },
  { type: 'text', label: 'Text' },
]
const TAG_RE = /\{\{\s*(sign|initial|name|date|title|text|check)\s*:\s*([A-Za-z0-9_-]+)\s*\}\}/g

export interface SendResult {
  envelopeId: string
  signers: Array<{
    email: string
    channel: string
    order: number
    delivered: boolean
    url?: string
  }>
}

export interface PrepareSignatureProps {
  documentVersionId: string
  // Embedded mode (signature-task window): fires with the new envelope id on send.
  onSent?: (result: SendResult) => void
  // Standalone mode: shown as a Cancel link under the Send button.
  cancelHref?: string
}

export function PrepareSignature({ documentVersionId, onSent, cancelHref }: PrepareSignatureProps) {
  const [draft, setDraft] = useState<DraftDetail | null>(null)
  const [markdown, setMarkdown] = useState('')
  const [signers, setSigners] = useState<SignerRow[]>([
    { key: 'client', name: '', email: '', title: '', order: 1 },
  ])
  const [activeKey, setActiveKey] = useState('client')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SendResult | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    callAttorneyMcp<{ draft: DraftDetail | null }>({
      toolName: 'legal.draft.get',
      input: { documentVersionId },
    })
      .then((r) => {
        if (!r.draft) setError('This document is no longer available.')
        else {
          setDraft(r.draft)
          setMarkdown(r.draft.bodyMarkdown)
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [documentVersionId])

  const tagKeys = useMemo(() => {
    const counts: Record<string, number> = {}
    let m: RegExpExecArray | null
    TAG_RE.lastIndex = 0
    while ((m = TAG_RE.exec(markdown)) !== null) counts[m[2]] = (counts[m[2]] ?? 0) + 1
    return counts
  }, [markdown])

  const signerKeys = signers.map((s) => s.key)
  const unknownKeys = Object.keys(tagKeys).filter((k) => !signerKeys.includes(k))

  function insertField(type: FieldType) {
    const tag = `{{${type}:${activeKey}}}`
    const ta = taRef.current
    if (!ta) {
      setMarkdown((md) => `${md}\n${tag}`)
      return
    }
    const start = ta.selectionStart ?? markdown.length
    const end = ta.selectionEnd ?? markdown.length
    const next = markdown.slice(0, start) + tag + markdown.slice(end)
    setMarkdown(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + tag.length
    })
  }

  function setSigner(i: number, patch: Partial<SignerRow>) {
    setSigners((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function addSigner() {
    const n = signers.length + 1
    setSigners((rows) => [...rows, { key: `signer${n}`, name: '', email: '', title: '', order: n }])
  }
  function removeSigner(i: number) {
    setSigners((rows) => rows.filter((_, idx) => idx !== i))
  }

  async function send() {
    setError(null)
    const cleaned = signers.filter((s) => s.email.trim())
    if (cleaned.length === 0) {
      setError('Add at least one signer with an email address.')
      return
    }
    if (unknownKeys.length > 0) {
      setError(
        `The document has fields for unknown signer(s): ${unknownKeys.join(', ')}. Add a signer with that key.`,
      )
      return
    }
    setBusy(true)
    try {
      const res = await callAttorneyMcp<SendResult>({
        toolName: 'legal.esign.send_for_signature',
        input: {
          documentVersionId,
          preparedMarkdown: markdown,
          signers: cleaned.map((s) => ({
            email: s.email.trim(),
            name: s.name.trim() || undefined,
            title: s.title.trim() || undefined,
            order: s.order,
            key: s.key.trim(),
          })),
        },
      })
      setResult(res)
      onSent?.(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (error && !draft) return <div className="alert alert-error">{error}</div>
  if (!draft)
    return (
      <div className="loading-block" role="status">
        <span className="spinner" /> Loading…
      </div>
    )

  if (result) {
    return (
      <div>
        <div className="alert alert-success">
          The envelope was created and the first signer was notified.
        </div>
        <table className="table" style={{ marginTop: 'var(--space-3)' }}>
          <thead>
            <tr>
              <th>Order</th>
              <th>Signer</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            {result.signers.map((s) => (
              <tr key={s.email}>
                <td>{s.order}</td>
                <td>{s.email}</td>
                <td>{s.channel === 'portal' ? 'Client portal' : 'Email link'}</td>
                <td>{s.delivered ? 'Delivered' : 'Waiting (sequential)'}</td>
                <td>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      open
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div>
      <div className="text-sm text-muted">
        {draft.documentKind.replace(/_/g, ' ')} · Matter {draft.matterNumber}
      </div>

      <section style={{ marginTop: 'var(--space-4)' }}>
        <h2 className="h4">Signers</h2>
        <p className="text-sm text-muted">
          Order controls signing sequence (same number = parallel). Each signer&apos;s <b>key</b>{' '}
          matches the field tags you place below.
        </p>
        {signers.map((s, i) => (
          <div
            key={i}
            className="row"
            style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}
          >
            <input
              style={{ width: 70 }}
              type="number"
              min={1}
              value={s.order}
              onChange={(e) => setSigner(i, { order: Number(e.target.value) || 1 })}
              title="Signing order"
            />
            <input
              style={{ width: 110 }}
              value={s.key}
              onChange={(e) => setSigner(i, { key: e.target.value })}
              placeholder="key (client)"
              title="Field key"
            />
            <input
              style={{ width: 150 }}
              value={s.name}
              onChange={(e) => setSigner(i, { name: e.target.value })}
              placeholder="Full name"
            />
            <input
              style={{ width: 200 }}
              value={s.email}
              onChange={(e) => setSigner(i, { email: e.target.value })}
              placeholder="email@example.com"
            />
            <input
              style={{ width: 130 }}
              value={s.title}
              onChange={(e) => setSigner(i, { title: e.target.value })}
              placeholder="Title (e.g. Member)"
            />
            {signers.length > 1 && (
              <button className="danger" onClick={() => removeSigner(i)}>
                ✕
              </button>
            )}
          </div>
        ))}
        <button onClick={addSigner}>+ Add signer</button>
      </section>

      <section style={{ marginTop: 'var(--space-4)' }}>
        <h2 className="h4">Place fields</h2>
        <div
          className="row"
          style={{ gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <label className="text-sm">For signer:</label>
          <select value={activeKey} onChange={(e) => setActiveKey(e.target.value)}>
            {signerKeys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          {FIELD_BUTTONS.map((f) => (
            <button
              key={f.type}
              onClick={() => insertField(f.type)}
              title={`Insert ${f.label} field`}
            >
              + {f.label}
            </button>
          ))}
        </div>
        {unknownKeys.length > 0 && (
          <div className="alert alert-error" style={{ marginTop: 'var(--space-2)' }}>
            Fields reference unknown signer key(s): {unknownKeys.join(', ')}. Add a matching signer.
          </div>
        )}
      </section>

      <section
        style={{
          marginTop: 'var(--space-4)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--space-3)',
        }}
      >
        <div>
          <h2 className="h4">Document (insert tags here)</h2>
          <textarea
            ref={taRef}
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            style={{
              width: '100%',
              minHeight: 380,
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 13,
            }}
          />
        </div>
        <div>
          <h2 className="h4">Preview</h2>
          <div
            className="doc-rendered"
            style={{ maxHeight: 420, overflow: 'auto' }}
            dangerouslySetInnerHTML={{ __html: renderDocumentHtml(markdown) }}
          />
        </div>
      </section>

      {error && (
        <div className="alert alert-error" style={{ marginTop: 'var(--space-3)' }}>
          {error}
        </div>
      )}

      <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
        <button className="primary" onClick={send} disabled={busy}>
          {busy && <span className="spinner" />}
          {busy ? 'Sending…' : 'Send for signature'}
        </button>
        {cancelHref && (
          <a href={cancelHref}>
            <button>Cancel</button>
          </a>
        )}
      </div>
    </div>
  )
}
