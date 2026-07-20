'use client'

// Shared signing surface used by BOTH the authenticated portal sign page and the
// public token-link fallback page. Renders the document, the signer's fields, the
// adopted-signature capture (Type with a style picker, or Draw) + ESIGN/UETA
// consent, and Sign / Decline. The caller supplies onSign/onDecline (portal MCP
// vs /api/sign routes).
//
// LI PORTAL RESTYLE: the adopt-signature block now matches the comp's "Adopt your
// signature" screen — a Type/Draw toggle, and in Type mode three cursive style
// choices. Styles/draw are ADDITIVE: with no style chosen it behaves exactly as
// before (typed legal name, no image). A chosen style or a drawn signature is
// captured as `signatureData` (a data-URL image), which every caller/back end
// already accepts.
import { useRef, useState } from 'react'
import { useConfirm } from '@/components/ConfirmModal'
import { ScaleIcon } from '@/components/icons'
import { renderDocumentHtml } from '@/lib/documentHtml'
import { PRODUCT_TAGLINE } from '@/lib/brand'

export interface SignField {
  id: string
  type: string
  label: string
  prefill?: string
}
// The signer's standing signature (P15), when the caller resolved one — today
// that's a signed-in attorney opening their OWN signature request. Typed
// prefills the name field; drawn/uploaded offers the saved image, passed
// through onSign as signatureData. Callers that pass nothing (anonymous /
// client signers) see the surface unchanged.
export interface SavedSignature {
  mode: 'typed' | 'drawn' | 'uploaded'
  name: string
  data: string | null
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
  canSign: boolean
  alreadyResolved: boolean
  // FB-C — the resolved firm's name (never a hardcoded literal). Optional so
  // any other existing caller keeps compiling; the component falls back to
  // the product tagline when absent.
  firmName?: string | null
}

export const CONSENT_TEXT =
  'I agree to sign this document electronically and that my electronic signature ' +
  'is the legal equivalent of my handwritten signature (ESIGN / UETA).'

// Cursive style choices for typed adoption (comp "Choose a style"). Each renders
// the typed name in the given font; the selection is rasterized to a data-URL on
// submit so the chosen look travels as signatureData.
const SIGNATURE_STYLES: Array<{ font: string; italic: boolean }> = [
  { font: "'EB Garamond', Georgia, serif", italic: true },
  { font: '"Brush Script MT", "Segoe Script", cursive', italic: false },
  { font: '"Snell Roundhand", "Apple Chancery", cursive', italic: true },
]

// Rasterize the typed name in a chosen script font → data-URL (transparent bg).
function renderTypedSignature(
  name: string,
  style: { font: string; italic: boolean },
): string | null {
  if (typeof document === 'undefined' || !name.trim()) return null
  const canvas = document.createElement('canvas')
  const scale = 2
  canvas.width = 440 * scale
  canvas.height = 120 * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(scale, scale)
  ctx.fillStyle = '#1b2a4a'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.font = `${style.italic ? 'italic ' : ''}52px ${style.font}`
  ctx.fillText(name.trim(), 220, 62, 420)
  return canvas.toDataURL('image/png')
}

