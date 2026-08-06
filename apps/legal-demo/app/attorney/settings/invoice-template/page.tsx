'use client'

// Settings → Invoice template (WP-G). Same legal.firm.get_invoice_template /
// set_invoice_template / legal.invoice.template_preview tools, two-column form +
// live-preview card.
//
// FIRM-BRANDING-1 — this page no longer OWNS firm identity. Firm name, address,
// phone, logo and accent color were duplicated here and on Settings → Firm
// Details, and the logo could ONLY be uploaded here, so the firm card had to
// send the attorney over to a document template to change the mark on their own
// console. Branding is now read-only on this page (a summary that links back to
// Firm Details); the invoice pulls it from the firm profile
// (api/invoiceTemplate.ts resolveBranding). What stays here is genuinely
// invoice-specific: which columns print, the header note, the payment terms.
//
// Two things that WERE broken, fixed here:
//   * the preview was a raw <iframe src="blob:…pdf">, so Chrome painted its
//     whole native PDF plugin — dark chrome, thumbnail rail, toolbar — inside a
//     560px box, leaving the actual invoice an unreadable postage stamp. It now
//     renders the PDF's pages to a canvas with the same pdfjs seam the review
//     reader uses (usePdfDocument), so the preview is the page and nothing else.
//   * "Refresh preview" was the only way to see an edit; the preview now
//     re-renders (debounced) as settings change.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { plateHex } from '@/lib/brandColor'
import { usePdfDocument, renderPageToCanvas } from '@/components/esign/usePdfDocument'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { SettingsHeader, SettingsLoading, SettingsAlert } from '../shared'

interface InvoiceTemplateConfig {
  firmName: string
  firmAddress: string
  firmPhone: string
  logoDataUrl: string | null
  logoTone: 'light' | 'dark' | null
  accentColor: string
  columns: { matter: boolean; quantity: boolean; rate: boolean }
  headerNote: string
  paymentInstructions: string
}

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function PreviewPage({
  doc,
  pageIndex,
  cssWidth,
}: {
  doc: PDFDocumentProxy
  pageIndex: number
  cssWidth: number
}): React.ReactElement {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (!ref.current || cssWidth <= 0) return
    return renderPageToCanvas(doc, pageIndex, ref.current, cssWidth)
  }, [doc, pageIndex, cssWidth])
  return <canvas ref={ref} className="li-set-preview-page" />
}

function PdfPreview({ bytes }: { bytes: Uint8Array | null }): React.ReactElement {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const { doc, error } = usePdfDocument(bytes)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="li-set-preview-scroll" ref={boxRef}>
      {error ? (
        <SettingsAlert tone="error">{error}</SettingsAlert>
      ) : !doc ? (
        <SettingsLoading />
      ) : (
        Array.from({ length: doc.numPages }, (_, i) => (
          <PreviewPage key={i} doc={doc} pageIndex={i} cssWidth={Math.max(0, width - 24)} />
        ))
      )}
    </div>
  )
}

