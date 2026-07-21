'use client'

// ESIGN-UNIFY-1 (ES-1, design §3) — the ONE eSign send wizard.
//
// Four steps: Documents → Recipients → Fields → Review & send. This is the ONE
// eSign flow (ES-5b deleted the old PrepareSignature / NewEnvelopeWizard and
// retargeted every launcher here); the ES-2 placement canvas mounts inside the
// Fields step this component reserves.
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
  ChevronDownIcon,
  FileTextIcon,
  PlusIcon,
  ShieldCheckIcon,
  UploadIcon,
  XIcon,
} from '@/components/icons'
import { MatterContactPicker } from './MatterContactPicker'
import type { ContactOption, MatterOption } from './matterContactFilter'
import { useEnvelopeDraft, type RecipientRole } from './useEnvelopeDraft'
import { workflowStepRecipientRows } from '@/lib/esignComposeSource'
// ES-2 (§4) — the placement surface + the real preview, all client-safe pure
// imports (the esign subpath ships no server code).
import {
  markerMapToPlacements,
  resolvePlacementData,
  type FieldPlacement,
  type MarkerMapEntry,
} from '@exsto/legal/esign'
import { FieldPlacer, type PlacerSigner } from './FieldPlacer'
import { PdfCanvas } from './PdfCanvas'
import { usePdfDocument } from './usePdfDocument'

const STEPS = ['Documents', 'Recipients', 'Fields', 'Review & send'] as const

/** ES-4: a recipient row pre-resolved from the template's e-sign roles (via
 *  esignPrefill) — arrives editable; `key` binds the row to its {{type:key}}
 *  markers, `label` names the unresolved role ("Client", "Managing Member"). */
export interface WorkflowStepRecipientSeed {
  name: string
  email: string
  title: string
  role: RecipientRole
  order: number
  key: string | null
  label?: string
}

