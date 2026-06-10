'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PlusIcon, SearchIcon } from '@/components/icons'

interface TemplateRow {
  id: string
  templateKey: string
  displayName: string
  description: string | null
  isActive: boolean
  updatedAt: string
}

export default function TemplatesListPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    try {
      const r = await callAttorneyMcp<{ templates: TemplateRow[] }>({
        toolName: 'legal.template.list',
      })
      setTemplates(r.templates)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    if (!templates) return []
    const q = search.trim().toLowerCase()
    if (!q) return templates
    return templates.filter((t) =>
      [t.displayName, t.description ?? '', t.templateKey].some((s) => s.toLowerCase().includes(q)),
    )
  }, [templates, search])

  async function createBlank() {
    const name = prompt('Name for the new template (e.g. "NDA — mutual"):')
    if (!name) return
    setBusy('create')
    try {
      const r = await callAttorneyMcp<{ template: TemplateRow & { templateKey: string } }>({
        toolName: 'legal.template.create',
        input: { displayName: name },
      })
      router.push(`/attorney/templates/${r.template.templateKey}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  async function clone(t: TemplateRow) {
    setBusy(`clone:${t.templateKey}`)
    try {
      const r = await callAttorneyMcp<{ template: { templateKey: string } }>({
        toolName: 'legal.template.clone',
        input: { templateKey: t.templateKey },
      })
      await load()
      router.push(`/attorney/templates/${r.template.templateKey}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function remove(t: TemplateRow) {
    if (!confirm(`Delete "${t.displayName}"? This cannot be undone.`)) return
    setBusy(`del:${t.templateKey}`)
    try {
      await callAttorneyMcp({
        toolName: 'legal.template.delete',
        input: { templateKey: t.templateKey },
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  function pickPdf() {
    fileRef.current?.click()
  }

  async function importPdf(file: File) {
    setBusy('pdf')
    try {
      const buf = await file.arrayBuffer()
      const b64 = arrayBufferToBase64(buf)
      const r = await callAttorneyMcp<{
        displayName: string
        bodyMd: string
        bodyHtml: string
        detectedVariables: string[]
      }>({
        toolName: 'legal.template.import_pdf',
        input: { pdfBase64: b64, filename: file.name },
      })
      const created = await callAttorneyMcp<{ template: { templateKey: string } }>({
        toolName: 'legal.template.create',
        input: {
          displayName: r.displayName,
          bodyMd: r.bodyMd,
          bodyHtml: r.bodyHtml,
          variableSchema: r.detectedVariables.map((name) => ({
            name,
            label: humanizeName(name),
            type: 'text',
            sample: null,
            description: null,
            required: false,
            options: null,
          })),
        },
      })
      router.push(`/attorney/templates/${created.template.templateKey}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  return (
    <main>
      <div className="attorney-page-head">
        <h1>Templates</h1>
        <div className="head-actions">
          <button onClick={pickPdf} disabled={busy === 'pdf'}>
            {busy === 'pdf' ? 'Importing…' : 'Import from PDF'}
          </button>
          <button className="primary" onClick={createBlank} disabled={busy === 'create'}>
            <PlusIcon size={14} /> {busy === 'create' ? 'Creating…' : 'New template'}
          </button>
        </div>
      </div>

      <p style={{ color: 'var(--muted)' }}>
        The document skeletons used when drafting. Edit any template to change the structure or
        language for every future draft.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) importPdf(f)
          e.target.value = ''
        }}
      />

      {error && (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      <div className="tpl-search-wrap">
        <SearchIcon size={14} className="search-icon" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates by name, description, or key…"
          className="search-input"
        />
      </div>

      {templates === null && !error && (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      )}

      {templates && filtered.length === 0 && (
        <div className="tpl-empty">
          {templates.length === 0
            ? 'No templates yet. Create one or import a PDF to get started.'
            : 'No templates match your search.'}
        </div>
      )}

      {templates && filtered.length > 0 && (
        <div className="tpl-grid">
          {filtered.map((t) => (
            <div key={t.templateKey} className="tpl-card">
              <div className="tpl-card-main">
                <div className="tpl-card-title-row">
                  <Link href={`/attorney/templates/${t.templateKey}`} className="tpl-card-title">
                    {t.displayName}
                  </Link>
                  <span className="tpl-key-chip">{t.templateKey}</span>
                </div>
                {t.description && <div className="tpl-card-desc">{t.description}</div>}
                <div className="tpl-card-meta">Last updated {formatDate(t.updatedAt)}</div>
              </div>
              <div className="tpl-card-actions">
                <Link href={`/attorney/templates/${t.templateKey}`} className="btn-secondary">
                  Edit
                </Link>
                <button onClick={() => clone(t)} disabled={busy === `clone:${t.templateKey}`}>
                  {busy === `clone:${t.templateKey}` ? '…' : 'Clone'}
                </button>
                <button
                  className="danger-outline"
                  onClick={() => remove(t)}
                  disabled={busy === `del:${t.templateKey}`}
                >
                  {busy === `del:${t.templateKey}` ? '…' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

function formatDate(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const d = new Date(t)
  const days = Math.round((Date.now() - t) / 86400000)
  if (days < 1) {
    const mins = Math.round((Date.now() - t) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    return `${Math.round(mins / 60)}h ago`
  }
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let bin = ''
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return typeof window === 'undefined' ? Buffer.from(bytes).toString('base64') : window.btoa(bin)
}

function humanizeName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
