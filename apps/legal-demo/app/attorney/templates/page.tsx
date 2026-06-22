'use client'

// Templates tab — the firm's reusable, NOT-service-bound template library (Obj 9).
// Builder UX (UI refresh): a document-styled canvas, a click-to-insert merge-token
// palette (like Outreach's email tokens), AI-drafting from a plain-language brief,
// and import (paste or upload a text/markdown/HTML file). The body is text with
// {{tokens}}; CRUD + AI go through the through-core legal.template.* tools.

import { useEffect, useMemo, useRef, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { readDevSession } from '@/lib/auth'
import { SparklesIcon, FileTextIcon, EyeIcon, LayersIcon, XIcon } from '@/components/icons'
import { TemplateEditor, type TemplateEditorHandle } from '@/components/templates/TemplateEditor'
import { TemplatePreview } from '@/components/templates/TemplatePreview'
import { TemplateFieldsPanel } from '@/components/templates/TemplateFieldsPanel'
import { markdownToHtml, htmlToMarkdown } from '@/lib/templateBody'
import type { TemplateVariables } from '@exsto/legal'

type Category = 'document' | 'email'

interface Template {
  templateEntityId: string
  name: string
  category: Category
  body: string
  docKind: string | null
  variables: TemplateVariables
  updatedAt: string
}

interface Draft {
  templateEntityId: string | null // null = new
  name: string
  category: Category
  body: string
  docKind: string
  variables: TemplateVariables
}

const EMPTY_DRAFT: Draft = {
  templateEntityId: null,
  name: '',
  category: 'document',
  body: '',
  docKind: '',
  variables: {},
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

// The font-scale options offered in the Font size select. loadPageSetup whitelists
// against this so a stray stored value can never de-sync the controlled select.
const FONT_SCALES = [0.9, 1, 1.1, 1.2] as const

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
  // AI drafting state — the brief is entered in a modal "Draft with AI" window.
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [showAi, setShowAi] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showFields, setShowFields] = useState(false)
  // Page setup (paper size + font scale) — a per-template VIEW/print preference,
  // persisted client-side (localStorage), so the canvas + preview render true to
  // the chosen page. Not substrate state (it never affects what's stored).
  const [paper, setPaper] = useState<'letter' | 'legal'>('letter')
  const [fontScale, setFontScale] = useState(1)
  const editorRef = useRef<TemplateEditorHandle | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  // The "Draft with AI" trigger, so closing the modal restores focus to it.
  const aiTriggerRef = useRef<HTMLButtonElement | null>(null)

  function closeAi() {
    setShowAi(false)
    aiTriggerRef.current?.focus()
  }
  // Bumped whenever we replace the WHOLE body (open / new / AI / import) so the
  // editor re-seeds from the new markdown. Plain typing does NOT bump it, so the
  // cursor never jumps mid-edit.
  const [seedKey, setSeedKey] = useState(0)

  function load() {
    setError(null)
    callAttorneyMcp<{ templates: Template[] }>({ toolName: 'legal.template.list' })
      .then((res) => setTemplates(res.templates))
      .catch((err) => setError(err.message))
  }
  useEffect(load, [])

  // Escape closes the "Draft with AI" modal (and restores focus to its trigger).
  useEffect(() => {
    if (!showAi) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !aiBusy) {
        setShowAi(false)
        aiTriggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showAi, aiBusy])

  // Per-template page setup (paper + font), persisted client-side only.
  function loadPageSetup(id: string | null) {
    let paperV: 'letter' | 'legal' = 'letter'
    let fontV = 1
    try {
      const raw = localStorage.getItem(`tpl-pagesetup:${id ?? 'new'}`)
      if (raw) {
        const v = JSON.parse(raw) as { paper?: string; fontScale?: number }
        if (v.paper === 'legal') paperV = 'legal'
        if (
          typeof v.fontScale === 'number' &&
          (FONT_SCALES as readonly number[]).includes(v.fontScale)
        )
          fontV = v.fontScale
      }
    } catch {
      /* ignore malformed/absent storage */
    }
    setPaper(paperV)
    setFontScale(fontV)
  }

  // The storage key for the open draft's page setup ('new' until first save).
  // null when no draft is open. A primitive, so the persist effect below fires on
  // paper/font/identity changes only — NOT on every keystroke (which replaces the
  // whole draft object).
  const activeSetupId = draft ? (draft.templateEntityId ?? 'new') : null

  // Persist page setup whenever it changes for the open draft.
  useEffect(() => {
    if (!activeSetupId) return
    try {
      localStorage.setItem(`tpl-pagesetup:${activeSetupId}`, JSON.stringify({ paper, fontScale }))
    } catch {
      /* storage unavailable — view-only preference, safe to drop */
    }
  }, [paper, fontScale, activeSetupId])

  function edit(t: Template) {
    setAiPrompt('')
    loadPageSetup(t.templateEntityId)
    setDraft({
      templateEntityId: t.templateEntityId,
      name: t.name,
      category: t.category,
      body: t.body,
      docKind: t.docKind ?? '',
      variables: t.variables ?? {},
    })
    setSeedKey((k) => k + 1)
  }

  function newDraft() {
    setAiPrompt('')
    loadPageSetup(null)
    setDraft({ ...EMPTY_DRAFT })
    setSeedKey((k) => k + 1)
  }

  // Field metadata edits from the Fields panel.
  function onVariablesChange(next: TemplateVariables) {
    setDraft((d) => (d ? { ...d, variables: next } : d))
  }

  // The editor emits HTML on change; convert back to the stored markdown body so
  // draft.body stays the single source of truth. No seedKey bump — a live edit
  // must not re-seed the editor.
  function onEditorChange(html: string) {
    setDraft((d) => (d ? { ...d, body: htmlToMarkdown(html) } : d))
  }

  // Insert a {{token}} chip at the cursor via the editor's imperative handle.
  function insertToken(id: string) {
    editorRef.current?.insertVariable(id)
  }

  async function generateWithAi(): Promise<boolean> {
    if (!draft || !aiPrompt.trim()) return false
    setAiBusy(true)
    setError(null)
    try {
      const r = await callAttorneyMcp<{ body: string }>({
        toolName: 'legal.template.ai_draft',
        input: { instructions: aiPrompt.trim(), category: draft.category },
      })
      setDraft({ ...draft, body: r.body })
      setSeedKey((k) => k + 1) // full-body replacement → re-seed the editor
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
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
      setSeedKey((k) => k + 1) // imported content appended → re-seed the editor
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
    // Persist only field metadata for tokens still in the body, and drop trivial
    // specs (plain text, nothing configured) so the stored map stays lean.
    const bodyTokens = new Set(extractTokens(draft.body))
    const variables: TemplateVariables = {}
    for (const [tok, spec] of Object.entries(draft.variables)) {
      if (!bodyTokens.has(tok)) continue
      const trivial =
        spec.type === 'text' && !spec.required && !spec.default && !spec.options?.length
      if (!trivial) variables[tok] = spec
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
            variables,
          },
        })
      } else {
        const res = await callAttorneyMcp<{ template: { templateEntityId: string } }>({
          toolName: 'legal.template.create',
          input: {
            name: draft.name.trim(),
            category: draft.category,
            body: draft.body,
            docKind: draft.category === 'document' ? draft.docKind.trim() || undefined : undefined,
            variables,
          },
        })
        // Carry the page setup chosen during creation onto the saved template id
        // so reopening it keeps the same paper/font (the create-time key is 'new').
        try {
          const raw = localStorage.getItem('tpl-pagesetup:new')
          const newId = res?.template?.templateEntityId
          if (raw && newId) localStorage.setItem(`tpl-pagesetup:${newId}`, raw)
        } catch {
          /* view-only preference — safe to drop */
        }
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

  // HTML the editor mounts with. Recomputed only on a deliberate re-seed
  // (seedKey), never on every keystroke — so typing doesn't reset the editor.
  // Intentionally keyed on seedKey, not draft.body (which the editor owns once
  // mounted); draftBodyRef gives the memo the latest body without re-running it.
  const draftBodyRef = useRef('')
  draftBodyRef.current = draft?.body ?? ''
  const initialHtml = useMemo(() => markdownToHtml(draftBodyRef.current), [seedKey])

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
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                ref={aiTriggerRef}
                type="button"
                className="tpl-ai-btn"
                onClick={() => setShowAi(true)}
                title="Draft this template with AI (uses your Anthropic key)"
              >
                <SparklesIcon size={15} /> Draft with AI
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={importing}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <FileTextIcon size={15} /> {importing ? 'Importing…' : 'Import file'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                style={{ display: 'none' }}
                onChange={onImportFile}
              />
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.6rem' }}>
              <button
                type="button"
                className={showFields ? 'primary' : undefined}
                onClick={() => setShowFields((v) => !v)}
                title="Configure each field's type, default, and whether it's required"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <LayersIcon size={15} /> Fields
              </button>
              <button
                type="button"
                className={showPreview ? 'primary' : undefined}
                onClick={() => setShowPreview((v) => !v)}
                title="Preview the finished document with sample data, side by side"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <EyeIcon size={15} /> Preview
              </button>
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
            {draft.category === 'document' && (
              <>
                <label>
                  <span className="field-label">Paper</span>
                  <select
                    value={paper}
                    onChange={(e) => setPaper(e.target.value as 'letter' | 'legal')}
                  >
                    <option value="letter">Letter (8.5 × 11)</option>
                    <option value="legal">Legal (8.5 × 14)</option>
                  </select>
                </label>
                <label>
                  <span className="field-label">Font size</span>
                  <select value={fontScale} onChange={(e) => setFontScale(Number(e.target.value))}>
                    <option value={0.9}>Small</option>
                    <option value={1}>Normal</option>
                    <option value={1.1}>Large</option>
                    <option value={1.2}>Extra large</option>
                  </select>
                </label>
              </>
            )}
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

          {/* Fields panel — typed metadata per {{token}}, toggled from the header. */}
          {showFields && (
            <section className="tpl-fields-section">
              <h3 className="tpl-fields-heading">Fields</h3>
              <TemplateFieldsPanel
                tokens={extractTokens(draft.body)}
                variables={draft.variables}
                onChange={onVariablesChange}
              />
            </section>
          )}

          {/* WYSIWYG canvas + optional live preview. The editor stays in the same
              DOM slot whether or not the preview column is shown, so toggling
              preview never re-mounts it. The body is stored as markdown with
              {{tokens}}, round-tripped via the shared bridge on change. */}
          <div
            className="tpl-split"
            // Page setup only applies to documents; emails fall back to the CSS
            // defaults (so a document's legal/large choice never bleeds into an
            // email draft, which has no controls to undo it).
            style={
              draft.category === 'document'
                ? ({
                    '--tpl-font-scale': fontScale,
                    '--tpl-page-aspect': paper === 'legal' ? 1.647 : 1.294,
                  } as React.CSSProperties)
                : undefined
            }
          >
            <div className="tpl-split-col">
              <TemplateEditor
                initialHtml={initialHtml}
                placeholder={
                  draft.category === 'email'
                    ? 'Write the email… use “Insert a field” to drop a {{token}}.'
                    : 'Dear {{client_name}}, …  — use “Insert a field” to drop a {{token}}.'
                }
                onChange={onEditorChange}
                editorRef={editorRef}
              />
            </div>
            {showPreview && (
              <div className="tpl-split-col">
                <TemplatePreview body={draft.body} variables={draft.variables} />
              </div>
            )}
          </div>

          {showAi && (
            <div
              className="tpl-modal-backdrop"
              onClick={() => {
                if (!aiBusy) closeAi()
              }}
            >
              <div
                className="tpl-modal"
                role="dialog"
                aria-label="Draft with AI"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="tpl-modal-head">
                  <SparklesIcon size={16} />
                  <span>Draft with AI</span>
                  <button
                    type="button"
                    className="tpl-modal-x"
                    onClick={closeAi}
                    disabled={aiBusy}
                    aria-label="Close"
                  >
                    <XIcon size={16} />
                  </button>
                </div>
                <textarea
                  autoFocus
                  className="tpl-modal-input"
                  value={aiPrompt}
                  disabled={aiBusy}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder={
                    draft.category === 'email'
                      ? 'Describe the email to draft — e.g. “a warm engagement-confirmation email with next steps”. The draft will use {{tokens}} for anything filled in per client.'
                      : 'Describe the document to draft — e.g. “a mutual NDA for a NC LLC, 2-year term”. The draft will use {{tokens}} for anything filled in per client or matter.'
                  }
                />
                {aiBusy && (
                  <div className="tpl-drafting" role="status" aria-live="polite">
                    <div className="tpl-drafting-label">
                      <SparklesIcon size={14} /> Drafting your {draft.category === 'email' ? 'email' : 'document'}…
                    </div>
                    <div className="tpl-drafting-lines" aria-hidden="true">
                      <span style={{ width: '92%' }} />
                      <span style={{ width: '78%' }} />
                      <span style={{ width: '85%' }} />
                      <span style={{ width: '66%' }} />
                      <span style={{ width: '80%' }} />
                    </div>
                  </div>
                )}
                <div className="tpl-modal-actions">
                  <button
                    type="button"
                    className="tpl-ai-btn"
                    disabled={aiBusy || !aiPrompt.trim()}
                    onClick={async () => {
                      const ok = await generateWithAi()
                      if (ok) closeAi()
                    }}
                  >
                    <SparklesIcon size={15} /> {aiBusy ? 'Drafting…' : 'Generate'}
                  </button>
                  <button type="button" onClick={closeAi} disabled={aiBusy}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
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
