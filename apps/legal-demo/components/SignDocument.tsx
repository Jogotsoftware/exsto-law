'use client'

// Shared signing surface used by BOTH the authenticated portal sign page and the
// public token-link fallback page. Renders the document, the signer's fields, the
// adopted-signature capture (Type with a style picker, or Draw) + ESIGN/UETA
// consent, and Sign / Decline. The caller supplies onSign/onDecline (portal MCP
// vs /api/sign routes).
//
// ESIGN-GUIDED-1 — a placement envelope (allPlacements.length > 0) now renders
// a DocuSign-style GUIDED walk instead of the old canvas-plus-detached-form
// split: the signer adopts their signature ONCE, up front (before the document
// even renders), then a sticky top bar walks them field-by-field — click a
// signature/initials box to stamp the adopted signature in place, click a text
// box to type inline, click a checkbox to toggle it — with Start/Next/Finish
// tracking progress. A legacy envelope with NO placements (markdown draft, or a
// file sent without placements) keeps the exact pre-existing detached-list flow
// below, untouched. The adopt-signature capture itself is UNCHANGED
// (components/esign/AdoptSignature.tsx) and shared by both paths.
import { useEffect, useMemo, useState } from 'react'
import type { FieldPlacement } from '@exsto/legal/esign'
import { useConfirm } from '@/components/ConfirmModal'
import { ScaleIcon } from '@/components/icons'
import { renderDocumentHtml } from '@/lib/documentHtml'
import { PRODUCT_TAGLINE } from '@/lib/brand'
import {
  guidedCtaLabel,
  guidedFieldsOf,
  guidedProgress,
  guidedProgressLabel,
  isGuidedField,
  isPlacementFilled,
  nextIncompleteField,
  type FilledContext,
} from '@/lib/esignGuidedSign'
import {
  AdoptSignature,
  CONSENT_TEXT,
  type AdoptState,
  type SavedSignature,
} from '@/components/esign/AdoptSignature'
import type { GuidedFieldState } from '@/components/esign/FieldBox'
import { GuidedSignBar } from '@/components/esign/GuidedSignBar'
import { PdfCanvas } from '@/components/esign/PdfCanvas'
import { usePdfDocument } from '@/components/esign/usePdfDocument'

export { CONSENT_TEXT }
export type { SavedSignature }

export interface SignField {
  id: string
  type: string
  label: string
  prefill?: string
}
/** ES-MULTIDOC-1 — one document the signer sees, with THIS signer's fields on
 *  it. An envelope carrying one document has exactly one of these (mirroring the
 *  flat fields below); a multi-document envelope has several, rendered in order. */
export interface SignerDocView {
  docIndex: number
  documentTitle: string
  bodyMarkdown: string
  isFile?: boolean
  fileName?: string | null
  fields: SignField[]
  placements?: FieldPlacement[]
}
export interface SignableDoc {
  documentTitle: string
  bodyMarkdown: string
  // 0170 — uploaded-file envelope (PDF): the caller passes fileUrl and the
  // surface renders the file inline instead of markdown.
  isFile?: boolean
  fileName?: string | null
  signerName: string | null
  signerEmail: string | null
  signerTitle: string | null
  signerStatus: string
  envelopeStatus: string | null
  fields: SignField[]
  /** ES-2 (§9.3) — this signer's coordinate placements (empty = legacy flow). */
  placements?: FieldPlacement[]
  /** ES-MULTIDOC-1 — every document in the envelope, in order. When present with
   *  2+ entries the surface renders them all; absent/one entry reads exactly as
   *  the single-document flow (the flat fields above). */
  documents?: SignerDocView[]
  canSign: boolean
  alreadyResolved: boolean
  // FB-C — the resolved firm's name (never a hardcoded literal). Optional so
  // any other existing caller keeps compiling; the component falls back to
  // the product tagline when absent.
  firmName?: string | null
}

// The signer's own boxes all render in tone 1 (their color); the §4 multi-
// signer tinting matters on the ATTORNEY canvas — here only this signer's
// fields are shown.
const SIGNER_TONE = 1

