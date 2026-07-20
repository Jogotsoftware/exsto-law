'use client'

// Settings → Invoice template (WP-G). Split out of the old settings monolith —
// same legal.firm.get_invoice_template / set_invoice_template /
// legal.invoice.template_preview tools, restyled to the comp's two-column
// form + live-preview card. The .docx merge-field upload the comp's dashed
// "Upload Word doc" button hints at is NOT built here — deferred to WIRING.md
// §WP-G G2 (no backing tool exists yet); this keeps the working PNG/JPG logo
// branding editor and the real rendered-PDF preview.
import { useCallback, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { SettingsHeader, SettingsLoading, SettingsAlert } from '../shared'

interface InvoiceTemplateConfig {
  firmName: string
  firmAddress: string
  firmPhone: string
  logoDataUrl: string | null
  accentColor: string
  columns: { matter: boolean; quantity: boolean; rate: boolean }
  headerNote: string
  paymentInstructions: string
}

function base64ToBlobUrl(base64: string, type = 'application/pdf'): string {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type }))
}

export default function InvoiceTemplatePage(): React.ReactElement {
  const [cfg, setCfg] = useState<InvoiceTemplateConfig | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
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
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return base64ToBlobUrl(r.pdf.base64)
      })
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

  function set<K extends keyof InvoiceTemplateConfig>(
    key: K,
    value: InvoiceTemplateConfig[K],
  ): void {
    setCfg((c) => (c ? { ...c, [key]: value } : c))
    setSaved(false)
  }

  async function onLogo(file: File | null): Promise<void> {
    if (!file) return set('logoDataUrl', null)
    if (file.size > 500_000) {
      setError('Logo is too large — use an image under 500 KB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => set('logoDataUrl', String(reader.result))
    reader.readAsDataURL(file)
  }

  async function save(): Promise<void> {
    if (!cfg) return
    setBusy('save')
    setError(null)
    try {
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
              Customize the invoice clients receive — branding and content. The preview on the right
              is the real PDF, rendered by the same engine that produces sent invoices.
            </p>
            {saved && <SettingsAlert tone="success">Saved.</SettingsAlert>}

            <div className="li-set-form-grid">
              <label className="li-set-label">
                <span>Firm name</span>
                <input
                  className="li-set-input"
                  value={cfg.firmName}
                  onChange={(e) => set('firmName', e.target.value)}
                />
              </label>
              <label className="li-set-label">
                <span>Accent color</span>
                <div className="li-set-color-swatch-row">
                  <input
                    className="li-set-color-swatch"
                    type="color"
                    value={cfg.accentColor}
                    onChange={(e) => set('accentColor', e.target.value)}
                  />
                  <input
                    className="li-set-input"
                    value={cfg.accentColor}
                    onChange={(e) => set('accentColor', e.target.value)}
                  />
                </div>
              </label>
              <label className="li-set-label">
                <span>Firm phone</span>
                <input
                  className="li-set-input"
                  value={cfg.firmPhone}
                  onChange={(e) => set('firmPhone', e.target.value)}
                />
              </label>
            </div>
            <label className="li-set-label">
              <span>Firm address</span>
              <textarea
                className="li-set-textarea"
                value={cfg.firmAddress}
                onChange={(e) => set('firmAddress', e.target.value)}
                rows={2}
              />
            </label>
            <label className="li-set-label">
              <span>Logo (PNG/JPG, under 500 KB)</span>
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => void onLogo(e.target.files?.[0] ?? null)}
              />
            </label>
            {cfg.logoDataUrl && (
              <button className="li-set-btn li-set-btn-sm" onClick={() => set('logoDataUrl', null)}>
                Remove logo
              </button>
            )}
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
            {previewUrl ? (
              <iframe title="Invoice preview" src={previewUrl} className="li-set-preview-frame" />
            ) : (
              <SettingsLoading />
            )}
          </div>
        </div>
      )}
    </>
  )
}
