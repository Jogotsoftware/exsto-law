'use client'

// ESIGN-UNIFY-1 ES-2 (§4) — the placement surface assembly (the flagship
// screen): searchable palette left, REAL rendered pages center (zoom, undo/
// redo), page thumbnails right, signer switcher top, properties panel for the
// selected box, preview mode. Owns ALL placement edit state (undo/redo stack)
// and reports the final plan up via onChange — the composer stores it in the
// envelope draft and it rides esign.send (§5.1).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clampRect,
  defaultRectForType,
  type FieldPlacement,
  type PlacementFieldType,
} from '@exsto/legal/esign'
import { EyeIcon, RedoIcon, UndoIcon } from '@/components/icons'
import { PdfCanvas, type ZoomMode } from './PdfCanvas'
import type { ResizeHandle } from './FieldBox'
import { FieldPalette } from './FieldPalette'
import { FieldProps } from './FieldProps'
import { PageThumbs } from './PageThumbs'
import { SignerSwitcher, type SwitcherSigner } from './SignerSwitcher'
import { usePdfDocument } from './usePdfDocument'

export interface PlacerSigner {
  signerKey: string
  name: string
  /** 1-based li-esign2 tone index (recipient row index in the composer). */
  toneIndex: number
}

// Apply a move delta against a base rect, clamped to the page.
function movedRect(p: FieldPlacement, dx: number, dy: number): FieldPlacement {
  return { ...p, rect: clampRect({ ...p.rect, x: p.rect.x + dx, y: p.rect.y + dy }) }
}

const MIN_W = 0.02
const MIN_H = 0.012

function resizedRect(
  p: FieldPlacement,
  handle: ResizeHandle,
  dx: number,
  dy: number,
): FieldPlacement {
  let { x, y, w, h } = p.rect
  if (handle.includes('e')) w = Math.max(MIN_W, w + dx)
  if (handle.includes('s')) h = Math.max(MIN_H, h + dy)
  if (handle.includes('w')) {
    const nw = Math.max(MIN_W, w - dx)
    x = x + (w - nw)
    w = nw
  }
  if (handle.includes('n')) {
    const nh = Math.max(MIN_H, h - dy)
    y = y + (h - nh)
    h = nh
  }
  return { ...p, rect: clampRect({ page: p.rect.page, x, y, w, h }) }
}