export type ComposerSource =
  | { kind: 'blank' }
  | { kind: 'upload'; file?: File }
  // ES-5 (design §8): launched on an existing document version — review
  // toolbar, matter documents tab, chat. The document is locked to that
  // version; a matter context pre-attaches so the client pre-fills row 1.
  | {
      kind: 'document'
      documentVersionId: string
      documentEntityId?: string
      matterEntityId?: string
      /** Seeds the subject + step-1 document card name (humanized doc kind). */
      title?: string
    }
  // ESIGN-UNIFY-1 ES-4 (design §7): launched from the matter workflow's e-sign
  // step — the document is LOCKED to the approved version, recipients arrive
  // pre-resolved from the template's roles, and Send goes through the draft
  // send surface (legal.esign.send_for_signature), not the upload path.
  | {
      kind: 'workflow-step'
      matterEntityId: string
      documentEntityId: string
      documentVersionId: string
      documentTitle: string
      versionNumber: number | null
      subject?: string
      recipients: WorkflowStepRecipientSeed[]
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

// ES-MULTIDOC-1 — one document the wizard iterates. Upload/blank sources carry
// N uploaded files (each with `file`); document/workflow-step sources carry one
// locked version (`documentVersionId`). Array position IS the docIndex.
interface ComposerDoc {
  id: string
  title: string
  file?: File
  documentVersionId?: string
}
// Per-document render: the PDF bytes the canvas draws + (for rendered drafts)
// the anchor marker map, or an error. Keyed by ComposerDoc.id in docRenders.
interface DocRender {
  bytes: ArrayBuffer | null
  markers: MarkerMapEntry[]
  error: string | null
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
  // ES-MULTIDOC-1 — per-document render (bytes + marker map + error), keyed by
  // the composer doc id so a fetched render survives reorder/remove. Upload
  // mode: each file's own bytes (no round-trip, no markers); document/workflow
  // mode: the §5.2 render route's export-pipeline PDF + its marker map.
  const [docRenders, setDocRenders] = useState<Record<string, DocRender>>({})
  // The document whose fields the Fields-step canvas is placing (switcher).
  const [activeDoc, setActiveDoc] = useState(0)
  const seededMarkers = useRef(false)

  const {
    draft,
    addDocuments,
    removeDocument,
    moveDocument,
    setSubject,
    setMessage,
    setAttach,
    setRecipient,
    addRecipient,
    removeRecipient,
    moveRecipient,
    setUseSigningOrder,
    setPlacements,
    prefillFirstRecipient,
    seedWorkflowStep,
    filledRecipients,
    stepError,
  } = useEnvelopeDraft()

  const isWorkflowStep = source.kind === 'workflow-step'
  const isLocked = source.kind === 'document' || source.kind === 'workflow-step'

  // ES-MULTIDOC-1 — the ordered document set the whole wizard iterates.
  const srcVersionId = isLocked ? source.documentVersionId : ''
  const srcTitle =
    source.kind === 'document'
      ? (source.title ?? '')
      : source.kind === 'workflow-step'
        ? source.documentTitle
        : ''
  const composerDocs: ComposerDoc[] = useMemo(() => {
    if (isLocked) {
      return [{ id: 'src', title: srcTitle.trim() || 'Document', documentVersionId: srcVersionId }]
    }
    return draft.documents.map((d) => ({ id: d.id, title: d.title, file: d.file }))
  }, [isLocked, srcVersionId, srcTitle, draft.documents])

  // The primary (doc 0) render backs marker seeding + the locked-source status
  // line; a single-doc or locked envelope has exactly this one render.
  const primaryRender = docRenders[composerDocs[0]?.id ?? '']
  const docMarkers = primaryRender?.markers ?? []
  const renderError = primaryRender?.error ?? null

  // Seed from the launch source: a pre-picked file arrives pre-attached; a
  // document launch (ES-5: review toolbar / matter docs / chat) pre-attaches
  // its matter (which pre-fills the client as recipient 1) and seeds the
  // subject from the document title; a workflow step arrives with the
  // document locked and recipients resolved.
  useEffect(() => {
    if (source.kind === 'upload' && source.file) addDocuments([source.file])
    if (source.kind === 'document') {
      if (source.title?.trim()) setSubject(source.title.trim())
      if (source.matterEntityId) setAttach({ matterId: source.matterEntityId, contactId: null })
    }
    if (source.kind === 'workflow-step') {
      seedWorkflowStep({
        subject: source.subject,
        recipients: workflowStepRecipientRows(source.recipients),
      })
    }
  }, [])

  useEffect(() => {
    callAttorneyMcp<{ matters: MatterOption[] }>({ toolName: 'legal.matter.list' })
      .then((r) => setMatters(r.matters))
      .catch(() => setMatters([]))
    callAttorneyMcp<{ contacts: ContactOption[] }>({ toolName: 'legal.contact.list' })
      .then((r) => setContacts(r.contacts))
      .catch(() => setContacts([]))
  }, [])

  // ES-MULTIDOC-1 — resolve bytes + marker map for EVERY document in the set.
  // Upload docs read their own file bytes (no round-trip, no markers); a
  // document/workflow-step doc goes through the §5.2 render route once (its
  // marker map pre-seeds the canvas, §7). Keyed by doc id so a render survives
  // reorder/remove — only docs without a render yet are fetched.
  useEffect(() => {
    let cancelled = false
    const setRender = (id: string, r: DocRender) => {
      if (!cancelled) setDocRenders((prev) => ({ ...prev, [id]: r }))
    }
    for (const doc of composerDocs) {
      if (docRenders[doc.id]) continue
      if (doc.file) {
        doc.file
          .arrayBuffer()
          .then((buf) => setRender(doc.id, { bytes: buf, markers: [], error: null }))
          .catch(() => setRender(doc.id, { bytes: null, markers: [], error: 'Could not read this file.' }))
      } else if (doc.documentVersionId) {
        fetch('/api/attorney/esign/render', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...devAuthHeaders() },
          body: JSON.stringify({ documentVersionId: doc.documentVersionId }),
        })
          .then(async (r) => {
            const data = (await r.json().catch(() => ({}))) as {
              pdf?: string
              markers?: MarkerMapEntry[]
              error?: string
            }
            if (!r.ok || !data.pdf) throw new Error(data.error || 'Could not render the document.')
            const bin = atob(data.pdf)
            const bytes = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
            setRender(doc.id, { bytes: bytes.buffer, markers: data.markers ?? [], error: null })
          })
          .catch((e) =>
            setRender(doc.id, {
              bytes: null,
              markers: [],
              error: e instanceof Error ? e.message : String(e),
            }),
          )
      }
    }
    return () => {
      cancelled = true
    }
  }, [composerDocs, docRenders])

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

  // ES-2 — stable signer keys for placement binding: in document mode the
  // template's marker keys map onto recipient rows in order (first marker
  // signer → first signing recipient), so anchor-seeded boxes bind without
  // manual re-assignment; extra recipients get s<n>. Upload mode: s1, s2, ….
  const markerKeys = useMemo(() => {
    const seen: string[] = []
    for (const m of docMarkers) if (!seen.includes(m.anchor.key)) seen.push(m.anchor.key)
    return seen
  }, [docMarkers])
  const signingIndexes = useMemo(
    () =>
      draft.recipients
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.email.trim() && r.role === 'needs_to_sign')
        .map(({ i }) => i),
    [draft.recipients],
  )
  const signerKeyForRow = useMemo(() => {
    const map = new Map<number, string>()
    signingIndexes.forEach((rowIndex, signerIdx) => {
      // ES-4: a workflow-step row arrives ALREADY keyed by its template role
      // ({{sign:<key>}}) — that key wins so anchor-seeded boxes and the send
      // payload bind to the config's signer, not positional order.
      const seededKey = draft.recipients[rowIndex]?.key
      map.set(rowIndex, seededKey || markerKeys[signerIdx] || `s${rowIndex + 1}`)
    })
    return map
  }, [signingIndexes, markerKeys, draft.recipients])

  const placerSigners: PlacerSigner[] = useMemo(
    () =>
      signingIndexes.map((rowIndex) => {
        const r = draft.recipients[rowIndex]!
        return {
          signerKey: signerKeyForRow.get(rowIndex)!,
          name: r.name.trim() || r.email.trim(),
          toneIndex: (rowIndex % 8) + 1,
        }
      }),
    [signingIndexes, draft.recipients, signerKeyForRow],
  )

  // Template anchors pre-seed the canvas ONCE (§5.2) — the attorney adjusts
  // from there; re-seeding on every recipients change would clobber edits.
  useEffect(() => {
    if (seededMarkers.current || docMarkers.length === 0 || placerSigners.length === 0) return
    if (draft.placements.length > 0) return
    seededMarkers.current = true
    const known = new Set(placerSigners.map((s) => s.signerKey))
    setPlacements(
      markerMapToPlacements(docMarkers, {
        signerKeyFor: (k) => (known.has(k) ? k : (placerSigners[0]?.signerKey ?? k)),
      }),
    )
  }, [docMarkers, placerSigners, draft.placements.length, setPlacements])

  // §5.3 — the sender sees real data in the canvas: recipient-sourced values
  // (name/email/title) resolve client-side from the rows themselves. Contact/
  // matter-sourced values resolve server-side at send.
  const canvasValues = useMemo(
    () =>
      resolvePlacementData(draft.placements, {
        recipients: signingIndexes.map((rowIndex) => {
          const r = draft.recipients[rowIndex]!
          return {
            signerKey: signerKeyForRow.get(rowIndex)!,
            name: r.name.trim() || null,
            email: r.email.trim() || null,
            title: r.title.trim() || null,
          }
        }),
        contact: null,
        matter: null,
      }),
    [draft.placements, signingIndexes, draft.recipients, signerKeyForRow],
  )

  // ES-MULTIDOC-1 — the active document (clamped as docs are removed).
  const activeDocSafe = Math.min(activeDoc, Math.max(0, composerDocs.length - 1))

  function addFiles(files: FileList | File[] | null | undefined) {
    setError(null)
    if (!files) return
    const list = Array.from(files)
    if (list.length === 0) return
    const bad = list.find((f) => f.type && f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name))
    if (bad) {
      setError('Only PDF files can be sent for signature.')
      return
    }
    addDocuments(list)
  }

  // Locked launches (document/workflow-step) carry no upload — the render
  // route's bytes stand in for the file on step-0 validation.
  function effectiveStepError(s: number): string | null {
    if (isLocked && s === 0) {
      if (renderError) return renderError
      return primaryRender?.bytes ? null : 'The document is still rendering — one moment.'
    }
    return stepError(s)
  }

  function goNext() {
    const err = effectiveStepError(step)
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
    const err = effectiveStepError(0) ?? effectiveStepError(1)
    if (err) {
      setError(err)
      return
    }
    setBusy(true)
    setError(null)

    try {
      // ES-2 — every signer carries the key its placements bind to (§5.1).
      const signerPayload = filledRecipients.map((r, i) => {
        const rowIndex = draft.recipients.indexOf(r)
        return {
          email: r.email.trim(),
          name: r.name.trim() || undefined,
          title: r.title.trim() || undefined,
          order: draft.useSigningOrder ? r.order || i + 1 : 1,
          role: r.role,
          key: signerKeyForRow.get(rowIndex),
        }
      })

      if (source.kind === 'document' || source.kind === 'workflow-step') {
        // Draft/document envelope — same composer, the draft send tool (§5.5).
        // ES-4 workflow-step: the approved version this step is locked to; its
        // subject falls back to the document title (never the legacy prefix).
        const res = await callAttorneyMcp<SendResult>({
          toolName: 'legal.esign.send_for_signature',
          input: {
            documentVersionId: source.documentVersionId,
            subject:
              draft.subject.trim() ||
              (source.kind === 'workflow-step' ? source.documentTitle : undefined),
            message: draft.message.trim() || undefined,
            placements: draft.placements.length ? draft.placements : undefined,
            signers: signerPayload,
          },
        })
        setResult(res)
        onSent?.(res.envelopeId)
        return
      }

      // ES-MULTIDOC-1 — upload every document IN ORDER, then send one envelope
      // carrying them all. The upload document order == the docIndex the
      // placements reference; the first is the primary.
      const uploaded: Array<{ documentVersionId: string }> = []
      for (const d of draft.documents) {
        const form = new FormData()
        form.append('file', d.file)
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
        uploaded.push({ documentVersionId: upData.documentVersionId })
      }
      if (uploaded.length === 0) throw new Error('Choose a PDF to send.')

      const res = await callAttorneyMcp<SendResult>({
        toolName: 'legal.esign.send_file',
        input: {
          documentVersionId: uploaded[0]!.documentVersionId,
          // The full ordered set when there is more than one document.
          documents: uploaded.length > 1 ? uploaded : undefined,
          // Subject default = the document title (single doc) or a count — no
          // "Signature requested:" prefix (§3 step 4).
          subject:
            draft.subject.trim() ||
            (draft.documents.length > 1
              ? `${draft.documents.length} documents`
              : (draft.documents[0]?.title ?? 'Document')),
          message: draft.message.trim() || undefined,
          placements: draft.placements.length ? draft.placements : undefined,
          signers: signerPayload,
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
          Signers received a secure signing link; viewers received a read-only link; copy recipients
          get the executed document once everyone has signed.
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
        {step === 0 && source.kind === 'workflow-step' && (
          <div>
            <div className="li-esign-wiz-h">Document</div>
            {/* ES-4: locked to the approved version this workflow step sends —
                no replace, no upload; the attorney reviews it on the matter. */}
            {renderError && <div className="alert alert-error">{renderError}</div>}
            <div className="li-esign2-doccard">
              <span className="li-esign-doc-ico" aria-hidden="true">
                <FileTextIcon size={20} />
              </span>
              <span className="li-esign2-doccard-meta">
                <span className="li-esign-wiz-doc-name">{source.documentTitle}</span>
                <span className="li-esign-wiz-doc-sub">
                  {source.versionNumber != null
                    ? `Version ${source.versionNumber} · Approved`
                    : 'Approved version'}
                  {docMarkers.length > 0 &&
                    ` · ${docMarkers.length} signature anchor${docMarkers.length === 1 ? '' : 's'} pre-placed`}
                </span>
              </span>
            </div>
            <p className="li-esign-wiz-hint">
              This envelope sends the approved version from the workflow step and files under this
              matter.
            </p>
          </div>
        )}
        {step === 0 && source.kind === 'document' && (
          <div>
            <div className="li-esign-wiz-h">Document</div>
            {renderError ? (
              <div className="alert alert-error">{renderError}</div>
            ) : (
              <div className="li-esign2-doccard">
                <span className="li-esign-doc-ico" aria-hidden="true">
                  <FileTextIcon size={20} />
                </span>
                <span className="li-esign2-doccard-meta">
                  <span className="li-esign-wiz-doc-name">
                    {draft.subject.trim() || 'Document draft'}
                  </span>
                  <span className="li-esign-wiz-doc-sub">
                    {primaryRender?.bytes ? 'Rendered for placement' : 'Rendering…'}
                    {docMarkers.length > 0 &&
                      ` · ${docMarkers.length} signature anchor${docMarkers.length === 1 ? '' : 's'} pre-placed`}
                  </span>
                </span>
              </div>
            )}
            <div className="li-esign-wiz-h li-esign-attach-h">Attach to (optional)</div>
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

        {step === 0 && !isLocked && (
          <div>
            <div className="li-esign-wiz-h">
              {draft.documents.length > 1 ? 'Documents' : 'Document'}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                addFiles(e.target.files)
                if (fileRef.current) fileRef.current.value = ''
              }}
            />
            {draft.documents.length > 0 ? (
              // ES-MULTIDOC-1 — one card per document; a single upload looks the
              // same as before (one card, no reorder chevrons shown for 1 doc).
              <>
                <div className="li-esign2-doclist">
                  {draft.documents.map((d, i) => (
                    <DocCard
                      key={d.id}
                      index={i}
                      total={draft.documents.length}
                      name={d.file.name}
                      sizeKb={d.file.size / 1024}
                      bytes={docRenders[d.id]?.bytes ?? null}
                      onUp={() => moveDocument(d.id, -1)}
                      onDown={() => moveDocument(d.id, 1)}
                      onRemove={() => removeDocument(d.id)}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="li-esign-btn li-esign-btn--sm li-esign2-addmore"
                  onClick={() => fileRef.current?.click()}
                >
                  <PlusIcon size={14} />
                  Add another PDF
                </button>
              </>
            ) : (
              <button
                type="button"
                className="li-esign-filedrop"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  addFiles(e.dataTransfer.files)
                }}
              >
                <span className="li-esign-doc-ico" aria-hidden="true">
                  <UploadIcon size={20} />
                </span>
                <span className="li-esign-filedrop-text">
                  <span className="li-esign-wiz-doc-name">Upload PDFs</span>
                  <span className="li-esign-wiz-doc-sub">
                    Drop them here or click to choose — one document or several in one envelope
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
                <button
                  type="button"
                  className="li-esign-btn li-esign-btn--sm"
                  onClick={addRecipient}
                >
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
          <div className="li-esp-step">
            <div className="li-esign-wiz-h">Fields</div>
            {signingRecipients.length === 0 ? (
              <div className="li-esign2-fields-note">
                <p className="li-esign-wiz-hint">
                  No signing recipients yet — add one on the Recipients step, then place their
                  fields here.
                </p>
              </div>
            ) : (
              <>
                <p className="li-esign-wiz-hint li-esp-step-hint">
                  Drag fields from the palette onto the document — each lands where you drop it,
                  color-coded per signer. A document sent with no placed fields uses whole-document
                  signing with the signature certificate.
                </p>
                {renderError && <div className="alert alert-error">{renderError}</div>}
                <FieldPlacer
                  documents={composerDocs.map((d) => ({
                    title: d.title,
                    pdfData: docRenders[d.id]?.bytes ?? null,
                  }))}
                  activeDocIndex={activeDocSafe}
                  onActiveDocChange={setActiveDoc}
                  signers={placerSigners}
                  placements={draft.placements}
                  onChange={setPlacements}
                  valuesById={canvasValues}
                />
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="li-esign-wiz-h">Review &amp; send</div>
            {/* ES-MULTIDOC-1 — preview EVERY document in order; each shows all of
                its pages stacked with its own placed fields drawn read-only.
                Presentation only — the send payload is untouched. */}
            <div className="li-esp-review-docs">
              {composerDocs.map((d, i) => (
                <ReviewDocPreview
                  key={d.id}
                  title={composerDocs.length > 1 ? d.title : null}
                  docIndex={i}
                  bytes={docRenders[d.id]?.bytes ?? null}
                  placements={draft.placements}
                  toneBySigner={Object.fromEntries(
                    placerSigners.map((s) => [s.signerKey, s.toneIndex]),
                  )}
                  valuesById={canvasValues}
                />
              ))}
            </div>
            <div className="li-esign-wiz-review">
              <div className="li-esign-wiz-reviewrow">
                <span className="li-esign-wiz-reviewk">Subject</span>
                <input
                  className="li-esign-wiz-in li-esign-subject-in"
                  value={draft.subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={
                    (source.kind === 'workflow-step'
                      ? source.documentTitle
                      : draft.documents[0]?.title) || 'Document title'
                  }
                  aria-label="Envelope subject"
                />
              </div>
              <div className="li-esign-wiz-reviewrow">
                <span className="li-esign-wiz-reviewk">
                  {draft.documents.length > 1 ? 'Documents' : 'Document'}
                </span>
                <span className="li-esign-wiz-reviewv">
                  {source.kind === 'workflow-step'
                    ? `${source.documentTitle}${
                        source.versionNumber != null ? ` (v${source.versionNumber}, approved)` : ''
                      }`
                    : source.kind === 'document'
                      ? source.title || draft.subject.trim() || 'Document'
                      : draft.documents.length > 1
                        ? `${draft.documents.length} documents · ${draft.documents
                            .map((d) => d.file.name)
                            .join(', ')}`
                        : (draft.documents[0]?.file.name ?? '—')}
                </span>
              </div>
              <div className="li-esign-wiz-reviewrow">
                <span className="li-esign-wiz-reviewk">Filed under</span>
                <span className="li-esign-wiz-reviewv">
                  {isWorkflowStep
                    ? 'This matter (workflow e-sign step)'
                    : [
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
                    <span
                      key={i}
                      className={`li-esign2-rolechip ${signerToneClass(draft.recipients.indexOf(r))}`}
                    >
                      <span className="li-esign2-signer-dot" aria-hidden="true" />
                      {r.name.trim() && `${r.name.trim()} `}
                      {/* ES-5b (founder-priority): the full email is always shown so
                          a mistyped address is caught here, before sending. */}
                      <span className="li-esign2-rolechip-email">{r.email.trim()}</span>
                      <em>{ROLE_LABELS[r.role]}</em>
                    </span>
                  ))}
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

// ES-MULTIDOC-1 — one document card in the Documents step: name + page count,
// reorder chevrons (only when the envelope has 2+ documents), remove. Page count
// comes from the loaded PDF; a single-document upload reads exactly as before.
function DocCard({
  index,
  total,
  name,
  sizeKb,
  bytes,
  onUp,
  onDown,
  onRemove,
}: {
  index: number
  total: number
  name: string
  sizeKb: number
  bytes: ArrayBuffer | null
  onUp: () => void
  onDown: () => void
  onRemove: () => void
}) {
  const { pages } = usePdfDocument(bytes)
  const pageLabel = pages.length ? `${pages.length} page${pages.length === 1 ? '' : 's'} · ` : ''
  return (
    <div className="li-esign2-doccard">
      {total > 1 && (
        <span className="li-esign2-docorder" aria-hidden="true">
          {index + 1}
        </span>
      )}
      <span className="li-esign-doc-ico" aria-hidden="true">
        <FileTextIcon size={20} />
      </span>
      <span className="li-esign2-doccard-meta">
        <span className="li-esign-wiz-doc-name">{name}</span>
        <span className="li-esign-wiz-doc-sub">
          {pageLabel}
          {sizeKb.toFixed(0)} KB · PDF
        </span>
      </span>
      <span className="li-esign2-doccard-actions">
        {total > 1 && (
          <>
            <button
              type="button"
              className="li-esign-btn li-esign-btn--sm"
              onClick={onUp}
              disabled={index === 0}
              aria-label="Move document up"
              title="Move up"
            >
              <ChevronDownIcon size={14} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <button
              type="button"
              className="li-esign-btn li-esign-btn--sm"
              onClick={onDown}
              disabled={index === total - 1}
              aria-label="Move document down"
              title="Move down"
            >
              <ChevronDownIcon size={14} />
            </button>
          </>
        )}
        <button
          type="button"
          className="li-esign-btn li-esign-btn--sm"
          aria-label="Remove document"
          onClick={onRemove}
        >
          <XIcon size={14} />
        </button>
      </span>
    </div>
  )
}

// ES-MULTIDOC-1 — one document's read-only preview on the Review step: all pages
// stacked with that document's placed fields drawn at their positions. Its own
// pdfjs load (the review step mounts these only when reached).
function ReviewDocPreview({
  title,
  docIndex,
  bytes,
  placements,
  toneBySigner,
  valuesById,
}: {
  title: string | null
  docIndex: number
  bytes: ArrayBuffer | null
  placements: FieldPlacement[]
  toneBySigner: Record<string, number>
  valuesById?: Record<string, string | null>
}) {
  const { doc, pages } = usePdfDocument(bytes)
  const docPlacements = placements.filter((p) => (p.docIndex ?? 0) === docIndex)
  if (!doc) return null
  return (
    <div className="li-esp-review">
      {title && <div className="li-esign-wiz-doc-name li-esp-review-title">{title}</div>}
      <PdfCanvas
        doc={doc}
        pages={pages}
        zoom="fit"
        placements={docPlacements}
        toneBySigner={toneBySigner}
        readOnly
        valuesById={valuesById}
      />
      {docPlacements.length > 0 && (
        <div className="li-esign-wiz-doc-sub li-esp-review-sub">
          {docPlacements.length} field{docPlacements.length === 1 ? '' : 's'} placed
          {pages.length > 1 ? ` · ${pages.length} pages` : ''}
        </div>
      )}
    </div>
  )
}
