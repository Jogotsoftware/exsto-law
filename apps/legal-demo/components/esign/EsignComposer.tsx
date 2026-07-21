'use client'

// ESIGN-UNIFY-1 (ES-1, design §3) — the ONE eSign send wizard.
//
// Four steps: Documents → Recipients → Fields → Review & send. This PR ships
// the composer ALONGSIDE the old flows (PrepareSignature / NewEnvelopeWizard
// stay live untouched — ES-5 does the cutover); the ES-2 placement canvas
// mounts inside the Fields step this component reserves.
//
// v1 send scope (founder decisions): ONE document per envelope (multi-doc
// deferred); upload-sourced envelopes send via legal.esign.send_file with
// per-recipient roles (§9.2), the sender's personal message (§9.4), and — once
// ES-2 lands — coordinate placements (§5.1). No draft envelope is ever
// persisted: the wizard assembles in memory and submits ONE esign.send on
// confirm (§2 principle 4).
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { readDevSession } from '@/lib/auth'
import {
  CheckIcon,
  FileTextIcon,
  PlusIcon,
  ShieldCheckIcon,
  UploadIcon,
  XIcon,
} from '@/components/icons'
import { MatterContactPicker } from './MatterContactPicker'
import type { ContactOption, MatterOption } from './matterContactFilter'
import { useEnvelopeDraft, type RecipientRole } from './useEnvelopeDraft'

const STEPS = ['Documents', 'Recipients', 'Fields', 'Review & send'] as const

export type ComposerSource =
  | { kind: 'blank' }
  | { kind: 'upload'; file?: File }
  | {
      kind: 'document'
      documentEntityId: string
      documentVersionId: string
      matterEntityId?: string
    }

const ROLE_LABELS: Record<RecipientRole, string> = {
  needs_to_sign: 'Needs to sign',
  needs_to_view: 'Needs to view',
  receives_copy: 'Receives a copy',
}

/** Signer palette index (§4): recipient row edge + chips share these tokens. */
function signerToneClass(index: number): string {
  return `li-esign2-tone-${(index % 8) + 1}`
}

interface SendResult {
  envelopeId: string
  savedContacts: Array<{ email: string; contactEntityId: string }>
}

function devAuthHeaders(): Record<string, string> {
  if (process.env.NODE_ENV === 'production') return {}
  const dev = readDevSession()
  return dev ? { 'x-actor-id': dev.actorId, 'x-tenant-id': dev.tenantId } : {}
}

