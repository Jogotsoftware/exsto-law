'use client'

// ESIGN-UNIFY-1 ES-2 (§4) — the document center pane: REAL rendered PDF pages
// (pdfjs), vertically scrolled, with the placement overlay drawn in normalized
// percent coordinates on top of each page. Handles palette-chip drops, box
// selection/move/resize plumbing (FieldBox owns the pointer math), and reports
// the current page for the thumbnail rail. Read-only mode renders the same
// overlay without editing chrome (review preview / envelope detail / preview
// mode / signer surface).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { FieldPlacement, PlacementFieldType } from '@exsto/legal/esign'
import { FieldBox, type ResizeHandle } from './FieldBox'
import { FIELD_DRAG_MIME } from './fieldMeta'
import { renderPageToCanvas, type PdfPageInfo } from './usePdfDocument'

export type ZoomMode = 'fit' | '100' | '150'

function PageCanvas({
  doc,
  pageIndex,
  cssWidth,
}: {
  doc: PDFDocumentProxy
  pageIndex: number
  cssWidth: number
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (!ref.current || cssWidth <= 0) return
    return renderPageToCanvas(doc, pageIndex, ref.current, cssWidth)
  }, [doc, pageIndex, cssWidth])
  return <canvas ref={ref} className="li-esp-page-canvas" />
}

export interface PdfCanvasProps {
  doc: PDFDocumentProxy | null
  pages: PdfPageInfo[]
  zoom: ZoomMode
  placements: FieldPlacement[]
  /** signerKey → 1-based li-esign2 tone index. */
  toneBySigner: Record<string, number>
  activeSignerKey?: string | null
  selectedId?: string | null
  readOnly?: boolean
  /** Resolved display values by placement id (§5.3 canvas preview). */
  valuesById?: Record<string, string | null>
  onSelect?: (id: string | null) => void
  onDropField?: (
    type: PlacementFieldType,
    pageIndex: number,
    topLeftNorm: { x: number; y: number },
  ) => void
  onMoveBy?: (id: string, dxNorm: number, dyNorm: number, commit: boolean) => void
  onResizeBy?: (
    id: string,
    handle: ResizeHandle,
    dxNorm: number,
    dyNorm: number,
    commit: boolean,
  ) => void
  onDelete?: (id: string) => void
  /** Signer-surface tap on a box. */
  onActivate?: (id: string) => void
  onCurrentPageChange?: (pageIndex: number) => void
  /** Imperative scroll target (thumbnail click). */
  scrollToPage?: number | null
  onScrolledToPage?: () => void
}

export function PdfCanvas({
  doc,
  pages,
  zoom,
  placements,
  toneBySigner,
  activeSignerKey,
  selectedId,
  readOnly,
  valuesById,
  onSelect,
  onDropField,
  onMoveBy,
  onResizeBy,
  onDelete,
  onActivate,
  onCurrentPageChange,
  scrollToPage,
  onScrolledToPage,
}: PdfCanvasProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pageRefs = useRef<Array<HTMLDivElement | null>>([])
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setContainerWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // CSS width per page: fit-width fills the pane (minus padding); 100% = 96dpi
  // (PDF points × 96/72); 150% = 1.5×. All pages share the width of the widest
  // page's scale so mixed-size PDFs stay aligned.
  const cssWidthFor = useMemo(() => {
    const pad = 48
    return (page: PdfPageInfo): number => {
      if (zoom === 'fit') return Math.max(containerWidth - pad, 320)
      const dpiScale = 96 / 72
      const factor = zoom === '150' ? 1.5 : 1
      return page.width * dpiScale * factor
    }
  }, [zoom, containerWidth])

  // Track the page nearest the viewport center for the thumbnail rail.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !onCurrentPageChange) return
    const onScroll = () => {
      const mid = el.scrollTop + el.clientHeight / 2
      let best = 0
      for (let i = 0; i < pageRefs.current.length; i++) {
        const node = pageRefs.current[i]
        if (!node) continue
        if (node.offsetTop <= mid) best = i
      }
      onCurrentPageChange(best)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [onCurrentPageChange, pages.length])

  useEffect(() => {
    if (scrollToPage == null) return
    const node = pageRefs.current[scrollToPage]
    const el = scrollRef.current
    if (node && el) el.scrollTo({ top: node.offsetTop - 12, behavior: 'smooth' })
    onScrolledToPage?.()
  }, [scrollToPage, onScrolledToPage])

  if (!doc || pages.length === 0) return null

  return (
    <div
      ref={scrollRef}
      className="li-esp-scroll"
      onClick={() => onSelect?.(null)}
      data-testid="esp-canvas"
    >
      {pages.map((page) => {
        const cssWidth = cssWidthFor(page)
        const cssHeight = cssWidth * (page.height / page.width)
        const pagePlacements = placements.filter((p) => p.rect.page === page.index)
        return (
          <div
            key={page.index}
            ref={(node) => {
              pageRefs.current[page.index] = node
            }}
            className="li-esp-page"
            style={{ width: cssWidth, height: cssHeight }}
            onDragOver={(e) => {
              if (readOnly || !onDropField) return
              if (e.dataTransfer.types.includes(FIELD_DRAG_MIME)) {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
              }
            }}
            onDrop={(e) => {
              if (readOnly || !onDropField) return
              const type = e.dataTransfer.getData(FIELD_DRAG_MIME) as PlacementFieldType
              if (!type) return
              e.preventDefault()
              const rect = e.currentTarget.getBoundingClientRect()
              onDropField(type, page.index, {
                x: (e.clientX - rect.left) / rect.width,
                y: (e.clientY - rect.top) / rect.height,
              })
            }}
          >
            <PageCanvas doc={doc} pageIndex={page.index} cssWidth={cssWidth} />
            <div className="li-esp-overlay">
              {pagePlacements.map((p) => (
                <FieldBox
                  key={p.id}
                  placement={p}
                  toneIndex={toneBySigner[p.signerKey] ?? 8}
                  selected={p.id === selectedId}
                  dimmed={Boolean(activeSignerKey) && p.signerKey !== activeSignerKey}
                  readOnly={Boolean(readOnly)}
                  displayValue={valuesById?.[p.id]}
                  pageCssSize={{ width: cssWidth, height: cssHeight }}
                  onSelect={(id) => onSelect?.(id)}
                  onDragMove={(id, dx, dy) => onMoveBy?.(id, dx, dy, false)}
                  onDragEnd={(id) => onMoveBy?.(id, 0, 0, true)}
                  onResizeMove={(id, h, dx, dy) => onResizeBy?.(id, h, dx, dy, false)}
                  onResizeEnd={(id) => onResizeBy?.(id, 'se', 0, 0, true)}
                  onDelete={onDelete}
                  onActivate={onActivate}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
