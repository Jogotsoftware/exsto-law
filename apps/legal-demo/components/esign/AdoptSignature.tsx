'use client'

// ESIGN-UNIFY-1 ES-2 (§9.3) — the adopt-signature capture, extracted UNCHANGED
// from SignDocument.tsx so the rebuilt overlay signer surface and any future
// surface share ONE capture: Type (3 cursive styles rasterized to a data-URL),
// Draw pad, saved standing signature, and the ESIGN/UETA consent line. The
// component is controlled — the parent reads name/signatureData/consent through
// onState on every change and owns the submit buttons.
import { useEffect, useRef, useState } from 'react'

export const CONSENT_TEXT =
  'I agree to sign this document electronically and that my electronic signature ' +
  'is the legal equivalent of my handwritten signature (ESIGN / UETA).'

export interface SavedSignature {
  mode: 'typed' | 'drawn' | 'uploaded'
  name: string
  data: string | null
}

export interface AdoptState {
  signatureName: string
  signatureData: string | null
  consent: boolean
}

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

export function AdoptSignature({
  initialName,
  savedSignature,
  onState,
}: {
  initialName: string
  savedSignature?: SavedSignature | null
  /** Fired on every change with the current adoption state. */
  onState: (state: AdoptState) => void
}) {
  // A saved image signature (drawn/uploaded) the signer can apply as-is.
  const savedImage =
    savedSignature && savedSignature.mode !== 'typed' && savedSignature.data
      ? savedSignature.data
      : null
  const [signatureName, setSignatureName] = useState(
    savedSignature?.mode === 'typed' && savedSignature.name.trim()
      ? savedSignature.name
      : initialName,
  )
  const [useSavedImage, setUseSavedImage] = useState(true)
  const [mode, setMode] = useState<'type' | 'draw'>('type')
  const [styleIdx, setStyleIdx] = useState<number | null>(null)
  const [drawData, setDrawData] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)

  // Resolve the signature image to attach (if any) with the current choices.
  function resolveSignatureData(): string | null {
    if (savedImage && useSavedImage) return savedImage
    if (mode === 'draw' && drawData) return drawData
    if (mode === 'type' && styleIdx !== null) {
      return renderTypedSignature(signatureName, SIGNATURE_STYLES[styleIdx]!)
    }
    return null
  }

  // Report every change up. resolveSignatureData rasterizes on demand (cheap at
  // this size), so deriving in an effect keyed on the inputs is safe.
  useEffect(() => {
    onState({ signatureName, signatureData: resolveSignatureData(), consent })
  }, [signatureName, useSavedImage, mode, styleIdx, drawData, consent])

  return (
    <>
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
                    <span style={{ fontFamily: s.font, fontStyle: s.italic ? 'italic' : 'normal' }}>
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
    </>
  )
}