export default function InvoiceTemplatePage(): React.ReactElement {
  const [cfg, setCfg] = useState<InvoiceTemplateConfig | null>(null)
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const preview = useCallback(async (config: InvoiceTemplateConfig) => {
    setBusy('preview')
    try {
      const r = await callAttorneyMcp<{ pdf: { base64: string } }>({
        toolName: 'legal.invoice.template_preview',
        input: { config },
      })
      // A fresh array each render — usePdfDocument copies before handing the
      // bytes to the worker, which transfers (and detaches) what it is given.
      setPdfBytes(base64ToBytes(r.pdf.base64))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    callAttorneyMcp<{ template: InvoiceTemplateConfig }>({
      toolName: 'legal.firm.get_invoice_template',
    })
      .then((r) => {
        setCfg(r.template)
        void preview(r.template)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [preview])

  // Re-render the preview shortly after an edit settles — the old page only
  // updated when the attorney found the "Refresh preview" button.
  const previewKey = useMemo(
    () => (cfg ? JSON.stringify([cfg.columns, cfg.headerNote, cfg.paymentInstructions]) : ''),
    [cfg],
  )
  const firstRender = useRef(true)
  useEffect(() => {
    if (!cfg) return
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const id = setTimeout(() => void preview(cfg), 600)
    return () => clearTimeout(id)
    // Only the SETTINGS this page owns retrigger a render (previewKey), not
    // every identity change riding along on cfg.
  }, [previewKey])

  function set<K extends keyof InvoiceTemplateConfig>(
    key: K,
    value: InvoiceTemplateConfig[K],
  ): void {
    setCfg((c) => (c ? { ...c, [key]: value } : c))
    setSaved(false)
  }

  async function save(): Promise<void> {
    if (!cfg) return
    setBusy('save')
    setError(null)
    try {
      // Branding keys are ignored server-side (setInvoiceTemplate strips them);
      // only columns / header note / payment instructions are persisted.
      await callAttorneyMcp({ toolName: 'legal.firm.set_invoice_template', input: { config: cfg } })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      void preview(cfg)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <SettingsHeader title="Invoice Template" />
      {error && <SettingsAlert tone="error">{error}</SettingsAlert>}

      {!cfg ? (
        <SettingsLoading />
      ) : (
        <div className="li-set-split">
          <div className="li-set-split-form li-set-card li-set-card--pad-sm">
            <p className="li-set-hint" style={{ margin: '0 0 16px' }}>
              Customize the invoice clients receive. The preview on the right is the real PDF,
              rendered by the same engine that produces sent invoices.
            </p>
            {saved && <SettingsAlert tone="success">Saved.</SettingsAlert>}

            {/* FIRM-BRANDING-1 — read-only. One place owns firm identity. */}
            <div className="li-set-brandref">
              <span
                className={`li-set-brandref-logo${cfg.logoDataUrl ? ' has-logo' : ''}${
                  cfg.logoDataUrl && cfg.logoTone === 'dark' ? ' on-light' : ''
                }`}
                style={{
                  background: cfg.logoTone === 'dark' ? '#fff' : plateHex(cfg.accentColor),
                }}
              >
                {cfg.logoDataUrl ? <img src={cfg.logoDataUrl} alt="" /> : null}
              </span>
              <div className="li-set-brandref-text">
                <div className="li-set-brandref-name">{cfg.firmName || 'Your firm'}</div>
                <div className="li-set-brandref-sub">
                  Your logo, brand color and firm contact details come from Firm Details and print
                  on every invoice.
                </div>
              </div>
              <Link href="/attorney/settings/firm" className="li-set-btn">
                Edit branding
              </Link>
            </div>

            <fieldset className="li-set-fieldset">
              <legend>Columns</legend>
              {(['matter', 'quantity', 'rate'] as const).map((col) => (
                <label key={col} className="li-set-check-row">
                  <input
                    type="checkbox"
                    checked={cfg.columns[col]}
                    onChange={(e) => set('columns', { ...cfg.columns, [col]: e.target.checked })}
                  />
                  <span style={{ textTransform: 'capitalize' }}>{col}</span>
                </label>
              ))}
            </fieldset>
            <label className="li-set-label">
              <span>Header note (optional)</span>
              <input
                className="li-set-input"
                value={cfg.headerNote}
                onChange={(e) => set('headerNote', e.target.value)}
              />
            </label>
            <label className="li-set-label">
              <span>Footer / payment instructions</span>
              <textarea
                className="li-set-textarea"
                value={cfg.paymentInstructions}
                onChange={(e) => set('paymentInstructions', e.target.value)}
                rows={2}
              />
            </label>
            <div className="li-set-actions-row">
              <button
                className="li-set-btn"
                onClick={() => void preview(cfg)}
                disabled={busy === 'preview'}
              >
                {busy === 'preview' ? 'Rendering…' : 'Refresh preview'}
              </button>
              <button
                className="li-set-btn li-set-btn-primary"
                onClick={save}
                disabled={busy === 'save'}
              >
                {busy === 'save' ? 'Saving…' : 'Save template'}
              </button>
            </div>
          </div>

          <div className="li-set-preview-panel">
            <PdfPreview bytes={pdfBytes} />
          </div>
        </div>
      )}
    </>
  )
}
