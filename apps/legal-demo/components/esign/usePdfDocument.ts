'use client'

// ESIGN-UNIFY-1 ES-2 (§5.4) — the ONE pdfjs-dist load/teardown seam. Every
// surface that puts real PDF pages on screen (placement canvas, thumbnails,
// review preview, envelope detail, signer overlay) goes through this hook.
//
// pdfjs-dist is imported DYNAMICALLY inside the effect so it never executes
// during SSR (its render path touches browser APIs), and the worker is bundled
// as a static asset via `new URL(..., import.meta.url)` — webpack emits
// pdf.worker.min.mjs into the build and the URL resolves same-origin. NO CDN
// (CSP + offline discipline, §5.4).
import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface PdfPageInfo {
  /** 0-based page index (placement rects use the same base). */
  index: number
  /** Base size in PDF points (viewport scale 1). */
  width: number
  height: number
}

export interface PdfDocState {
  doc: PDFDocumentProxy | null
  pages: PdfPageInfo[]
  loading: boolean
  error: string | null
}

/** Load a PDF from bytes. The hook owns destroy() on change/unmount. Pass null
 *  while the bytes are still being fetched. */
export function usePdfDocument(data: ArrayBuffer | Uint8Array | null): PdfDocState {
  const [state, setState] = useState<PdfDocState>({
    doc: null,
    pages: [],
    loading: Boolean(data),
    error: null,
  })

  useEffect(() => {
    if (!data) {
      setState({ doc: null, pages: [], loading: false, error: null })
      return
    }
    let cancelled = false
    let loaded: PDFDocumentProxy | null = null
    setState((s) => ({ ...s, loading: true, error: null }))
    ;(async () => {
      const pdfjs = await import('pdfjs-dist')
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        // Same-origin static asset staged by scripts/copy-pdf-worker.mjs (the
        // app build step) — never a CDN, never a bundler asset URL (§5.4; the
        // latter fights serverExternalPackages and breaks `next build`).
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf-worker/pdf.worker.min.mjs'
      }
      // pdfjs TRANSFERS the buffer to the worker — hand it a copy so the
      // caller's bytes stay usable (e.g. re-render on zoom, upload later).
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
      const copy = bytes.slice()
      const doc = await pdfjs.getDocument({ data: copy }).promise
      if (cancelled) {
        void doc.destroy()
        return
      }
      loaded = doc
      const pages: PdfPageInfo[] = []
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        const vp = page.getViewport({ scale: 1 })
        pages.push({ index: i - 1, width: vp.width, height: vp.height })
      }
      if (cancelled) return
      setState({ doc, pages, loading: false, error: null })
    })().catch((e) => {
      if (!cancelled) {
        setState({
          doc: null,
          pages: [],
          loading: false,
          error: e instanceof Error ? e.message : 'Could not load the PDF.',
        })
      }
    })
    return () => {
      cancelled = true
      if (loaded) void loaded.destroy()
    }
  }, [data])

  return state
}

/** Render one page into a canvas at `cssWidth` CSS pixels wide (device-pixel
 *  sharp). Returns a cancel function. Shared by PdfCanvas and PageThumbs. */
export function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
): () => void {
  let cancelled = false
  ;(async () => {
    const page = await doc.getPage(pageIndex + 1)
    if (cancelled) return
    const base = page.getViewport({ scale: 1 })
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio ?? 1) : 1
    const scale = (cssWidth / base.width) * dpr
    const viewport = page.getViewport({ scale })
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${Math.floor(viewport.height / dpr)}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    await page.render({ canvasContext: ctx, viewport }).promise.catch(() => {
      // A superseded render (zoom changed mid-flight) throws a cancel — ignore.
    })
  })().catch(() => {})
  return () => {
    cancelled = true
  }
}
