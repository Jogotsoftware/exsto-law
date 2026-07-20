'use client'

// 0170 — "New envelope" from ANY PDF (DocuSign-style). Three steps in the same
// wizard chrome as PrepareSignature (Document → Recipients → Review):
//
//   1. Document — pick a PDF from disk; optionally attach it to a matter and/or
//      an existing contact (that's where the envelope files itself).
//   2. Recipients — add signers from contacts (typeahead over the CRM) or type a
//      brand-new name+email; new recipients are badged and SAVED AS CONTACTS at
//      send time (esign.send save_signers_as_contacts).
//   3. Review — subject + summary, then send: upload the bytes
//      (/api/attorney/esign/upload) and dispatch legal.esign.send_file. Every
//      signer gets a secure email signing link (whole-document sign + appended
//      signature certificate — a stored PDF has no inline field tags).
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { readDevSession } from '@/lib/auth'
import { FileTextIcon, PlusIcon, XIcon, CheckIcon, ShieldCheckIcon } from '@/components/icons'

const STEPS = ['Document', 'Recipients', 'Review'] as const

interface ContactSummary {
  contactEntityId: string
  fullName: string
  email: string
}
interface MatterSummary {
  matterEntityId: string
  matterNumber: string
  clientName: string
}
interface RecipientRow {
  name: string
  email: string
  title: string
  order: number
}
interface SendFileResult {
  envelopeId: string
  signers: Array<{ email: string; channel: string; order: number; delivered: boolean }>
  savedContacts: Array<{ email: string; contactEntityId: string }>
}

function devAuthHeaders(): Record<string, string> {
  if (process.env.NODE_ENV === 'production') return {}
  const dev = readDevSession()
  return dev ? { 'x-actor-id': dev.actorId, 'x-tenant-id': dev.tenantId } : {}
}

