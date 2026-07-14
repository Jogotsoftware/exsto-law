'use client'

// Attorney standing signature editor (Settings → Signature). Three ways to
// capture it — type it, draw it, or upload an image — saved through
// legal.settings.attorney_signature.set and applied when the attorney signs
// documents electronically. Self-contained: loads and saves itself.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

export type SignatureMode = 'typed' | 'drawn' | 'uploaded'

export interface AttorneySignatureValue {
  mode: SignatureMode
  name: string
  data: string | null
}

// The italic/script treatment a typed signature carries on executed documents
// (the /s/ glyph renders italic); shown live in the Type preview.
const SCRIPT_FONT = "'Snell Roundhand', 'Segoe Script', 'Brush Script MT', cursive"

const MODE_LABELS: Record<SignatureMode, string> = {
  typed: 'Typed',
  drawn: 'Drawn',
  uploaded: 'Uploaded',
}

const IMAGE_STYLE: CSSProperties = {
  display: 'block',
  maxWidth: 260,
  maxHeight: 90,
  background: '#fff',
  border: '1px solid var(--border-soft)',
  borderRadius: 4,
  padding: 4,
}

// Dependency-free draw pad: pointer-capture strokes on a <canvas>, exported as
// a PNG data URL after each stroke (null after Clear / before any ink).
function DrawPad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  const CSS_WIDTH = 420
  const CSS_HEIGHT = 140

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scale = window.devicePixelRatio || 1
    canvas.width = CSS_WIDTH * scale
    canvas.height = CSS_HEIGHT * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(scale, scale)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1f2a44'
  }, [])

  // Map pointer CSS coords into the pad's logical 420×140 space — the canvas
  // may render narrower than its logical size (width: 100%).
  function pos(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (CSS_WIDTH / rect.width),
      y: (e.clientY - rect.top) * (CSS_HEIGHT / rect.height),
    }
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const ctx = e.currentTarget.getContext('2d')
    if (!ctx) return
    const { x, y } = pos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    // A dot counts as ink (initials-style marks).
    ctx.lineTo(x + 0.1, y + 0.1)
    ctx.stroke()
    drawing.current = true
    setHasInk(true)
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = e.currentTarget.getContext('2d')
    if (!ctx) return
    const { x, y } = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  function up(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    drawing.current = false
    onChange(e.currentTarget.toDataURL('image/png'))
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    setHasInk(false)
    onChange(null)
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        aria-label="Signature drawing area"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{
          width: '100%',
          maxWidth: CSS_WIDTH,
          height: CSS_HEIGHT,
          background: '#fff',
          border: '1px dashed var(--border-soft)',
          borderRadius: 4,
          touchAction: 'none',
          cursor: 'crosshair',
          display: 'block',
        }}
      />
      <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        <button onClick={clear} disabled={!hasInk}>
          Clear
        </button>
        {!hasInk && (
          <span className="text-sm" style={{ color: 'var(--muted)', alignSelf: 'center' }}>
            Draw your signature above with your mouse, trackpad, or finger.
          </span>
        )}
      </div>
    </div>
  )
}

export function SignatureCapture() {
  const [saved, setSaved] = useState<AttorneySignatureValue | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState<SignatureMode>('typed')
  const [name, setName] = useState('')
  const [drawnDataUrl, setDrawnDataUrl] = useState<string | null>(null)
  const [uploadDataUrl, setUploadDataUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    callAttorneyMcp<{ signature: AttorneySignatureValue | null }>({
      toolName: 'legal.settings.attorney_signature.get',
    })
      .then((r) => {
        if (r.signature) {
          setSaved(r.signature)
          setTab(r.signature.mode)
          if (r.signature.name) setName(r.signature.name)
        }
        setLoaded(true)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
        setLoaded(true)
      })
  }, [])

  function onUpload(file: File | null) {
    setError(null)
    if (!file) return setUploadDataUrl(null)
    if (file.size > 500_000) {
      setError('Signature image is too large — use an image under 500 KB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setUploadDataUrl(String(reader.result))
    reader.readAsDataURL(file)
  }

  async function save() {
    setError(null)
    let input: { mode: SignatureMode; name: string; data: string | null }
    if (tab === 'typed') {
      if (!name.trim()) {
        setError('Type your full name to save a typed signature.')
        return
      }
      input = { mode: 'typed', name: name.trim(), data: null }
    } else if (tab === 'drawn') {
      if (!drawnDataUrl) {
        setError('Draw your signature before saving.')
        return
      }
      input = { mode: 'drawn', name: name.trim(), data: drawnDataUrl }
    } else {
      if (!uploadDataUrl) {
        setError('Choose a signature image before saving.')
        return
      }
      input = { mode: 'uploaded', name: name.trim(), data: uploadDataUrl }
    }
    setBusy(true)
    try {
      const r = await callAttorneyMcp<{ signature: AttorneySignatureValue | null }>({
        toolName: 'legal.settings.attorney_signature.set',
        input,
      })
      setSaved(r.signature)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    return (
      <div className="loading-block" role="status">
        <span className="spinner" /> Loading…
      </div>
    )
  }

  return (
    <>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Applied when you sign documents electronically.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {savedFlash && <div className="alert alert-success">Saved.</div>}

      {saved && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div className="kv-label">Saved signature · {MODE_LABELS[saved.mode]}</div>
          {saved.data ? (
            // Data-URL preview; next/image adds nothing for inline data.
            <img
              src={saved.data}
              alt="Your saved signature"
              style={{ ...IMAGE_STYLE, marginTop: 'var(--space-1)' }}
            />
          ) : (
            <div
              style={{
                fontFamily: SCRIPT_FONT,
                fontStyle: 'italic',
                fontSize: '1.5rem',
                marginTop: 'var(--space-1)',
              }}
            >
              {saved.name}
            </div>
          )}
        </div>
      )}

      <div className="tabs-bar" role="tablist">
        {(['typed', 'drawn', 'uploaded'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={tab === m}
            className={`tab${tab === m ? ' active' : ''}`}
            onClick={() => {
              setTab(m)
              setError(null)
            }}
          >
            {m === 'typed' ? 'Type' : m === 'drawn' ? 'Draw' : 'Upload'}
          </button>
        ))}
      </div>

      {tab === 'typed' && (
        <>
          <label>
            <span>Full name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full legal name"
            />
          </label>
          {name.trim() && (
            <div
              aria-label="Signature preview"
              style={{
                fontFamily: SCRIPT_FONT,
                fontStyle: 'italic',
                fontSize: '1.5rem',
                marginTop: 'var(--space-2)',
              }}
            >
              {name.trim()}
            </div>
          )}
        </>
      )}

      {tab === 'drawn' && <DrawPad onChange={setDrawnDataUrl} />}

      {tab === 'uploaded' && (
        <>
          <label>
            <span>Signature image (PNG/JPG, under 500 KB)</span>
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => onUpload(e.target.files?.[0] ?? null)}
            />
          </label>
          {uploadDataUrl && (
            <img
              src={uploadDataUrl}
              alt="Signature image preview"
              style={{ ...IMAGE_STYLE, marginTop: 'var(--space-2)' }}
            />
          )}
        </>
      )}

      <div className="firm-details-actions" style={{ marginTop: 'var(--space-4)' }}>
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save signature'}
        </button>
      </div>
    </>
  )
}
