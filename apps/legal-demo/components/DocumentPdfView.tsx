'use client'

// EDITOR-FIX-1 (item 2) — render a FILE-BACKED document version (an uploaded
// PDF, e.g. an e-sign envelope's source) as REAL pages in the review reader.
// Before this, the reader fed the version's content_blob body — which for a file
// version is a STORAGE PATH string, not markdown — into the markdown/TipTap
// pipeline and painted a black/garbage screen. This component fetches the SAME
// ES-2 render route the placement canvas uses (/api/attorney/esign/render streams
// the stored PDF bytes for a file version) and draws its pages with the shared
// pdfjs seam (usePdfDocument / renderPageToCanvas) — no markdown, no editing
// chrome, no placement overlay. A non-PDF upload (415) or a load error is stated
// plainly with a download fallback.
import { useEffect, useRef, useState } from 'react'
import { readDevSession } from '@/lib/auth'
import { usePdfDocument, renderPageToCanvas, type PdfPageInfo } from '@/components/esign/usePdfDocument'
import type { PDFDocumentProxy } from 'pdfjs-dist'

function devAuthHeaders(): Record<string, string> {
  if (process.env.NODE_ENV === 'production') return {}
  const dev = readDevSession()
  return dev ? { 'x-actor-id': dev.actorId, 'x-tenant-id': dev.tenantId } : {}
}

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
  return <canvas ref={ref} className="li-rev-pdf-page" />
}

export function DocumentPdfView({
  documentVersionId,
  filename,
  downloadHref,
}: {
  documentVersionId: string
  filename: string
  // Optional direct-download fallback (matter documents download proxy) offered
  // when the bytes can't be rendered inline (non-PDF, or a render failure).
  downloadHref?: string
}) {
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    let cancelled = false
    setBytes(null)
    setFetchError(null)
    fetch('/api/attorney/esign/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...devAuthHeaders() },
      body: JSON.stringify({ documentVersionId }),
    })
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as { pdf?: string; error?: string }
        if (!r.ok || !data.pdf) throw new Error(data.error || 'Could not render this document.')
        if (cancelled) return
        const bin = atob(data.pdf)
        const buf = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
        setBytes(buf.buffer)
      })
      .catch((e) => {
        if (!cancelled) setFetchError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [documentVersionId])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setContainerWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { doc, pages, loading, error } = usePdfDocument(bytes)
  const renderError = fetchError ?? error

  const cssWidthFor = (page: PdfPageInfo): number => Math.max(containerWidth - 24, 320)

  return (
    <div className="li-rev-pdf" ref={scrollRef}>
      <div className="li-rev-pdf-bar">
        <span className="li-rev-pdf-name">{filename}</span>
        {downloadHref && (
          <a className="li-rev-pdf-dl" href={downloadHref}>
            Download original
          </a>
        )}
      </div>
      {renderError ? (
        <div className="li-rev-pdf-msg">
          <p>{renderError}</p>
          {downloadHref && (
            <a className="li-rev-pdf-dl" href={downloadHref}>
              Download the file instead
            </a>
          )}
        </div>
      ) : loading || !bytes ? (
        <div className="li-rev-pdf-msg">
          <span className="spinner" /> Loading document…
        </div>
      ) : doc && pages.length > 0 ? (
        <div className="li-rev-pdf-pages">
          {pages.map((page) => (
            <PageCanvas key={page.index} doc={doc} pageIndex={page.index} cssWidth={cssWidthFor(page)} />
          ))}
        </div>
      ) : (
        <div className="li-rev-pdf-msg">This document has no pages to display.</div>
      )}
    </div>
  )
}
