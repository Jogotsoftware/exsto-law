'use client'

// Shared signing surface used by BOTH the authenticated portal sign page and the
// public token-link fallback page. Renders the document, the signer's fields, the
// adopted-signature capture (Type with a style picker, or Draw) + ESIGN/UETA
// consent, and Sign / Decline. The caller supplies onSign/onDecline (portal MCP
// vs /api/sign routes).
//
// ESIGN-UNIFY-1 ES-2 (§9.3): rebuilt on the overlay renderer. A FILE envelope
// with coordinate placements renders the REAL PDF pages (PdfCanvas) with this
// signer's field boxes at their true positions — tap a box to fill it (a
// signature box jumps to the adopt capture below); `date` boxes read "(auto)"
// and fill with the actual signing date at submit (the signer never types a
// date); required text boxes gate the Sign button. Legacy envelopes (markdown
// drafts, or files sent without placements) keep the exact pre-ES-2 flow. The
// adopt-signature capture itself is extracted UNCHANGED to
// components/esign/AdoptSignature.tsx and shared.
import { useEffect, useMemo, useState } from 'react'
import type { FieldPlacement } from '@exsto/legal/esign'
import { useConfirm } from '@/components/ConfirmModal'
import { ScaleIcon } from '@/components/icons'
import { renderDocumentHtml } from '@/lib/documentHtml'
import { PRODUCT_TAGLINE } from '@/lib/brand'
import {
  AdoptSignature,
  CONSENT_TEXT,
  type AdoptState,
  type SavedSignature,
} from '@/components/esign/AdoptSignature'
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
  savedSignature,
  onSign,
  onDecline,
}: {
  doc: SignableDoc
  /** 0170: token/session-gated streaming URL for a file (PDF) envelope. */
  fileUrl?: string | null
  savedSignature?: SavedSignature | null
  onSign: (a: {
    signatureName: string
    signatureData: string | null
    fieldValues: Record<string, string>
    consent: string
  }) => Promise<{ completed: boolean }>
  onDecline: () => Promise<void>
}) {
  const placements = useMemo(() => doc.placements ?? [], [doc.placements])
  const overlayMode = Boolean(doc.isFile && fileUrl && placements.length > 0)

  const [adopt, setAdopt] = useState<AdoptState>({
    signatureName: doc.signerName ?? '',
    signatureData: null,
    consent: false,
  })
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(doc.fields.filter((f) => f.prefill).map((f) => [f.id, f.prefill!])),
  )
  const [busy, setBusy] = useState<null | 'sign' | 'decline'>(null)
  const { confirm, confirmElement } = useConfirm()
  const [done, setDone] = useState<null | 'signed' | 'completed' | 'declined'>(null)
  const [error, setError] = useState<string | null>(null)

  // Overlay mode (§9.3): fetch the PDF bytes through the token/session-gated
  // URL and render REAL pages. Legacy file envelopes keep the plain iframe.
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
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [overlayMode, fileUrl])
  const pdf = usePdfDocument(overlayMode ? pdfBytes : null)

  // Fields the signer actually fills here (the adopted signature covers {{sign:…}}).
  const inputFields = doc.fields.filter((f) => f.type !== 'sign')

  // §9.3 — what each overlay box shows right now: the send-time resolved value,
  // the signer's live input, the adopted signature, or the "(auto)" date copy.
  const overlayValues = useMemo(() => {
    const out: Record<string, string | null> = {}
    for (const p of placements) {
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
  }, [placements, adopt, fieldValues, doc.signerName])

  // Required gate (§9.3): every required signer-fillable text box needs a value
  // before Sign unlocks. Signature/initials ride the adopted name; date is auto.
  const missingRequired = useMemo(
    () =>
      placements.filter(
        (p) =>
          p.required &&
          !['sign', 'initial', 'name', 'date'].includes(p.type) &&
          !(p.value ?? '').trim() &&
          !(fieldValues[p.id] ?? '').trim(),
      ),
    [placements, fieldValues],
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

  // Tap-a-box (§9.3): a text-ish box focuses its input in the panel below; a
  // signature/initials box jumps to the adopt capture.
  function activateBox(id: string) {
    const p = placements.find((x) => x.id === id)
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

  return (
    <div className="public-draft li-cp-sign">
      {confirmElement}
      {head()}
      <div className="li-cp-sign-for">
        For signature{doc.signerName ? ` by ${doc.signerName}` : ''}
        {doc.signerTitle ? ` (${doc.signerTitle})` : ''}
      </div>

      {overlayMode ? (
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
              readOnly
              valuesById={overlayValues}
              onActivate={activateBox}
            />
          )}
        </div>
      ) : doc.isFile && fileUrl ? (
        <div className="li-cp-sign-file">
          <iframe
            src={fileUrl}
            title={doc.fileName ?? doc.documentTitle}
            className="li-cp-sign-pdfframe"
          />
          <a href={fileUrl} target="_blank" rel="noreferrer" className="li-cp-linkbtn">
            Open {doc.fileName ?? 'document'} in a new tab
          </a>
        </div>
      ) : (
        <div
          className="doc-rendered"
          dangerouslySetInnerHTML={{ __html: renderDocumentHtml(doc.bodyMarkdown) }}
        />
      )}

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

        {overlayMode && (
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

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}