export function NewEnvelopeWizard() {
  const [step, setStep] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [matterId, setMatterId] = useState('')
  const [contactId, setContactId] = useState('')
  const [recipients, setRecipients] = useState<RecipientRow[]>([
    { name: '', email: '', title: '', order: 1 },
  ])
  const [subject, setSubject] = useState('')
  const [contacts, setContacts] = useState<ContactSummary[]>([])
  const [matters, setMatters] = useState<MatterSummary[]>([])
  const [suggestFor, setSuggestFor] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SendFileResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    callAttorneyMcp<{ contacts: ContactSummary[] }>({ toolName: 'legal.contact.list' })
      .then((r) => setContacts(r.contacts))
      .catch(() => setContacts([]))
    callAttorneyMcp<{ matters: MatterSummary[] }>({ toolName: 'legal.matter.list' })
      .then((r) => setMatters(r.matters))
      .catch(() => setMatters([]))
  }, [])

  const contactByEmail = useMemo(() => {
    const m = new Map<string, ContactSummary>()
    for (const c of contacts) if (c.email) m.set(c.email.toLowerCase(), c)
    return m
  }, [contacts])

  const filled = recipients.filter((r) => r.email.trim())
  const newRecipients = filled.filter((r) => !contactByEmail.has(r.email.trim().toLowerCase()))

  function setRecipient(i: number, patch: Partial<RecipientRow>) {
    setRecipients((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function addRecipient() {
    setRecipients((rows) => [...rows, { name: '', email: '', title: '', order: rows.length + 1 }])
  }
  function removeRecipient(i: number) {
    setRecipients((rows) => rows.filter((_, idx) => idx !== i))
  }

  // Typeahead over the CRM for the active row: match name or email, top 6.
  function suggestionsFor(i: number): ContactSummary[] {
    const q = (recipients[i]?.email || recipients[i]?.name || '').trim().toLowerCase()
    if (q.length < 2) return []
    return contacts
      .filter(
        (c) =>
          (c.email && c.email.toLowerCase().includes(q)) ||
          (c.fullName && c.fullName.toLowerCase().includes(q)),
      )
      .slice(0, 6)
  }

  function pickFile(f: File | null | undefined) {
    setError(null)
    if (!f) return
    if (f.type && f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
      setError('Only PDF files can be sent for signature.')
      return
    }
    setFile(f)
    if (!subject.trim()) setSubject(f.name.replace(/\.pdf$/i, ''))
  }

  function stepError(s: number): string | null {
    if (s === 0 && !file) return 'Choose a PDF to send.'
    if (s === 1 && filled.length === 0) return 'Add at least one recipient with an email address.'
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
    if (!file) {
      setError('Choose a PDF to send.')
      return
    }
    if (filled.length === 0) {
      setError('Add at least one recipient with an email address.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      if (matterId) form.append('matterId', matterId)
      if (contactId) form.append('contactId', contactId)
      const up = await fetch('/api/attorney/esign/upload', {
        method: 'POST',
        headers: devAuthHeaders(),
        body: form,
      })
      const upData = (await up.json().catch(() => ({}))) as {
        documentVersionId?: string
        error?: string
      }
      if (!up.ok || !upData.documentVersionId) {
        throw new Error(upData.error || 'Upload failed.')
      }
      const res = await callAttorneyMcp<SendFileResult>({
        toolName: 'legal.esign.send_file',
        input: {
          documentVersionId: upData.documentVersionId,
          subject: subject.trim() ? `Signature requested: ${subject.trim()}` : undefined,
          signers: filled.map((r, i) => ({
            email: r.email.trim(),
            name: r.name.trim() || undefined,
            title: r.title.trim() || undefined,
            order: r.order || i + 1,
          })),
        },
      })
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div className="li-esign-wiz-sent">
        <span className="li-esign-wiz-sent-ico" aria-hidden="true">
          <CheckIcon size={30} />
        </span>
        <h3 className="li-esign-wiz-sent-title">Envelope sent</h3>
        <p className="li-esign-wiz-sent-body">
          Each recipient received a secure signing link by email.
          {result.savedContacts.length > 0 &&
            ` ${result.savedContacts.length} new ${
              result.savedContacts.length === 1 ? 'recipient was' : 'recipients were'
            } saved to Contacts (${result.savedContacts.map((c) => c.email).join(', ')}).`}
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

  const isLast = step === STEPS.length - 1
  const attachedMatter = matters.find((m) => m.matterEntityId === matterId)
  const attachedContact = contacts.find((c) => c.contactEntityId === contactId)

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
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              style={{ display: 'none' }}
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            <button
              type="button"
              className="li-esign-filedrop"
              onClick={() => fileRef.current?.click()}
            >
              <span className="li-esign-doc-ico" aria-hidden="true">
                <FileTextIcon size={20} />
              </span>
              {file ? (
                <span className="li-esign-filedrop-text">
                  <span className="li-esign-wiz-doc-name">{file.name}</span>
                  <span className="li-esign-wiz-doc-sub">
                    {(file.size / 1024).toFixed(0)} KB · Click to choose a different PDF
                  </span>
                </span>
              ) : (
                <span className="li-esign-filedrop-text">
                  <span className="li-esign-wiz-doc-name">Choose a PDF</span>
                  <span className="li-esign-wiz-doc-sub">
                    Any PDF from your computer — an agreement, a letter, a form
                  </span>
                </span>
              )}
            </button>

            <div className="li-esign-wiz-h li-esign-attach-h">Attach to (optional)</div>
            <p className="li-esign-wiz-hint">
              File this envelope under a matter or an existing contact. You can also send it
              standalone — it always stays visible under eSign.
            </p>
            <div className="li-esign-attach-grid">
              <label className="li-esign-attach-field">
                Matter
                <select value={matterId} onChange={(e) => setMatterId(e.target.value)}>
                  <option value="">— None —</option>
                  {matters.map((m) => (
                    <option key={m.matterEntityId} value={m.matterEntityId}>
                      {m.matterNumber} — {m.clientName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="li-esign-attach-field">
                Contact
                <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                  <option value="">— None —</option>
                  {contacts.map((c) => (
                    <option key={c.contactEntityId} value={c.contactEntityId}>
                      {c.fullName || c.email}
                      {c.email ? ` (${c.email})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <div className="li-esign-wiz-h-row">
              <div className="li-esign-wiz-h">Add recipients &amp; signing order</div>
              <button
                type="button"
                className="li-esign-btn li-esign-btn--sm"
                onClick={addRecipient}
              >
                <PlusIcon size={14} />
                Add recipient
              </button>
            </div>
            <div className="li-esign-wiz-signers">
              {recipients.map((r, i) => {
                const known = r.email.trim()
                  ? contactByEmail.get(r.email.trim().toLowerCase())
                  : undefined
                const sugg = suggestFor === i ? suggestionsFor(i) : []
                return (
                  <div key={i} className="li-esign-recipient">
                    <div className="li-esign-wiz-signer">
                      <input
                        className="li-esign-wiz-order"
                        type="number"
                        min={1}
                        value={r.order}
                        onChange={(e) => setRecipient(i, { order: Number(e.target.value) || 1 })}
                        aria-label={`Signing order for recipient ${i + 1}`}
                        title="Signing order"
                      />
                      <input
                        className="li-esign-wiz-in"
                        value={r.name}
                        onChange={(e) => {
                          setRecipient(i, { name: e.target.value })
                          setSuggestFor(i)
                        }}
                        onFocus={() => setSuggestFor(i)}
                        placeholder="Full name"
                        aria-label="Recipient full name"
                      />
                      <input
                        className="li-esign-wiz-in"
                        value={r.email}
                        onChange={(e) => {
                          setRecipient(i, { email: e.target.value })
                          setSuggestFor(i)
                        }}
                        onFocus={() => setSuggestFor(i)}
                        placeholder="Email"
                        aria-label="Recipient email"
                      />
                      <input
                        className="li-esign-wiz-in"
                        value={r.title}
                        onChange={(e) => setRecipient(i, { title: e.target.value })}
                        placeholder="Title (optional)"
                        aria-label="Recipient title"
                      />
                      {recipients.length > 1 && (
                        <button
                          type="button"
                          className="li-esign-wiz-rm"
                          onClick={() => removeRecipient(i)}
                          aria-label={`Remove recipient ${i + 1}`}
                        >
                          <XIcon size={15} />
                        </button>
                      )}
                    </div>
                    {r.email.trim() && (
                      <span
                        className={`li-esign-rec-badge${known ? '' : ' is-new'}`}
                        title={
                          known
                            ? 'This recipient is already in your contacts.'
                            : 'Not in contacts yet — saved as a new contact when you send.'
                        }
                      >
                        {known ? 'In contacts' : 'New — will be saved to contacts'}
                      </span>
                    )}
                    {sugg.length > 0 && (
                      <div className="li-esign-suggest" role="listbox">
                        {sugg.map((c) => (
                          <button
                            key={c.contactEntityId}
                            type="button"
                            className="li-esign-suggest-item"
                            onClick={() => {
                              setRecipient(i, { name: c.fullName || '', email: c.email || '' })
                              setSuggestFor(null)
                            }}
                          >
                            <span className="li-esign-suggest-name">{c.fullName || c.email}</span>
                            <span className="li-esign-suggest-email">{c.email}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="li-esign-wiz-hint">
              Start typing to pick from your contacts, or enter a new person — new recipients are
              saved to Contacts automatically. Recipients sign in order; the same order number means
              they sign in parallel.
            </p>
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="li-esign-wiz-h">Review &amp; send</div>
            <div className="li-esign-wiz-review">
              <div className="li-esign-wiz-reviewrow">
                <span className="li-esign-wiz-reviewk">Subject</span>
                <input
                  className="li-esign-wiz-in li-esign-subject-in"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={file?.name.replace(/\.pdf$/i, '') || 'Document title'}
                  aria-label="Envelope subject"
                />
              </div>
              <div className="li-esign-wiz-reviewrow">
                <span className="li-esign-wiz-reviewk">Document</span>
                <span className="li-esign-wiz-reviewv">{file?.name ?? '—'}</span>
              </div>
              <div className="li-esign-wiz-reviewrow">
                <span className="li-esign-wiz-reviewk">Filed under</span>
                <span className="li-esign-wiz-reviewv">
                  {[
                    attachedMatter ? `Matter ${attachedMatter.matterNumber}` : null,
                    attachedContact ? attachedContact.fullName || attachedContact.email : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Standalone (eSign only)'}
                </span>
              </div>
              <div className="li-esign-wiz-reviewrow">
                <span className="li-esign-wiz-reviewk">Recipients</span>
                <span className="li-esign-wiz-reviewv">
                  {filled.map((r) => r.name.trim() || r.email.trim()).join(', ') || '—'}
                </span>
              </div>
              {newRecipients.length > 0 && (
                <div className="li-esign-wiz-reviewrow">
                  <span className="li-esign-wiz-reviewk">New contacts</span>
                  <span className="li-esign-wiz-reviewv">
                    {newRecipients.map((r) => r.email.trim()).join(', ')} will be saved to Contacts.
                  </span>
                </div>
              )}
              <div className="li-esign-wiz-reviewrow">
                <span className="li-esign-wiz-reviewk">Delivery</span>
                <span className="li-esign-wiz-reviewv">
                  Secure email signing link per recipient
                </span>
              </div>
              <div className="li-esign-wiz-consent">
                <ShieldCheckIcon size={17} />
                <span>
                  Recipients review the PDF and sign the whole document (ESIGN/UETA consent). On
                  completion a signature certificate with the file’s SHA-256 hash is recorded
                  alongside the original.
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
          {step === 0 && (
            <Link href="/attorney/esign" className="li-esign-btn">
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