// A minimal draw pad → data-URL. Owns its own canvas ref and reports the drawn
// signature (or null after a clear) up through onCommit, so the parent never has
// to thread a DOM ref across the component boundary.
function DrawPad({ onCommit }: { onCommit: (data: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [hasInk, setHasInk] = useState(false)

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = ref.current!
    const rect = c.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (c.width / rect.width),
      y: (e.clientY - rect.top) * (c.height / rect.height),
    }
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = pos(e)
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !ref.current) return
    const ctx = ref.current.getContext('2d')
    if (!ctx) return
    const p = pos(e)
    ctx.strokeStyle = '#1b2a4a'
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(last.current!.x, last.current!.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    setHasInk(true)
  }
  function up() {
    drawing.current = false
    last.current = null
    if (hasInk && ref.current) onCommit(ref.current.toDataURL('image/png'))
  }
  function clear() {
    const c = ref.current
    if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height)
    setHasInk(false)
    onCommit(null)
  }
  return (
    <>
      <canvas
        ref={ref}
        width={880}
        height={300}
        className="li-cp-adopt-pad"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
      />
      {hasInk && (
        <button type="button" className="li-cp-linkbtn" onClick={clear}>
          Clear
        </button>
      )}
    </>
  )
}

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
  // A saved image signature (drawn/uploaded) the signer can apply as-is.
  const savedImage =
    savedSignature && savedSignature.mode !== 'typed' && savedSignature.data
      ? savedSignature.data
      : null
  const [signatureName, setSignatureName] = useState(
    savedSignature?.mode === 'typed' && savedSignature.name.trim()
      ? savedSignature.name
      : (doc.signerName ?? ''),
  )
  const [useSavedImage, setUseSavedImage] = useState(true)
  const [mode, setMode] = useState<'type' | 'draw'>('type')
  const [styleIdx, setStyleIdx] = useState<number | null>(null)
  const [drawData, setDrawData] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(doc.fields.filter((f) => f.prefill).map((f) => [f.id, f.prefill!])),
  )
  const [busy, setBusy] = useState<null | 'sign' | 'decline'>(null)
  const { confirm, confirmElement } = useConfirm()
  const [done, setDone] = useState<null | 'signed' | 'completed' | 'declined'>(null)
  const [error, setError] = useState<string | null>(null)

  // Fields the signer actually fills here (the adopted signature covers {{sign:…}}).
  const inputFields = doc.fields.filter((f) => f.type !== 'sign')

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

  // Resolve the signature image to attach (if any) at submit time.
  function resolveSignatureData(): string | null {
    if (savedImage && useSavedImage) return savedImage
    if (mode === 'draw' && drawData) return drawData
    if (mode === 'type' && styleIdx !== null) {
      return renderTypedSignature(signatureName, SIGNATURE_STYLES[styleIdx]!)
    }
    return null
  }

  async function submit() {
    setBusy('sign')
    setError(null)
    try {
      const r = await onSign({
        signatureName,
        signatureData: resolveSignatureData(),
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

  return (
    <div className="public-draft li-cp-sign">
      {confirmElement}
      {head()}
      <div className="li-cp-sign-for">
        For signature{doc.signerName ? ` by ${doc.signerName}` : ''}
        {doc.signerTitle ? ` (${doc.signerTitle})` : ''}
      </div>

      {doc.isFile && fileUrl ? (
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

      <div className="li-cp-adopt">
        <h3 className="li-cp-adopt-h">Adopt your signature</h3>

        {inputFields.length > 0 && (
          <div className="li-cp-adopt-fields">
            {inputFields.map((f) => (
              <div key={f.id} className="li-cp-field">
                <label className="li-cp-label">{f.label}</label>
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

        {savedImage ? (
          // Attorney standing signature — offer it directly (existing behavior).
          <div className="li-cp-field">
            <label className="li-cp-adopt-saved">
              <input
                type="checkbox"
                checked={useSavedImage}
                onChange={(e) => setUseSavedImage(e.target.checked)}
              />
              <span>Use my saved signature</span>
            </label>
            {useSavedImage && (
              <img src={savedImage} alt="Your saved signature" className="li-cp-adopt-savedimg" />
            )}
          </div>
        ) : (
          <>
            <div className="li-cp-seg li-cp-seg--wide">
              <button
                type="button"
                className={`li-cp-seg-btn ${mode === 'type' ? 'active' : ''}`}
                onClick={() => setMode('type')}
              >
                Type
              </button>
              <button
                type="button"
                className={`li-cp-seg-btn ${mode === 'draw' ? 'active' : ''}`}
                onClick={() => setMode('draw')}
              >
                Draw
              </button>
            </div>

            <div className="li-cp-field">
              <label className="li-cp-label" htmlFor="sig">
                Full legal name
              </label>
              <input
                id="sig"
                className="li-cp-input"
                type="text"
                value={signatureName}
                onChange={(e) => setSignatureName(e.target.value)}
                placeholder="Your full name"
              />
            </div>

            {mode === 'type' && signatureName.trim() && (
              <div className="li-cp-field">
                <label className="li-cp-label">Choose a style</label>
                <div className="li-cp-adopt-styles">
                  {SIGNATURE_STYLES.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`li-cp-adopt-style ${styleIdx === i ? 'selected' : ''}`}
                      onClick={() => setStyleIdx(i)}
                    >
                      <span
                        style={{ fontFamily: s.font, fontStyle: s.italic ? 'italic' : 'normal' }}
                      >
                        {signatureName.trim()}
                      </span>
                      {styleIdx === i && (
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#c6a968"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === 'draw' && (
              <div className="li-cp-field">
                <label className="li-cp-label">Draw your signature</label>
                <DrawPad onCommit={setDrawData} />
              </div>
            )}
          </>
        )}

        <label className="li-cp-adopt-consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{CONSENT_TEXT}</span>
        </label>

        {error && (
          <div role="alert" className="alert alert-error">
            {error}
          </div>
        )}

        <div className="li-cp-adopt-actions">
          <button
            type="button"
            className="li-cp-btn"
            disabled={busy !== null || !signatureName.trim() || !consent}
            onClick={submit}
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