export function EsignComposer({
  source,
  onClose,
  onSent,
}: {
  source: ComposerSource
  onClose?: () => void
  onSent?: (envelopeId: string) => void
}) {
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)
  const [matters, setMatters] = useState<MatterOption[]>([])
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [suggestFor, setSuggestFor] = useState<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const {
    draft,
    setFile,
    setSubject,
    setMessage,
    setAttach,
    setRecipient,
    addRecipient,
    removeRecipient,
    moveRecipient,
    setUseSigningOrder,
    prefillFirstRecipient,
    filledRecipients,
    stepError,
  } = useEnvelopeDraft()

  // Seed from the launch source: a pre-picked file arrives pre-attached.
  useEffect(() => {
    if (source.kind === 'upload' && source.file) setFile(source.file)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    callAttorneyMcp<{ matters: MatterOption[] }>({ toolName: 'legal.matter.list' })
      .then((r) => setMatters(r.matters))
      .catch(() => setMatters([]))
    callAttorneyMcp<{ contacts: ContactOption[] }>({ toolName: 'legal.contact.list' })
      .then((r) => setContacts(r.contacts))
      .catch(() => setContacts([]))
  }, [])

  // Recipient pre-fill (15.6, the #439 rule): the attached matter's client
  // (client_of contact) takes priority, else the directly attached contact →
  // recipient row 1. Rows stay editable/removable; never overwrites a row the
  // attorney already touched.
  useEffect(() => {
    if (!draft.matterId && !draft.contactId) return
    let cancelled = false
    if (draft.matterId) {
      callAttorneyMcp<{ matter: { clientName: string; clientEmail: string | null } | null }>({
        toolName: 'legal.matter.get',
        input: { matterEntityId: draft.matterId },
      })
        .then((r) => {
          if (cancelled || !r.matter) return
          prefillFirstRecipient(r.matter.clientName || '', r.matter.clientEmail || '')
        })
        .catch(() => {})
    } else if (draft.contactId) {
      const c = contacts.find((x) => x.contactEntityId === draft.contactId)
      if (c) prefillFirstRecipient(c.fullName || '', c.email || '')
    }
    return () => {
      cancelled = true
    }
  }, [draft.matterId, draft.contactId, contacts, prefillFirstRecipient])

  const contactByEmail = useMemo(() => {
    const m = new Map<string, ContactOption>()
    for (const c of contacts) if (c.email) m.set(c.email.toLowerCase(), c)
    return m
  }, [contacts])

  const newRecipients = filledRecipients.filter(
    (r) => !contactByEmail.has(r.email.trim().toLowerCase()),
  )
  const signingRecipients = filledRecipients.filter((r) => r.role === 'needs_to_sign')

  // CRM typeahead for the active recipient row: match name OR email, show the
  // email beside the name (same-name disambiguation, §9.1). Top 6.
  function suggestionsFor(i: number): ContactOption[] {
    const q = (draft.recipients[i]?.email || draft.recipients[i]?.name || '').trim().toLowerCase()
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
    const err = stepError(0) ?? stepError(1)
    if (err) {
      setError(err)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', draft.file!)
      if (draft.matterId) form.append('matterId', draft.matterId)
      if (draft.contactId) form.append('contactId', draft.contactId)
      const up = await fetch('/api/attorney/esign/upload', {
        method: 'POST',
        headers: devAuthHeaders(),
        body: form,
      })
      const upData = (await up.json().catch(() => ({}))) as {
        documentVersionId?: string
        error?: string
      }
      if (!up.ok || !upData.documentVersionId) throw new Error(upData.error || 'Upload failed.')

      const res = await callAttorneyMcp<SendResult>({
        toolName: 'legal.esign.send_file',
        input: {
          documentVersionId: upData.documentVersionId,
          // Subject default = the document title — no prefix (§3 step 4).
          subject: draft.subject.trim() || draft.file!.name.replace(/\.pdf$/i, ''),
          message: draft.message.trim() || undefined,
          placements: draft.placements.length ? draft.placements : undefined,
          signers: filledRecipients.map((r, i) => ({
            email: r.email.trim(),
            name: r.name.trim() || undefined,
            title: r.title.trim() || undefined,
            order: draft.useSigningOrder ? r.order || i + 1 : 1,
            role: r.role,
          })),
        },
      })
      setResult(res)
      onSent?.(res.envelopeId)
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
          Signers received a secure signing link; viewers received a read-only link; copy
          recipients get the executed document once everyone has signed.
          {result.savedContacts.length > 0 &&
            ` ${result.savedContacts.length} new ${
              result.savedContacts.length === 1 ? 'recipient was' : 'recipients were'
            } saved to Contacts.`}
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
  const attachedMatter = matters.find((m) => m.matterEntityId === draft.matterId)
  const attachedContact = contacts.find((c) => c.contactEntityId === draft.contactId)

  return (
    <div className="li-esign-wiz li-esign2">
      <div className="li-esign-wiz-steps">
        {STEPS.map((label, i) => (
          <div key={label} className="li-esign-wiz-step">
            <span
              className={`li-esign-wiz-dot${i === step ? ' is-active' : ''}${i < step ? ' is-done' : ''}`}
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
            <div className="li-esign-wiz-h">Document</div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              style={{ display: 'none' }}
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            {draft.file ? (
              // Single-slot document card (multi-document envelopes deferred).
              <div className="li-esign2-doccard">
                <span className="li-esign-doc-ico" aria-hidden="true">
                  <FileTextIcon size={20} />
                </span>
                <span className="li-esign2-doccard-meta">
                  <span className="li-esign-wiz-doc-name">{draft.file.name}</span>
                  <span className="li-esign-wiz-doc-sub">
                    {(draft.file.size / 1024).toFixed(0)} KB · PDF
                  </span>
                </span>
                <span className="li-esign2-doccard-actions">
                  <button
                    type="button"
                    className="li-esign-btn li-esign-btn--sm"
                    onClick={() => fileRef.current?.click()}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    className="li-esign-btn li-esign-btn--sm"
                    aria-label="Remove document"
                    onClick={() => setFile(null)}
                  >
                    <XIcon size={14} />
                  </button>
                </span>
              </div>
            ) : (
              <button
                type="button"
                className="li-esign-filedrop"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  pickFile(e.dataTransfer.files?.[0])
                }}
              >
                <span className="li-esign-doc-ico" aria-hidden="true">
                  <UploadIcon size={20} />
                </span>
                <span className="li-esign-filedrop-text">
                  <span className="li-esign-wiz-doc-name">Upload a PDF</span>
                  <span className="li-esign-wiz-doc-sub">
                    Drop it here or click to choose — an agreement, a letter, a form
                  </span>
                </span>
              </button>
            )}

            <div className="li-esign-wiz-h li-esign-attach-h">Attach to (optional)</div>
            <p className="li-esign-wiz-hint">
              File this envelope under a matter or an existing contact. Picking one narrows the
              other to matching records; you can also send it standalone.
            </p>
            <MatterContactPicker
              matters={matters}
              contacts={contacts}
              matterId={draft.matterId}
              contactId={draft.contactId}
              onChange={setAttach}
              disabled={busy}
            />
          </div>
        )}

        {step === 1 && (
          <div>
            <div className="li-esign-wiz-h-row">
              <div className="li-esign-wiz-h">Recipients</div>
              <div className="li-esign2-recip-tools">
                <label className="li-esign2-ordertoggle">
                  <input
                    type="checkbox"
                    checked={draft.useSigningOrder}
                    onChange={(e) => setUseSigningOrder(e.target.checked)}
                  />
                  Set signing order
                </label>
                <button type="button" className="li-esign-btn li-esign-btn--sm" onClick={addRecipient}>
                  <PlusIcon size={14} />
                  Add recipient
                </button>
              </div>
            </div>
            <div className="li-esign-wiz-signers">
              {draft.recipients.map((r, i) => {
                const known = r.email.trim()
                  ? contactByEmail.get(r.email.trim().toLowerCase())
                  : undefined
                const sugg = suggestFor === i ? suggestionsFor(i) : []
                return (
                  <div
                    key={i}
                    className={`li-esign2-recipient ${signerToneClass(i)}${
                      dragIndex === i ? ' is-dragging' : ''
                    }`}
                    draggable
                    onDragStart={() => setDragIndex(i)}
                    onDragEnd={() => setDragIndex(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (dragIndex != null) moveRecipient(dragIndex, i)
                      setDragIndex(null)
                    }}
                  >
                    <div className="li-esign-wiz-signer">
                      <span className="li-esign2-recip-num" title="Drag to reorder">
                        {draft.useSigningOrder ? r.order : i + 1}
                      </span>
                      <input
                        className="li-esign-wiz-in"
                        value={r.name}
                        onChange={(e) => {
                          setRecipient(i, { name: e.target.value })
                          setSuggestFor(i)
                        }}
                        onFocus={() => setSuggestFor(i)}
                        placeholder="Full name"
                        aria-label={`Recipient ${i + 1} name`}
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
                        aria-label={`Recipient ${i + 1} email`}
                      />
                      <input
                        className="li-esign-wiz-in li-esign2-in-title"
                        value={r.title}
                        onChange={(e) => setRecipient(i, { title: e.target.value })}
                        placeholder="Title (optional)"
                        aria-label={`Recipient ${i + 1} title`}
                      />
                      <select
                        className="li-esign2-role"
                        value={r.role}
                        onChange={(e) => setRecipient(i, { role: e.target.value as RecipientRole })}
                        aria-label={`Recipient ${i + 1} role`}
                      >
                        {(Object.keys(ROLE_LABELS) as RecipientRole[]).map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                      {draft.recipients.length > 1 && (
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
              Drag rows to reorder. With signing order ON, recipients sign in numbered sequence;
              OFF, everyone can sign at once. Viewers get a read-only link with the first group;
              copy recipients get the executed document when everyone has signed.
            </p>
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="li-esign-wiz-h">Fields</div>
            <div className="li-esign2-fields-note">
              <p className="li-esign-wiz-hint">
                Each signer executes the whole document and their signature, name, and date are
                recorded on the signature certificate. Signers on this envelope:
              </p>
              <div className="li-esign2-signer-chips">
                {signingRecipients.length === 0 && (
                  <span className="li-esign-wiz-hint">
                    No signing recipients yet — add one on the Recipients step.
                  </span>
                )}
                {signingRecipients.map((r, i) => (
                  <span key={i} className={`li-esign2-signer-chip ${signerToneClass(draft.recipients.indexOf(r))}`}>
                    <span className="li-esign2-signer-dot" aria-hidden="true" />
                    {r.name.trim() || r.email.trim()}
                    {draft.useSigningOrder ? ` · signs ${ordinal(r.order)}` : ''}
                  </span>
                ))}
              </div>
              <p className="li-esign-wiz-hint">
                Drag-and-drop field placement on the rendered PDF arrives with the placement
                canvas; envelopes sent now use whole-document signing.
              </p>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="li-esign-wiz-h">Review &amp; send</div>
            <div className="li-esign-wiz-review">
              <div className="li-esign-wiz-reviewrow">
                <span className="li-esign-wiz-reviewk">Subject</span>
                <input
                  className="li-esign-wiz-in li-esign-subject-in"
                  value={draft.subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={draft.file?.name.replace(/\.pdf$/i, '') || 'Document title'}
                  aria-label="Envelope subject"
                />
              </div>
              <div className="li-esign-wiz-reviewrow">
                <span className="li-esign-wiz-reviewk">Document</span>
                <span className="li-esign-wiz-reviewv">{draft.file?.name ?? '—'}</span>
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
                <span className="li-esign-wiz-reviewv li-esign2-review-recips">
                  {filledRecipients.map((r, i) => (
                    <span key={i} className={`li-esign2-rolechip ${signerToneClass(draft.recipients.indexOf(r))}`}>
                      <span className="li-esign2-signer-dot" aria-hidden="true" />
                      {r.name.trim() || r.email.trim()}
                      <em>{ROLE_LABELS[r.role]}</em>
                    </span>
                  ))}
                </span>
              </div>
              {newRecipients.length > 0 && (
                <div className="li-esign-wiz-reviewrow">
                  <span className="li-esign-wiz-reviewk">New contacts</span>
                  <span className="li-esign-wiz-reviewv">
                    {newRecipients.map((r) => r.email.trim()).join(', ')} will be saved to
                    Contacts.
                  </span>
                </div>
              )}
              <div className="li-esign-wiz-reviewrow">
                <span className="li-esign-wiz-reviewk">Add message</span>
                <textarea
                  className="li-esign2-message"
                  value={draft.message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="A personal note included in the signing email (optional)"
                  rows={3}
                  aria-label="Personal message"
                />
              </div>
              <div className="li-esign-wiz-consent">
                <ShieldCheckIcon size={17} />
                <span>
                  Recipients review the document and sign electronically (ESIGN/UETA consent). On
                  completion a signature certificate with the file&rsquo;s SHA-256 hash is recorded
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
          {step === 0 &&
            (onClose ? (
              <button type="button" className="li-esign-btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
            ) : (
              <Link href="/attorney/esign" className="li-esign-btn">
                Cancel
              </Link>
            ))}
        </div>
        {isLast ? (
          <button
            type="button"
            className="li-esign-btn li-esign-btn--primary"
            onClick={send}
            disabled={busy}
          >
            {busy ? 'Sending…' : 'Send'}
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

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? 'th'}`
}
