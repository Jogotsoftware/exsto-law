'use client'

// Templates tab — the firm's reusable, NOT-service-bound template library (Obj 9).
// Builder UX (UI refresh): a document-styled canvas, a click-to-insert merge-token
// palette (like Outreach's email tokens), AI-drafting from a plain-language brief,
// and import (paste or upload a text/markdown/HTML file). The body is text with
// {{tokens}}; CRUD + AI go through the through-core legal.template.* tools.

import { useEffect, useRef, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { readDevSession } from '@/lib/auth'
import { SparklesIcon, FileTextIcon } from '@/components/icons'

type Category = 'document' | 'email'

interface Template {
  templateEntityId: string
  name: string
  category: Category
  body: string
  docKind: string | null
  updatedAt: string
}

interface Draft {
  templateEntityId: string | null // null = new
  name: string
  category: Category
  body: string
  docKind: string
}

const EMPTY_DRAFT: Draft = {
  templateEntityId: null,
  name: '',
  category: 'document',
  body: '',
  docKind: '',
}

// Standard merge fields offered in every template, click-to-insert. Authors can
// also type any {{token}} by hand; tokens already in the body are surfaced too.
const STANDARD_TOKENS: { id: string; label: string }[] = [
  { id: 'client_name', label: 'Client name' },
  { id: 'client_email', label: 'Client email' },
  { id: 'client_address', label: 'Client address' },
  { id: 'matter_number', label: 'Matter number' },
  { id: 'firm_name', label: 'Firm name' },
  { id: 'attorney_name', label: 'Attorney name' },
  { id: 'effective_date', label: 'Effective date' },
  { id: 'today', label: "Today's date" },
]

const TOKEN_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi

function extractTokens(body: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of body.matchAll(TOKEN_RE)) {
    const t = m[1]?.toLowerCase()
    if (t && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out
}

function humanize(token: string): string {
  const s = token.replace(/_/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : token
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  // AI drafting panel state.
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  function load() {
    setError(null)
    callAttorneyMcp<{ templates: Template[] }>({ toolName: 'legal.template.list' })
      .then((res) => setTemplates(res.templates))
      .catch((err) => setError(err.message))
  }
  useEffect(load, [])

  function edit(t: Template) {
    setAiPrompt('')
    setDraft({
      templateEntityId: t.templateEntityId,
      name: t.name,
      category: t.category,
      body: t.body,
      docKind: t.docKind ?? '',
    })
  }

  function newDraft() {
    setAiPrompt('')
    setDraft({ ...EMPTY_DRAFT })
  }

  // Insert a {{token}} at the cursor in the document canvas.
  function insertToken(id: string) {
    if (!draft) return
    const el = bodyRef.current
    const snippet = `{{${id}}}`
    const at = el ? el.selectionStart : draft.body.length
    const end = el ? el.selectionEnd : draft.body.length
    const next = draft.body.slice(0, at) + snippet + draft.body.slice(end)
    setDraft({ ...draft, body: next })
    requestAnimationFrame(() => {
      if (el) {
        const pos = at + snippet.length
        el.focus()
        el.setSelectionRange(pos, pos)
      }
    })
  }

  async function generateWithAi() {
    if (!draft || !aiPrompt.trim()) return
    setAiBusy(true)
    setError(null)
    try {
      const r = await callAttorneyMcp<{ body: string }>({
        toolName: 'legal.template.ai_draft',
        input: { instructions: aiPrompt.trim(), category: draft.category },
      })
      setDraft({ ...draft, body: r.body })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAiBusy(false)
    }
  }

  // Import a document (PDF / Word / text) into the body. The file is parsed
  // server-side (/api/attorney/templates/import) to plain text and appended to
  // the canvas. Dev forwards the demo-session headers exactly like callAttorneyMcp.
  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-importing the same file
    if (!file || !draft) return
    setImporting(true)
    setError(null)
    try {
      const headers: Record<string, string> = {}
      if (process.env.NODE_ENV !== 'production') {
        const dev = readDevSession()
        if (dev) {
          headers['x-actor-id'] = dev.actorId
          headers['x-tenant-id'] = dev.tenantId
        }
      }
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/attorney/templates/import', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: fd,
      })
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string }
      if (!res.ok || !data.text) throw new Error(data.error || `Import failed (${res.status}).`)
      const text = data.text
      setDraft((d) => (d ? { ...d, body: d.body ? `${d.body}\n\n${text}` : text } : d))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  async function save() {
    if (!draft) return
    if (!draft.name.trim()) {
      setError('Give the template a name.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (draft.templateEntityId) {
        await callAttorneyMcp({
          toolName: 'legal.template.update',
          input: {
            templateEntityId: draft.templateEntityId,
            name: draft.name.trim(),
            body: draft.body,
            docKind: draft.category === 'document' ? draft.docKind.trim() || null : null,
          },
        })
      } else {
        await callAttorneyMcp({
          toolName: 'legal.template.create',
          input: {
            name: draft.name.trim(),
            category: draft.category,
            body: draft.body,
            docKind: draft.category === 'document' ? draft.docKind.trim() || undefined : undefined,
          },
        })
      }
      setDraft(null)
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function archive(t: Template) {
    if (
      !window.confirm(
        `Archive "${t.name}"? It will be removed from the active library (kept as history).`,
      )
    )
      return
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.template.archive',
        input: { templateEntityId: t.templateEntityId },
      })
      if (draft?.templateEntityId === t.templateEntityId) setDraft(null)
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const bodyTokens = draft
    ? extractTokens(draft.body).filter((t) => !STANDARD_TOKENS.some((s) => s.id === t))
    : []

  return (
    <main>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <h1>Templates</h1>
        {!draft && (
          <button className="primary" onClick={newDraft}>
            New template
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {draft && (
        <section style={{ marginBottom: '1.5rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.7rem',
              marginBottom: '0.85rem',
            }}
          >
            <h2 style={{ margin: 0 }}>
              {draft.templateEntityId ? 'Edit template' : 'New template'}
            </h2>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.6rem' }}>
              <button className="primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : draft.templateEntityId ? 'Save changes' : 'Create template'}
              </button>
              <button onClick={() => setDraft(null)} disabled={saving}>
                Cancel
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
            <label style={{ flex: '1 1 16rem' }}>
              <span className="field-label">Name</span>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Mutual NDA"
              />
            </label>
            <label>
              <span className="field-label">Type</span>
              <select
                value={draft.category}
                disabled={!!draft.templateEntityId}
                onChange={(e) => setDraft({ ...draft, category: e.target.value as Category })}
              >
                <option value="document">Document</option>
                <option value="email">Email</option>
              </select>
            </label>
            {draft.category === 'document' && (
              <label>
                <span className="field-label">Document kind (optional)</span>
                <input
                  type="text"
                  value={draft.docKind}
                  onChange={(e) => setDraft({ ...draft, docKind: e.target.value })}
                  placeholder="e.g. nda"
                />
              </label>
            )}
          </div>

          {/* Build-with-AI + import. */}
          <div className="tpl-build">
            <div className="tpl-build-ai">
              <textarea
                rows={2}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder={
                  draft.category === 'email'
                    ? 'Describe the email to draft — e.g. “a warm engagement-confirmation email with next steps”'
                    : 'Describe the document to draft — e.g. “a mutual NDA for a NC LLC, 2-year term”'
                }
              />
              <button
                className="primary"
                onClick={generateWithAi}
                disabled={aiBusy || !aiPrompt.trim()}
                title="Draft this template with AI (uses your Anthropic key)"
              >
                <SparklesIcon size={15} /> {aiBusy ? 'Drafting…' : 'Draft with AI'}
              </button>
            </div>
            <div className="tpl-build-import">
              <button onClick={() => fileRef.current?.click()} disabled={importing}>
                <FileTextIcon size={15} /> {importing ? 'Importing…' : 'Import file'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                style={{ display: 'none' }}
                onChange={onImportFile}
              />
              <span className="text-muted text-xs">
                PDF, Word (.docx), or text — parsed into the page (scanned image-only PDFs have no
                text to extract).
              </span>
            </div>
          </div>

          {/* Click-to-insert token palette. */}
          <div className="tpl-insert">
            <span className="tpl-insert-label">Insert a field:</span>
            {STANDARD_TOKENS.map((t) => (
              <button
                key={t.id}
                className="qb-pill"
                type="button"
                onClick={() => insertToken(t.id)}
              >
                {t.label}
              </button>
            ))}
            {bodyTokens.map((t) => (
              <button
                key={t}
                className="qb-pill"
                type="button"
                onClick={() => insertToken(t)}
                title="A custom token already used in this template"
              >
                {humanize(t)}
              </button>
            ))}
          </div>

          {/* Document-styled canvas (a page, not a bare text box). */}
          <div className="tpl-page">
            <textarea
              ref={bodyRef}
              className="tpl-canvas"
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              placeholder={'Dear {{client_name}},\n\n…'}
            />
          </div>
        </section>
      )}

      {templates === null && !error && (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      )}
      {templates && templates.length === 0 && !draft && (
        <section>
          <p>No templates yet. Create your first reusable document or email template.</p>
        </section>
      )}
      {templates && templates.length > 0 && (
        <section style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Document kind</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.templateEntityId}>
                  <td>{t.name || '(untitled)'}</td>
                  <td>
                    <span className={`badge ${t.category === 'email' ? 'info' : ''}`}>
                      {t.category}
                    </span>
                  </td>
                  <td>{t.docKind ?? '—'}</td>
                  <td>{new Date(t.updatedAt).toLocaleDateString()}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => edit(t)}>Edit</button>{' '}
                    <button onClick={() => archive(t)}>Archive</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  )
}
