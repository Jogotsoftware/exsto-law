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
  /** VISUAL size in PDF points at scale 1 — pdfjs's getViewport bakes in the
   *  page's /Rotate, so for a 90°/270° page width & height are ALREADY swapped.
   *  Placement rects normalize against these (rotated) dims (ESIGN-ROTATE-FIX). */
  width: number
  height: number
  /** The page's intrinsic /Rotate, normalized to 0/90/180/270. */
  rotation: number
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
      // isOffscreenCanvasSupported: false — pdfjs v4's worker rasterizes via
      // OffscreenCanvas by default when the browser supports it, and on some
      // browser/GPU stacks that path renders the page VERTICALLY FLIPPED (a
      // known class of pdfjs bugs; upright bytes come out upside-down on
      // screen). This PDF is byte-correct (MediaBox origin 0, no CropBox,
      // Rotate 0) and node renders it upright with the worker disabled —
      // the flip only reproduces via the browser worker's OffscreenCanvas
      // rasterizer. Forcing the worker onto a normal <canvas> keeps what
      // the attorney SEES in sync with what stampPdf.ts stamps onto the
      // executed copy (both read the same upright bytes) — without this,
      // fields placed on the flipped preview land in the wrong spot on the
      // final signed PDF.
      const doc = await pdfjs.getDocument({ data: copy, isOffscreenCanvasSupported: false }).promise
      if (cancelled) {
        void doc.destroy()
        return
      }
      loaded = doc
      const pages: PdfPageInfo[] = []
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        // getViewport() defaults rotation to page.rotate, so vp.width/height are
        // the VISUAL (rotation-honored) dimensions — the layout and placement
        // overlay use these directly, which is why a rotated page lays out
        // upright without any manual transform (ESIGN-ROTATE-FIX).
        const vp = page.getViewport({ scale: 1 })
        pages.push({ index: i - 1, width: vp.width, height: vp.height, rotation: page.rotate })
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
    // Both viewports default rotation to page.rotate, so the raster is drawn in
    // the page's /Rotate-corrected orientation and the canvas dims match the
    // rotated aspect — no explicit rotation override, no manual transform.
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