export function SignDocument({
  doc,
  fileUrl,
  fileUrlForDoc,
  savedSignature,
  onSign,
  onDecline,
}: {
  doc: SignableDoc
  /** 0170: token/session-gated streaming URL for a file (PDF) envelope. The
   *  primary (document 0) for a single-document envelope. */
  fileUrl?: string | null
  /** ES-MULTIDOC-1: the streaming URL for one document of the set (`?doc=N`).
   *  When provided, the multi-document surface fetches each document's bytes
   *  through it; falls back to `fileUrl` for document 0. */
  fileUrlForDoc?: (docIndex: number) => string | null
  savedSignature?: SavedSignature | null
  onSign: (a: {
    signatureName: string
    signatureData: string | null
    fieldValues: Record<string, string>
    consent: string
  }) => Promise<{ completed: boolean }>
  onDecline: () => Promise<void>
}) {
  // ES-MULTIDOC-1 — the ordered documents the signer sees. The flat fields
  // describe the primary (document 0), so a one-document envelope synthesizes a
  // single view and reads exactly as the pre-multidoc flow.
  const docs: SignerDocView[] = useMemo(
    () =>
      doc.documents && doc.documents.length > 0
        ? doc.documents
        : [
            {
              docIndex: 0,
              documentTitle: doc.documentTitle,
              bodyMarkdown: doc.bodyMarkdown,
              isFile: doc.isFile,
              fileName: doc.fileName,
              fields: doc.fields,
              placements: doc.placements ?? [],
            },
          ],
    [doc],
  )
  // The signature capture, the required-gate, and the Sign action are ONE per
  // envelope — signing completes every document at once. So values aggregate
  // across ALL documents (placement ids are envelope-unique).
  const allPlacements = useMemo(() => docs.flatMap((d) => d.placements ?? []), [docs])
  const hasPlacements = allPlacements.length > 0
  // Fields the signer actually fills here (the adopted signature covers {{sign:…}}).
  const inputFields = useMemo(
    () => docs.flatMap((d) => d.fields).filter((f) => f.type !== 'sign'),
    [docs],
  )
  const fileUrlFor = (docIndex: number): string | null =>
    fileUrlForDoc ? fileUrlForDoc(docIndex) : docIndex === 0 ? (fileUrl ?? null) : null

  const [adopt, setAdopt] = useState<AdoptState>({
    signatureName: doc.signerName ?? '',
    signatureData: null,
    consent: false,
  })
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      docs
        .flatMap((d) => d.fields)
        .filter((f) => f.prefill)
        .map((f) => [f.id, f.prefill!]),
    ),
  )
  const [busy, setBusy] = useState<null | 'sign' | 'decline'>(null)
  const { confirm, confirmElement } = useConfirm()
  const [done, setDone] = useState<null | 'signed' | 'completed' | 'declined'>(null)
  const [error, setError] = useState<string | null>(null)

  // ESIGN-GUIDED-1 — the guided walk's own state. `stage` gates the up-front
  // adopt screen vs the document; `appliedIds` are sign/initial placements the
  // signer has clicked (per-field — the whole point is watching it happen one
  // box at a time, not everything filling at once from the adopted name).
  const [stage, setStage] = useState<'adopt' | 'signing'>('adopt')
  const [appliedIds, setAppliedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [currentFieldId, setCurrentFieldId] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)

  // §9.3 — what each overlay box shows right now: the send-time resolved value,
  // the signer's live input, the adopted signature, or the "(auto)" date copy.
  // (Legacy path only — sign/initial fill the moment a signature is adopted,
  // matching the old single-step Adopt & Sign flow.)
  const overlayValues = useMemo(() => {
    const out: Record<string, string | null> = {}
    for (const p of allPlacements) {
      if (p.type === 'sign' || p.type === 'initial') {
        out[p.id] =
          adopt.signatureData || adopt.signatureName.trim()
            ? p.type === 'initial'
              ? initialsOf(adopt.signatureName)
              : adopt.signatureName.trim()
            : null
      } else if (p.type === 'date') {
        out[p.id] = null // the box label renders "(auto)"
      } else if (p.type === 'name') {
        out[p.id] = adopt.signatureName.trim() || doc.signerName || null
      } else {
        out[p.id] = p.value ?? fieldValues[p.id] ?? null
      }
    }
    return out
  }, [allPlacements, adopt, fieldValues, doc.signerName])

  // ESIGN-GUIDED-1 — the guided walk's field set (sign/initial/data fields the
  // signer acts on; date/name/already-resolved never appear here), in reading
  // order across every document in the envelope.
  const guidedList = useMemo(() => guidedFieldsOf(allPlacements), [allPlacements])
  const filledCtx: FilledContext = { fieldValues, appliedIds }
  const progress = useMemo(
    () => guidedProgress(guidedList, filledCtx),
    [guidedList, fieldValues, appliedIds],
  )
  const allRequiredDone = progress.completed >= progress.total
  const canContinueFromAdopt = Boolean(
    adopt.signatureName.trim() && adopt.consent && adopt.signatureData,
  )
  const ctaLabel = guidedCtaLabel(started, allRequiredDone)
  const todayStr = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
    [],
  )

  // Guided-mode display values: sign/initial fill ONLY once clicked (not the
  // instant a signature is adopted — the founder brief's "watch it happen
  // field by field"); date visibly fills the moment the FIRST signature/
  // initial is applied (still purely presentational — the real signing date is
  // stamped server-side, buildSignable never lets the signer type one).
  const guidedValuesById = useMemo(() => {
    const out: Record<string, string | null> = {}
    for (const p of allPlacements) {
      if (p.type === 'sign' || p.type === 'initial') {
        out[p.id] = appliedIds.has(p.id)
          ? p.type === 'initial'
            ? initialsOf(adopt.signatureName)
            : adopt.signatureName.trim()
          : null
      } else if (p.type === 'date') {
        out[p.id] = appliedIds.size > 0 ? todayStr : null
      } else if (p.type === 'name') {
        out[p.id] = adopt.signatureName.trim() || doc.signerName || null
      } else {
        out[p.id] = p.value ?? fieldValues[p.id] ?? null
      }
    }
    return out
  }, [allPlacements, adopt, fieldValues, appliedIds, doc.signerName, todayStr])

  // The actual signature/initials IMAGE to stamp in place once applied —
  // exactly the image stampPdf.ts embeds into the executed PDF (both sign and
  // initial placements draw the same adopted image, scaled to the box).
  const guidedImagesById = useMemo(() => {
    const out: Record<string, string | null> = {}
    for (const p of allPlacements) {
      if ((p.type === 'sign' || p.type === 'initial') && appliedIds.has(p.id)) {
        out[p.id] = adopt.signatureData
      }
    }
    return out
  }, [allPlacements, adopt.signatureData, appliedIds])

  const guidedStates = useMemo(() => {
    const out: Record<string, GuidedFieldState> = {}
    for (const p of allPlacements) {
      const auto = !isGuidedField(p)
      out[p.id] = {
        auto,
        complete: auto ? true : isPlacementFilled(p, filledCtx),
        editing: editingFieldId === p.id,
      }
    }
    return out
  }, [allPlacements, fieldValues, appliedIds, editingFieldId])

  // Required gate (§9.3, legacy path): every required signer-fillable text box
  // needs a value before Sign unlocks. Signature/initials ride the adopted
  // name; date is auto.
  const missingRequired = useMemo(
    () =>
      allPlacements.filter(
        (p) =>
          p.required &&
          !['sign', 'initial', 'name', 'date'].includes(p.type) &&
          !(p.value ?? '').trim() &&
          !(fieldValues[p.id] ?? '').trim(),
      ),
    [allPlacements, fieldValues],
  )

  function head() {
    return (
      <div className="public-draft-head">
        <div>
          <div className="pd-brandrow">
            <span className="cp-crest" aria-hidden>
              <ScaleIcon size={18} />
            </span>
            <div className="public-draft-firm">{doc.firmName ?? PRODUCT_TAGLINE}</div>
          </div>
          <h1 style={{ margin: 'var(--space-1) 0 0' }}>{doc.documentTitle}</h1>
        </div>
      </div>
    )
  }

  function signerLine() {
    return (
      <div className="li-cp-sign-for">
        For signature{doc.signerName ? ` by ${doc.signerName}` : ''}
        {doc.signerTitle ? ` (${doc.signerTitle})` : ''}
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
        <div
          role="status"
          aria-live="polite"
          className={`alert ${done === 'declined' ? 'alert-error' : 'alert-success'}`}
        >
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
      const r = await onSign({
        signatureName: adopt.signatureName,
        signatureData: adopt.signatureData,
        fieldValues,
        consent: CONSENT_TEXT,
      })
      setDone(r.completed ? 'completed' : 'signed')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  async function decline() {
    const ok = await confirm({
      title: 'Decline to sign?',
      body: 'Records that you decline to sign this document. The sender is notified.',
      confirmLabel: 'Decline to sign',
      danger: true,
    })
    if (!ok) return
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

  // Tap-a-box (§9.3, legacy path only): a text-ish box focuses its input in
  // the panel below; a signature/initials box jumps to the adopt capture.
  function activateBox(id: string) {
    const p = allPlacements.find((x) => x.id === id)
    if (!p) return
    if (p.type === 'sign' || p.type === 'initial') {
      document.getElementById('li-cp-adopt-anchor')?.scrollIntoView({ behavior: 'smooth' })
      return
    }
    const input = document.getElementById(`esign-field-${id}`)
    if (input) {
      input.scrollIntoView({ behavior: 'smooth', block: 'center' })
      ;(input as HTMLInputElement).focus?.()
    }
  }

  function scrollToField(id: string) {
    document
      .getElementById(`esp-field-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // Move the guided "current" pointer to the next incomplete field after
  // `afterId` (null = start from the beginning), using the FRESH filled state
  // the caller just computed (not the stale render-scope closure).
  function advanceGuided(
    applied: ReadonlySet<string>,
    values: Record<string, string>,
    afterId: string | null,
  ) {
    const next = nextIncompleteField(
      guidedList,
      { fieldValues: values, appliedIds: applied },
      afterId,
    )
    setCurrentFieldId(next ? next.id : null)
    if (next) requestAnimationFrame(() => scrollToField(next.id))
  }

  // Click-to-sign (§ founder brief): sign/initial applies in place (toggle —
  // clicking an already-applied box clears it); check toggles immediately;
  // every other signer-fillable field opens its inline input. date/name and
  // already-resolved placements are inert (guided.auto) and never reach here.
  function activateGuided(id: string) {
    const p = allPlacements.find((x) => x.id === id)
    if (!p || !isGuidedField(p)) return
    setStarted(true)

    if (p.type === 'sign' || p.type === 'initial') {
      const wasApplied = appliedIds.has(id)
      const nextApplied = new Set(appliedIds)
      if (wasApplied) nextApplied.delete(id)
      else nextApplied.add(id)
      setAppliedIds(nextApplied)
      setEditingFieldId(null)
      if (!wasApplied) advanceGuided(nextApplied, fieldValues, id)
      else setCurrentFieldId(id)
      return
    }
    if (p.type === 'check') {
      const willCheck = fieldValues[id] !== 'true'
      const nextValues = { ...fieldValues, [id]: willCheck ? 'true' : '' }
      setFieldValues(nextValues)
      if (willCheck) advanceGuided(appliedIds, nextValues, id)
      else setCurrentFieldId(id)
      return
    }
    // Text-ish: toggle the inline editor (open it, or close it on a re-click).
    setEditingFieldId((cur) => (cur === id ? null : id))
    setCurrentFieldId(id)
  }

  function changeEditingValue(id: string, value: string) {
    setFieldValues((v) => ({ ...v, [id]: value }))
  }

  function commitEditing(id: string) {
    setEditingFieldId(null)
    const p = allPlacements.find((x) => x.id === id)
    if (p && isPlacementFilled(p, { fieldValues, appliedIds })) {
      advanceGuided(appliedIds, fieldValues, id)
    } else {
      setCurrentFieldId(id)
    }
  }

  function onGuidedPrimary() {
    if (allRequiredDone) {
      void submit()
      return
    }
    setStarted(true)
    advanceGuided(appliedIds, fieldValues, currentFieldId)
  }

  if (hasPlacements) {
    return (
      <div className="public-draft li-cp-sign li-esp-guided">
        {confirmElement}
        <GuidedSignBar
          title={doc.documentTitle}
          stepLabel={
            stage === 'adopt' ? 'Step 1 of 2 — Adopt your signature' : guidedProgressLabel(progress)
          }
          ctaLabel={stage === 'adopt' ? 'Continue to document' : ctaLabel}
          onPrimary={stage === 'adopt' ? () => setStage('signing') : onGuidedPrimary}
          primaryDisabled={(stage === 'adopt' && !canContinueFromAdopt) || busy !== null}
          onDecline={decline}
          declineDisabled={busy !== null}
          onEditSignature={stage === 'signing' ? () => setStage('adopt') : undefined}
          busy={busy}
        />

        {stage === 'adopt' ? (
          <div className="li-esp-guided-adopt">
            {head()}
            {signerLine()}
            <div className="li-esp-guided-intro">
              <p>
                Review {docs.length > 1 ? `${docs.length} documents` : 'the document'} below
                {progress.total > 0
                  ? ` and complete ${progress.total} required field${progress.total === 1 ? '' : 's'}`
                  : ''}
                . Adopt your signature once, here — every signature and initials field after this is
                a single click.
              </p>
            </div>
            <div className="li-cp-adopt">
              <h3 className="li-cp-adopt-h">Adopt your signature</h3>
              <AdoptSignature
                initialName={doc.signerName ?? ''}
                savedSignature={savedSignature}
                onState={setAdopt}
              />
              {error && (
                <div role="alert" className="alert alert-error">
                  {error}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {head()}
            {signerLine()}
            <div className="li-esp-sign-docs">
              {docs.map((d, i) => (
                <SignerDoc
                  key={i}
                  view={d}
                  fileUrl={fileUrlFor(d.docIndex)}
                  overlayValues={guidedValuesById}
                  imagesById={guidedImagesById}
                  guidedStates={guidedStates}
                  editingValue={editingFieldId ? (fieldValues[editingFieldId] ?? '') : undefined}
                  onEditingChange={changeEditingValue}
                  onEditingCommit={commitEditing}
                  selectedId={currentFieldId}
                  onActivate={activateGuided}
                  showTitle={docs.length > 1}
                  onError={setError}
                />
              ))}
            </div>
            {error && (
              <div role="alert" className="alert alert-error">
                {error}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="public-draft li-cp-sign">
      {confirmElement}
      {head()}
      {signerLine()}

      {/* ES-MULTIDOC-1 — render EVERY document in order; a one-document envelope
          shows exactly one (no heading), reading as the pre-multidoc surface.
          The signature capture + Sign action below are shared across them all. */}
      <div className="li-esp-sign-docs">
        {docs.map((d, i) => (
          <SignerDoc
            key={i}
            view={d}
            fileUrl={fileUrlFor(d.docIndex)}
            overlayValues={overlayValues}
            onActivate={activateBox}
            showTitle={docs.length > 1}
            onError={setError}
          />
        ))}
      </div>

      <div className="li-cp-adopt" id="li-cp-adopt-anchor">
        <h3 className="li-cp-adopt-h">Adopt your signature</h3>

        {inputFields.length > 0 && (
          <div className="li-cp-adopt-fields">
            {inputFields.map((f) => (
              <div key={f.id} className="li-cp-field">
                <label className="li-cp-label" htmlFor={`esign-field-${f.id}`}>
                  {f.label}
                </label>
                {f.type === 'check' ? (
                  <input
                    id={`esign-field-${f.id}`}
                    type="checkbox"
                    checked={fieldValues[f.id] === 'true'}
                    onChange={(e) =>
                      setFieldValues((v) => ({ ...v, [f.id]: e.target.checked ? 'true' : '' }))
                    }
                  />
                ) : (
                  <input
                    id={`esign-field-${f.id}`}
                    className="li-cp-input"
                    type="text"
                    value={fieldValues[f.id] ?? ''}
                    onChange={(e) => setFieldValues((v) => ({ ...v, [f.id]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <AdoptSignature
          initialName={doc.signerName ?? ''}
          savedSignature={savedSignature}
          onState={setAdopt}
        />

        {allPlacements.some((p) => p.type === 'date') && (
          <p className="li-esp-adopt-autonote">
            Date fields fill automatically with the date you sign — nothing to type.
          </p>
        )}

        {error && (
          <div role="alert" className="alert alert-error">
            {error}
          </div>
        )}

        <div className="li-cp-adopt-actions">
          <button
            type="button"
            className="li-cp-btn"
            disabled={
              busy !== null ||
              !adopt.signatureName.trim() ||
              !adopt.consent ||
              missingRequired.length > 0
            }
            onClick={submit}
            title={
              missingRequired.length > 0
                ? `Complete the required field${missingRequired.length === 1 ? '' : 's'}: ${missingRequired
                    .map((p) => p.label || p.type)
                    .join(', ')}`
                : undefined
            }
          >
            {busy === 'sign' && <span className="spinner" />}
            {busy === 'sign' ? 'Signing…' : 'Adopt & Sign'}
          </button>
          <button
            type="button"
            className="li-cp-btn li-cp-btn--danger"
            disabled={busy !== null}
            onClick={decline}
          >
            {busy === 'decline' ? 'Declining…' : 'Decline'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ES-MULTIDOC-1 — one document in the signer surface. A file document with this
// signer's placements renders the REAL PDF pages (PdfCanvas overlay); a file
// without placements renders the inline iframe; a markdown draft renders its
// HTML. Each file document owns its own byte fetch + pdfjs load.
function SignerDoc({
  view,
  fileUrl,
  overlayValues,
  imagesById,
  guidedStates,
  editingValue,
  onEditingChange,
  onEditingCommit,
  selectedId,
  onActivate,
  showTitle,
  onError,
}: {
  view: SignerDocView
  fileUrl: string | null
  overlayValues: Record<string, string | null>
  /** ESIGN-GUIDED-1 (guided mode only — undefined on the legacy path). */
  imagesById?: Record<string, string | null>
  guidedStates?: Record<string, GuidedFieldState>
  editingValue?: string
  onEditingChange?: (id: string, value: string) => void
  onEditingCommit?: (id: string) => void
  selectedId?: string | null
  onActivate: (id: string) => void
  showTitle: boolean
  onError: (message: string) => void
}) {
  const placements = view.placements ?? []
  const overlayMode = Boolean(view.isFile && fileUrl && placements.length > 0)
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null)
  useEffect(() => {
    if (!overlayMode || !fileUrl) return
    let cancelled = false
    fetch(fileUrl)
      .then(async (r) => {
        if (!r.ok) throw new Error('Could not load the document.')
        const buf = await r.arrayBuffer()
        if (!cancelled) setPdfBytes(buf)
      })
      .catch((e) => {
        if (!cancelled) onError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [overlayMode, fileUrl, onError])
  const pdf = usePdfDocument(overlayMode ? pdfBytes : null)

  const title = showTitle ? <div className="li-esp-sign-doctitle">{view.documentTitle}</div> : null

  if (overlayMode) {
    return (
      <div className="li-esp-sign-doc">
        {title}
        <div className="li-esp-sign-overlay">
          {pdf.error && <div className="alert alert-error">{pdf.error}</div>}
          {!pdf.doc && !pdf.error && (
            <div className="loading-block" role="status">
              <span className="spinner" /> Loading document…
            </div>
          )}
          {pdf.doc && (
            <PdfCanvas
              doc={pdf.doc}
              pages={pdf.pages}
              zoom="fit"
              placements={placements}
              toneBySigner={Object.fromEntries(placements.map((p) => [p.signerKey, SIGNER_TONE]))}
              selectedId={selectedId}
              readOnly
              valuesById={overlayValues}
              imagesById={imagesById}
              guidedStates={guidedStates}
              editingValue={editingValue}
              onEditingChange={onEditingChange}
              onEditingCommit={onEditingCommit}
              onActivate={onActivate}
            />
          )}
        </div>
      </div>
    )
  }
  if (view.isFile && fileUrl) {
    return (
      <div className="li-esp-sign-doc">
        {title}
        <div className="li-cp-sign-file">
          <iframe
            src={fileUrl}
            title={view.fileName ?? view.documentTitle}
            className="li-cp-sign-pdfframe"
          />
          <a href={fileUrl} target="_blank" rel="noreferrer" className="li-cp-linkbtn">
            Open {view.fileName ?? 'document'} in a new tab
          </a>
        </div>
      </div>
    )
  }
  return (
    <div className="li-esp-sign-doc">
      {title}
      <div
        className="doc-rendered"
        dangerouslySetInnerHTML={{ __html: renderDocumentHtml(view.bodyMarkdown) }}
      />
    </div>
  )
}

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}
