'use client'

// ESIGN-UNIFY-1 ES-2 (§4) — page thumbnails (right rail): pdfjs thumbnail per
// page, click to jump, badge = field count on that page.
import { useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { renderPageToCanvas, type PdfPageInfo } from './usePdfDocument'

const THUMB_WIDTH = 92

function Thumb({ doc, pageIndex }: { doc: PDFDocumentProxy; pageIndex: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (!ref.current) return
    return renderPageToCanvas(doc, pageIndex, ref.current, THUMB_WIDTH)
  }, [doc, pageIndex])
  return <canvas ref={ref} className="li-esp-thumb-canvas" />
}

export function PageThumbs({
  doc,
  pages,
  currentPage,
  fieldCountByPage,
  onJump,
}: {
  doc: PDFDocumentProxy | null
  pages: PdfPageInfo[]
  currentPage: number
  fieldCountByPage: Record<number, number>
  onJump: (pageIndex: number) => void
}) {
  if (!doc || pages.length === 0) return null
  return (
    <div className="li-esp-thumbs" role="tablist" aria-label="Pages">
      {pages.map((p) => {
        const count = fieldCountByPage[p.index] ?? 0
        return (
          <button
            key={p.index}
            type="button"
            role="tab"
            aria-selected={p.index === currentPage}
            className={`li-esp-thumb${p.index === currentPage ? ' is-current' : ''}`}
            onClick={() => onJump(p.index)}
          >
            <Thumb doc={doc} pageIndex={p.index} />
            <span className="li-esp-thumb-num">{p.index + 1}</span>
            {count > 0 && <span className="li-esp-thumb-badge">{count}</span>}
          </button>
        )
      })}
    </div>
  )
}
