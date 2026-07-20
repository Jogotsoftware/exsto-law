'use client'

// The DocuSign-style "prepare for signature" flow, extracted so it can be embedded
// anywhere a document gets sent — the standalone /attorney/sign/prepare page AND the
// signature-task window. The attorney confirms the document, adds signers
// (name/email/title/order), places fields by inserting anchor tags ({{sign:client}},
// {{date:member}}, …), reviews, then sends.
//
// WP-N (Legal Instruments): the flow wears the comp's four-step wizard chrome
// (Document → Signers → Fields → Review) with step dots and an "Envelope sent"
// confirmation. The anchor/field + send MECHANICS are unchanged — this is chrome
// over the existing logic.
//
// Embedded mode: pass onSent — it fires with the new envelopeId so the parent can
// link the envelope to a task and advance to tracking. Standalone mode: omit onSent
// and the confirmation offers a link to the new envelope.
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { renderDocumentHtml } from '@/lib/documentHtml'
import { FileTextIcon, PlusIcon, XIcon, CheckIcon, ShieldCheckIcon } from '@/components/icons'

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
const STEPS = ['Document', 'Signers', 'Fields', 'Review'] as const

function humanizeKind(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

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
  // Standalone mode: shown as a Cancel link in the wizard footer.
  cancelHref?: string
}