export function FieldPlacer({
  pdfData,
  loadingLabel,
  signers,
  placements,
  onChange,
  valuesById,
}: {
  /** The document bytes (upload: the picked file; draft: the render route). */
  pdfData: ArrayBuffer | Uint8Array | null
  loadingLabel?: string
  signers: PlacerSigner[]
  placements: FieldPlacement[]
  onChange: (placements: FieldPlacement[]) => void
  /** §5.3 — resolved auto-fill preview values by placement id. */
  valuesById?: Record<string, string | null>
}) {
  const { doc, pages, loading, error } = usePdfDocument(pdfData)
  const [activeSigner, setActiveSigner] = useState<string | null>(signers[0]?.signerKey ?? null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState<ZoomMode>('fit')
  const [preview, setPreview] = useState(false)
  const [currentPage, setCurrentPage] = useState(0)
  const [scrollTo, setScrollTo] = useState<number | null>(null)

  // Undo/redo: past states of the placement list. Gestures mutate the WORKING
  // list live (onChange) and push ONE history entry on commit.
  const past = useRef<FieldPlacement[][]>([])
  const future = useRef<FieldPlacement[][]>([])
  const gestureBase = useRef<FieldPlacement[] | null>(null)
  // The live list during a drag gesture (avoids re-reading a stale prop).
  const working = useRef<FieldPlacement[]>(placements)
  working.current = placements

  const activeKey = signers.some((s) => s.signerKey === activeSigner)
    ? activeSigner
    : (signers[0]?.signerKey ?? null)

  useEffect(() => {
    if (activeKey !== activeSigner) setActiveSigner(activeKey)
  }, [activeKey, activeSigner])

  const toneBySigner = useMemo(
    () => Object.fromEntries(signers.map((s) => [s.signerKey, s.toneIndex])),
    [signers],
  )

  const commit = useCallback(
    (next: FieldPlacement[], baseline?: FieldPlacement[]) => {
      past.current.push(baseline ?? working.current)
      if (past.current.length > 100) past.current.shift()
      future.current = []
      onChange(next)
    },
    [onChange],
  )

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(working.current)
    onChange(prev)
    setSelectedId(null)
  }, [onChange])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(working.current)
    onChange(next)
    setSelectedId(null)
  }, [onChange])

  const nextId = useCallback((): string => {
    let max = -1
    for (const p of working.current) {
      const m = /^p(\d+)$/.exec(p.id)
      if (m) max = Math.max(max, Number(m[1]))
    }
    return `p${max + 1}`
  }, [])

  const placeField = useCallback(
    (type: PlacementFieldType, pageIndex: number, topLeft: { x: number; y: number }) => {
      if (!activeKey) return
      const page = pages[pageIndex]
      const pagePoints = page ? { w: page.width, h: page.height } : undefined
      const placement: FieldPlacement = {
        id: nextId(),
        type,
        signerKey: activeKey,
        required: type === 'sign' || type === 'initial',
        source: 'placed',
        rect: defaultRectForType(type, pageIndex, topLeft, pagePoints),
      }
      commit([...working.current, placement])
      setSelectedId(placement.id)
    },
    [activeKey, pages, nextId, commit],
  )

  // Palette click (keyboard/touch path): drop at the visible page's center.
  const pickField = useCallback(
    (type: PlacementFieldType) => {
      placeField(type, currentPage, { x: 0.38, y: 0.42 })
    },
    [placeField, currentPage],
  )

  const moveBy = useCallback(
    (id: string, dx: number, dy: number, done: boolean) => {
      if (done) {
        if (gestureBase.current) {
          commit(working.current, gestureBase.current)
          gestureBase.current = null
        }
        return
      }
      if (!gestureBase.current) gestureBase.current = working.current
      const base = gestureBase.current
      onChange(base.map((p) => (p.id === id ? movedRect(p, dx, dy) : p)))
    },
    [commit, onChange],
  )

  const resizeBy = useCallback(
    (id: string, handle: ResizeHandle, dx: number, dy: number, done: boolean) => {
      if (done) {
        if (gestureBase.current) {
          commit(working.current, gestureBase.current)
          gestureBase.current = null
        }
        return
      }
      if (!gestureBase.current) gestureBase.current = working.current
      const base = gestureBase.current
      onChange(base.map((p) => (p.id === id ? resizedRect(p, handle, dx, dy) : p)))
    },
    [commit, onChange],
  )

  const deleteField = useCallback(
    (id: string) => {
      commit(working.current.filter((p) => p.id !== id))
      setSelectedId((s) => (s === id ? null : s))
    },
    [commit],
  )

  const patchField = useCallback(
    (id: string, patch: Partial<Pick<FieldPlacement, 'required' | 'label' | 'signerKey'>>) => {
      commit(working.current.map((p) => (p.id === id ? { ...p, ...patch } : p)))
    },
    [commit],
  )

  // Keyboard: Delete removes the selection; ⌘Z / ⌘⇧Z (Ctrl on Windows) undo/redo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        deleteField(selectedId)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, deleteField, undo, redo])

  const fieldCountByPage = useMemo(() => {
    const counts: Record<number, number> = {}
    for (const p of placements) counts[p.rect.page] = (counts[p.rect.page] ?? 0) + 1
    return counts
  }, [placements])

  const selected = placements.find((p) => p.id === selectedId) ?? null
  const switcherSigners: SwitcherSigner[] = signers

  if (error) {
    return <div className="alert alert-error li-esp-state">{error}</div>
  }
  if (loading || (!doc && pdfData)) {
    return (
      <div className="loading-block li-esp-state" role="status">
        <span className="spinner" /> {loadingLabel ?? 'Rendering document…'}
      </div>
    )
  }
  if (!pdfData) {
    return (
      <div className="li-esp-state li-esign-wiz-hint">
        Add a document on the Documents step to place fields.
      </div>
    )
  }

  return (
    <div className={`li-esp${preview ? ' is-preview' : ''}`}>
      <div className="li-esp-topbar">
        <SignerSwitcher
          signers={switcherSigners}
          activeKey={activeKey}
          onChange={(k) => setActiveSigner(k)}
        />
        <div className="li-esp-tools">
          <div className="li-esp-zoom" role="group" aria-label="Zoom">
            {(['fit', '100', '150'] as ZoomMode[]).map((z) => (
              <button
                key={z}
                type="button"
                className={`li-esp-tool${zoom === z ? ' is-active' : ''}`}
                onClick={() => setZoom(z)}
              >
                {z === 'fit' ? 'Fit' : `${z}%`}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="li-esp-tool"
            onClick={undo}
            disabled={past.current.length === 0}
            aria-label="Undo"
            title="Undo (⌘Z)"
          >
            <UndoIcon size={15} />
          </button>
          <button
            type="button"
            className="li-esp-tool"
            onClick={redo}
            disabled={future.current.length === 0}
            aria-label="Redo"
            title="Redo (⇧⌘Z)"
          >
            <RedoIcon size={15} />
          </button>
          <button
            type="button"
            className={`li-esp-tool li-esp-tool--preview${preview ? ' is-active' : ''}`}
            onClick={() => {
              setPreview((v) => !v)
              setSelectedId(null)
            }}
            title="Preview what the signer sees"
          >
            <EyeIcon size={15} />
            Preview
          </button>
        </div>
      </div>

      <div className="li-esp-body">
        {!preview && (
          <div className="li-esp-left">
            <FieldPalette onPick={pickField} disabled={!activeKey} />
            {selected && (
              <FieldProps
                placement={selected}
                signers={switcherSigners}
                onChange={patchField}
                onDelete={deleteField}
              />
            )}
          </div>
        )}
        <PdfCanvas
          doc={doc}
          pages={pages}
          zoom={zoom}
          placements={preview ? placements.filter((p) => p.signerKey === activeKey) : placements}
          toneBySigner={toneBySigner}
          activeSignerKey={activeKey}
          selectedId={selectedId}
          readOnly={preview}
          valuesById={valuesById}
          onSelect={setSelectedId}
          onDropField={placeField}
          onMoveBy={moveBy}
          onResizeBy={resizeBy}
          onDelete={deleteField}
          onCurrentPageChange={setCurrentPage}
          scrollToPage={scrollTo}
          onScrolledToPage={() => setScrollTo(null)}
        />
        <PageThumbs
          doc={doc}
          pages={pages}
          currentPage={currentPage}
          fieldCountByPage={fieldCountByPage}
          onJump={setScrollTo}
        />
      </div>
    </div>
  )
}