export function PrepareSignature({ documentVersionId, onSent, cancelHref }: PrepareSignatureProps) {
  const [draft, setDraft] = useState<DraftDetail | null>(null)
  const [markdown, setMarkdown] = useState('')
  const [signers, setSigners] = useState<SignerRow[]>([
    { key: 'client', name: '', email: '', title: '', order: 1 },
  ])
  const [activeKey, setActiveKey] = useState('client')
  const [step, setStep] = useState(0)
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
  const filledSigners = signers.filter((s) => s.email.trim())

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

  // Guard each step before advancing; surface the reason inline.
  function stepError(s: number): string | null {
    if (s === 1 && filledSigners.length === 0)
      return 'Add at least one signer with an email address.'
    if (s === 2 && unknownKeys.length > 0)
      return `The document has fields for unknown signer(s): ${unknownKeys.join(', ')}. Add a signer with that key.`
    return null
  }

  function goNext() {
    const err = stepError(step)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }
  function goBack() {
    setError(null)
    setStep((s) => Math.max(s - 1, 0))
  }

  async function send() {
    setError(null)
    if (filledSigners.length === 0) {
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
          signers: filledSigners.map((s) => ({
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

  // Sent confirmation (comp: green check + "Envelope sent").
  if (result) {
    return (
      <div className="li-esign-wiz-sent">
        <span className="li-esign-wiz-sent-ico" aria-hidden="true">
          <CheckIcon size={30} />
        </span>
        <h3 className="li-esign-wiz-sent-title">Envelope Sent</h3>
        <p className="li-esign-wiz-sent-body">
          Each signer received a secure signing link by email. You’ll see progress update on this
          envelope as they open and sign.
        </p>
        <Link
          href={`/attorney/esign/${result.envelopeId}`}
          className="li-esign-btn li-esign-btn--primary"
        >
          View envelope
        </Link>
      </div>
    )
  }

  const docLabel = humanizeKind(draft.documentKind)
  const isLast = step === STEPS.length - 1

  return (
    <div className="li-esign-wiz">
      <div className="li-esign-wiz-steps">
        {STEPS.map((label, i) => (
          <div key={label} className="li-esign-wiz-step">
            <span
              className={`li-esign-wiz-dot${i === step ? ' is-active' : ''}${
                i < step ? ' is-done' : ''
              }`}
            >
              {i < step ? <CheckIcon size={14} /> : i + 1}
            </span>
            <span className={`li-esign-wiz-steplabel${i === step ? ' is-active' : ''}`}>
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="li-esign-wiz-line" />}
          </div>
        ))}
      </div>

      <div className="li-esign-wiz-body">
        {step === 0 && (
          <div>
            <div className="li-esign-wiz-h">Document to send</div>
            <div className="li-esign-wiz-doc">
              <span className="li-esign-doc-ico" aria-hidden="true">
                <FileTextIcon size={18} />
              </span>
              <div>
                <div className="li-esign-wiz-doc-name">{docLabel}</div>
                <div className="li-esign-wiz-doc-sub">Matter {draft.matterNumber}</div>
              </div>
            </div>
            <div
              className="li-esign-wiz-preview doc-rendered"
              dangerouslySetInnerHTML={{ __html: renderDocumentHtml(markdown) }}
            />
          </div>
        )}

        {step === 1 && (
          <div>
            <div className="li-esign-wiz-h-row">
              <div className="li-esign-wiz-h">Add Signers &amp; Signing Order</div>
              <button type="button" className="li-esign-btn li-esign-btn--sm" onClick={addSigner}>
                <PlusIcon size={14} />
                Add signer
              </button>
            </div>
            <div className="li-esign-wiz-signers">
              {signers.map((s, i) => (
                <div key={i} className="li-esign-wiz-signer">
                  <input
                    className="li-esign-wiz-order"
                    type="number"
                    min={1}
                    value={s.order}
                    onChange={(e) => setSigner(i, { order: Number(e.target.value) || 1 })}
                    aria-label={`Signing order for signer ${i + 1}`}
                    title="Signing order"
                  />
                  <input
                    className="li-esign-wiz-in li-esign-wiz-in--key"
                    value={s.key}
                    onChange={(e) => setSigner(i, { key: e.target.value })}
                    placeholder="key"
                    aria-label="Field key"
                    title="Field key — matches the tags you place in Fields"
                  />
                  <input
                    className="li-esign-wiz-in"
                    value={s.name}
                    onChange={(e) => setSigner(i, { name: e.target.value })}
                    placeholder="Full name"
                    aria-label="Signer full name"
                  />
                  <input
                    className="li-esign-wiz-in"
                    value={s.email}
                    onChange={(e) => setSigner(i, { email: e.target.value })}
                    placeholder="Email"
                    aria-label="Signer email"
                  />
                  <input
                    className="li-esign-wiz-in"
                    value={s.title}
                    onChange={(e) => setSigner(i, { title: e.target.value })}
                    placeholder="Title"
                    aria-label="Signer title"
                  />
                  {signers.length > 1 && (
                    <button
                      type="button"
                      className="li-esign-wiz-rm"
                      onClick={() => removeSigner(i)}
                      aria-label={`Remove signer ${i + 1}`}
                    >
                      <XIcon size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="li-esign-wiz-hint">
              Signers receive their link in order — signer 2 is notified only after signer 1
              completes. Same order number = they sign in parallel. Each signer’s <b>key</b> matches
              the field tags you place next.
            </p>
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="li-esign-wiz-h">Place fields</div>
            <p className="li-esign-wiz-hint">
              Insert DocuSign-style fields as anchor tags — e.g.{' '}
              <code className="li-esign-wiz-code">{`{{sign:${activeKey || 'client'}}}`}</code>. Auto
              fields (name, date) fill themselves; the signer completes the rest.
            </p>
            <div className="li-esign-wiz-fieldbar">
              <label className="li-esign-wiz-forlabel">
                For signer
                <select value={activeKey} onChange={(e) => setActiveKey(e.target.value)}>
                  {signerKeys.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              {FIELD_BUTTONS.map((f) => (
                <button
                  key={f.type}
                  type="button"
                  className="li-esign-wiz-fieldchip"
                  onClick={() => insertField(f.type)}
                  title={`Insert ${f.label} field for ${activeKey}`}
                >
                  <PlusIcon size={13} />
                  {f.label}
                </button>
              ))}
            </div>
            {unknownKeys.length > 0 && (
              <div className="alert alert-error li-esign-wiz-alert">
                Fields reference unknown signer key(s): {unknownKeys.join(', ')}. Add a matching
                signer.
              </div>
            )}
            <div className="li-esign-wiz-fieldgrid">
              <div>
                <div className="li-esign-wiz-sublabel">Document (tags insert here)</div>
                <textarea
                  ref={taRef}
                  className="li-esign-wiz-ta"
                  value={markdown}
                  onChange={(e) => setMarkdown(e.target.value)}
                  aria-label="Document markdown"
                />
              </div>
              <div>
                <div className="li-esign-wiz-sublabel">Preview</div>
                <div
                  className="li-esign-wiz-preview doc-rendered"
                  dangerouslySetInnerHTML={{ __html: renderDocumentHtml(markdown) }}
                />
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="li-esign-wiz-h">Review &amp; send</div>
            <div className="li-esign-wiz-review">
              <div className="li-esign-wiz-reviewrow">
                <span className="li-esign-wiz-reviewk">Document</span>
                <span className="li-esign-wiz-reviewv">{docLabel}</span>
              </div>
              <div className="li-esign-wiz-reviewrow">
                <span className="li-esign-wiz-reviewk">Signers</span>
                <span className="li-esign-wiz-reviewv">
                  {filledSigners.map((s) => s.name.trim() || s.email.trim()).join(', ') || '—'}
                </span>
              </div>
              <div className="li-esign-wiz-reviewrow">
                <span className="li-esign-wiz-reviewk">Delivery</span>
                <span className="li-esign-wiz-reviewv">
                  Sequential · secure email link per signer
                </span>
              </div>
              <div className="li-esign-wiz-consent">
                <ShieldCheckIcon size={17} />
                <span>
                  Signers accept ESIGN/UETA consent before signing. On completion an executed copy
                  with a signature certificate and the original’s SHA-256 hash is filed to the
                  matter.
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error li-esign-wiz-alert">{error}</div>}

      <div className="li-esign-wiz-foot">
        <div>
          {step > 0 && (
            <button type="button" className="li-esign-btn" onClick={goBack} disabled={busy}>
              Back
            </button>
          )}
          {step === 0 && cancelHref && (
            <Link href={cancelHref} className="li-esign-btn">
              Cancel
            </Link>
          )}
        </div>
        {isLast ? (
          <button
            type="button"
            className="li-esign-btn li-esign-btn--primary"
            onClick={send}
            disabled={busy}
          >
            {busy ? 'Sending…' : 'Send envelope'}
          </button>
        ) : (
          <button
            type="button"
            className="li-esign-btn li-esign-btn--primary"
            onClick={goNext}
            disabled={busy}
          >
            Continue
          </button>
        )}
      </div>
    </div>
  )
}
