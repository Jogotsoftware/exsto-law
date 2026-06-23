'use client'

// Document templates (WP2.5). A template is a document you write; you insert a
// field by point-and-click from the bound questionnaire's questions, which places
// a {{token}} bound to that question. Generating a document is a deterministic
// merge of the answers into those tokens — no AI (Contract H, renderTemplate).
//
// Binding is by name: a {{token}} is bound to the questionnaire field whose id is
// that token. Tokens with no matching question are ORPHANS — surfaced here with a
// one-click "add as a question". You can also build the whole questionnaire from a
// template's fields in one click. Composition: {{>other_template}} inlines another
// template (handled by renderTemplate; insert it like any token).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { TemplateEditor, type TemplateEditorHandle } from '@/components/templates/TemplateEditor'
import { TemplatePreview } from '@/components/templates/TemplatePreview'
import { EyeIcon } from '@/components/icons'
import { htmlToMarkdown, markdownToHtml } from '@/lib/templateBody'

interface ServiceDefinition {
  serviceKey: string
  displayName: string
  description: string | null
  route: 'auto' | 'manual'
  documents: string[]
  sortOrder: number
}
interface TemplateDoc {
  documentKind: string
  templateText: string | null
  source: 'config' | 'repo' | 'none'
  templateVersion: number | null
}
interface QField {
  id: string
  label: string
}
// A document template from the firm-wide library (legal.template.* / migration
// 0023): used both to populate the "add document" picker and to seed/save a
// service document body.
interface LibraryDoc {
  docKind: string
  name: string
  body: string
}

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
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}
function humanize(token: string): string {
  const s = token.replace(/_/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : token
}

function humanKind(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function TemplateEditorPage() {
  const params = useParams<{ serviceKey: string }>()
  const serviceKey = params.serviceKey

  const [service, setService] = useState<ServiceDefinition | null>(null)
  const [templates, setTemplates] = useState<TemplateDoc[]>([])
  const [fields, setFields] = useState<QField[]>([])
  const [library, setLibrary] = useState<LibraryDoc[]>([])
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  // The firm document-template library, fetched once: it powers the "add document"
  // picker and the per-document start-from / save-to-library actions.
  const loadLibrary = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<{
        templates: { category: string; docKind: string | null; name: string; body: string }[]
      }>({ toolName: 'legal.template.list' })
      setLibrary(
        r.templates
          .filter((t) => t.category === 'document')
          .map((t) => ({
            docKind: (t.docKind && t.docKind.trim()) || slugify(t.name),
            name: t.name,
            body: t.body ?? '',
          }))
          .filter((t) => t.docKind),
      )
    } catch {
      setLibrary([])
    }
  }, [])

  const loadQuestionnaire = useCallback(async () => {
    const r = await callAttorneyMcp<{
      questionnaire: { sections?: { fields?: { id: string; label: string }[] }[] } | null
    }>({ toolName: 'legal.service.questionnaire.get', input: { serviceKey } })
    const fs: QField[] = []
    for (const s of r.questionnaire?.sections ?? [])
      for (const f of s.fields ?? []) fs.push({ id: f.id, label: f.label || humanize(f.id) })
    setFields(fs)
  }, [serviceKey])

  const load = useCallback(async () => {
    setError(null)
    try {
      const svcRes = await callAttorneyMcp<{ service: ServiceDefinition | null }>({
        toolName: 'legal.service.get',
        input: { serviceKey },
      })
      if (!svcRes.service) {
        setError(`Service not found: ${serviceKey}`)
        return
      }
      setService(svcRes.service)
      const docs = svcRes.service.documents ?? []
      const states = await Promise.all(
        docs.map(async (documentKind) => {
          const r = await callAttorneyMcp<{ template: TemplateDoc | null }>({
            toolName: 'legal.service.template.get',
            input: { serviceKey, documentKind },
          })
          return {
            documentKind,
            templateText: r.template?.templateText ?? '',
            source: r.template?.source ?? ('none' as const),
            templateVersion: r.template?.templateVersion ?? null,
          }
        }),
      )
      setTemplates(states)
      await loadQuestionnaire()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [serviceKey, loadQuestionnaire])

  useEffect(() => {
    load()
    loadLibrary()
  }, [load, loadLibrary])

  // Add fields to the bound questionnaire through the core, then refresh. Used by
  // "add orphan as a question", inline new-field creation, and "build from template".
  const addFieldsToQuestionnaire = useCallback(
    async (newFields: { id: string; label: string }[]) => {
      const existing = new Set(fields.map((f) => f.id))
      const toAdd = newFields.filter((f) => !existing.has(f.id))
      const merged = [
        ...fields.map((f) => ({ id: f.id, label: f.label, type: 'text', required: true })),
        ...toAdd.map((f) => ({ id: f.id, label: f.label, type: 'text', required: true })),
      ]
      await callAttorneyMcp({
        toolName: 'legal.service.questionnaire.update',
        input: {
          serviceKey,
          intakeSchema: {
            id: serviceKey,
            version: 1,
            title: service?.displayName ?? serviceKey,
            sections: [{ id: 'document_fields', title: 'Document fields', fields: merged }],
          },
        },
      })
      await loadQuestionnaire()
      setNote(`Added ${toAdd.length} question${toAdd.length === 1 ? '' : 's'} to the intake form.`)
      setTimeout(() => setNote(null), 3000)
    },
    [fields, serviceKey, service, loadQuestionnaire],
  )

  return (
    <>
      <p style={{ color: 'var(--muted)', marginTop: '-0.2rem' }}>
        Choose which documents this service produces, then write each one. Insert a field by
        clicking a question below — that places a marker bound to the answer. Generating a document
        fills those markers from the client&rsquo;s answers; no AI is involved.
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {note && (
        <div
          className="alert"
          style={{ background: 'var(--ok-soft)', color: '#166534', border: '1px solid #86efac' }}
        >
          {note}
        </div>
      )}

      {!service ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : (
        <>
          <DocumentsManager
            serviceKey={serviceKey}
            service={service}
            library={library}
            onChanged={load}
          />
          {templates.length === 0 ? (
            <p className="text-muted" style={{ marginTop: '1rem' }}>
              No documents yet — add one above to start writing its template.
            </p>
          ) : (
            templates.map((t) => (
              <KindEditor
                key={t.documentKind}
                serviceKey={serviceKey}
                template={t}
                fields={fields}
                library={library}
                onAddFields={addFieldsToQuestionnaire}
                onSavedToLibrary={loadLibrary}
              />
            ))
          )}
        </>
      )}
    </>
  )
}

// Manage which documents this service produces. Adding/removing a document writes
// a new service version immediately (so its body editor appears/disappears below).
// Documents can be PICKED from the firm template library (the picker) or typed.
// Other service config (name, route, pricing, booking, questionnaire) is preserved
// across the save (name/route/sortOrder sent through; the rest carried by merge).
function DocumentsManager({
  serviceKey,
  service,
  library,
  onChanged,
}: {
  serviceKey: string
  service: ServiceDefinition
  library: LibraryDoc[]
  onChanged: () => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const docs = service.documents ?? []

  async function persist(next: string[]) {
    setBusy(true)
    setErr(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.service.update',
        input: {
          serviceKey,
          displayName: service.displayName,
          description: service.description,
          route: service.route,
          documents: next,
          sortOrder: service.sortOrder,
        },
      })
      await onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const add = (kind: string) => {
    const v = slugify(kind)
    if (!v || docs.includes(v)) return setDraft('')
    void persist([...docs, v])
    setDraft('')
  }
  const available = library.filter((l) => !docs.includes(l.docKind))

  return (
    <section style={{ borderLeft: '3px solid var(--border)' }}>
      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Documents this service produces</span>
      {err && (
        <div className="alert alert-error" style={{ marginTop: '0.4rem' }}>
          {err}
        </div>
      )}
      <div className="qb-pills">
        {docs.map((d) => (
          <span key={d} className="qb-pill">
            {humanKind(d)}
            <button
              type="button"
              title="Remove"
              disabled={busy}
              onClick={() => void persist(docs.filter((x) => x !== d))}
            >
              ×
            </button>
          </span>
        ))}
        {docs.length === 0 && (
          <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>None yet</span>
        )}
      </div>
      <div className="qb-pill-add">
        {available.length > 0 && (
          <select
            value=""
            aria-label="Add a document from the template library"
            disabled={busy}
            onChange={(e) => {
              if (e.target.value) add(e.target.value)
            }}
          >
            <option value="">Add from template library…</option>
            {available.map((l) => (
              <option key={l.docKind} value={l.docKind}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            }
          }}
          placeholder="or type a new one, e.g. operating agreement"
        />
        <button type="button" onClick={() => add(draft)} disabled={busy || !draft.trim()}>
          Add
        </button>
        <Link href="/attorney/templates" className="back-link" style={{ marginLeft: 'auto' }}>
          Open template library →
        </Link>
      </div>
    </section>
  )
}

function KindEditor({
  serviceKey,
  template,
  fields,
  library,
  onAddFields,
  onSavedToLibrary,
}: {
  serviceKey: string
  template: TemplateDoc
  fields: QField[]
  library: LibraryDoc[]
  onAddFields: (f: { id: string; label: string }[]) => Promise<void>
  onSavedToLibrary: () => Promise<void>
}) {
  const [text, setText] = useState(template.templateText ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [libNote, setLibNote] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const editorRef = useRef<TemplateEditorHandle | null>(null)
  // HTML seed for the rich editor + a key that remounts it when the body is
  // replaced wholesale (loading a library template). Normal typing flows through
  // onChange → text and never re-seeds, so the cursor position is preserved.
  const [seedHtml, setSeedHtml] = useState(() => markdownToHtml(template.templateText ?? ''))
  const [editorKey, setEditorKey] = useState(0)

  // Save the current body into the firm template library as a reusable document,
  // tagged with this document kind so it shows up as an "add from library" option
  // for other services. Does not change this service — it's a copy outward.
  async function saveToLibrary() {
    if (!text.trim()) {
      setErr('Nothing to save — the template is empty.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.template.create',
        input: {
          name: humanKind(template.documentKind),
          category: 'document',
          body: text,
          docKind: template.documentKind,
        },
      })
      await onSavedToLibrary()
      setLibNote('Saved to the template library.')
      setTimeout(() => setLibNote(null), 2500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const pdfInputRef = useRef<HTMLInputElement | null>(null)

  // Import a PDF as this document's body: read it as base64, parse to markdown via
  // the core (legal.template.import_pdf), seed the editor, then the attorney saves.
  async function importPdf(file: File) {
    if (text.trim() && !window.confirm('Replace this document body with the imported PDF?')) return
    setBusy(true)
    setErr(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
        reader.readAsDataURL(file)
      })
      const pdfBase64 = dataUrl.split(',')[1] ?? ''
      const r = await callAttorneyMcp<{
        bodyMd: string
        detectedVariables: string[]
        pageCount: number
      }>({
        toolName: 'legal.template.import_pdf',
        input: { pdfBase64, filename: file.name },
      })
      setText(r.bodyMd)
      setSeedHtml(markdownToHtml(r.bodyMd))
      setEditorKey((k) => k + 1)
      setSaved(false)
      const n = r.detectedVariables.length
      setLibNote(
        `Imported ${r.pageCount} page${r.pageCount === 1 ? '' : 's'}, ${n} field${n === 1 ? '' : 's'} detected. Review, then Save new version.`,
      )
      setTimeout(() => setLibNote(null), 6000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const tokens = extractTokens(text)
  const fieldIds = new Set(fields.map((f) => f.id))
  const orphans = tokens.filter((tok) => !fieldIds.has(tok))

  // Insert a bound field as an atomic {{marker}} chip at the cursor. The editor's
  // onChange then refreshes `text` (the markdown source of truth).
  function insertField(id: string) {
    editorRef.current?.insertVariable(id)
    setSaved(false)
  }

  async function addNewField() {
    const label = newLabel.trim()
    if (!label) return
    const id = slugify(label)
    await onAddFields([{ id, label }])
    insertField(id)
    setNewLabel('')
  }

  async function save() {
    if (!text.trim()) {
      setErr('The template cannot be empty.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.service.template.update',
        input: { serviceKey, documentKind: template.documentKind, templateText: text },
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{ borderLeft: '3px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <strong>{humanKind(template.documentKind)}</strong>
        <button
          type="button"
          className={showPreview ? 'primary' : undefined}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
          }}
          onClick={() => setShowPreview((v) => !v)}
          title="Preview the finished document with sample data, side by side"
        >
          <EyeIcon size={15} /> Preview
        </button>
        <button className="primary" onClick={save} disabled={busy || !text.trim()}>
          {busy ? 'Saving…' : 'Save new version'}
        </button>
      </div>

      <div className="tpl-insert" style={{ marginBottom: '0.5rem' }}>
        <span className="tpl-insert-label">Library:</span>
        {library.length > 0 && (
          <select
            value=""
            aria-label="Start from a library template"
            disabled={busy}
            onChange={(e) => {
              const pick = library.find((l) => l.docKind === e.target.value)
              if (!pick) return
              if (
                text.trim() &&
                !window.confirm('Replace this document body with the library template?')
              )
                return
              setText(pick.body)
              setSeedHtml(markdownToHtml(pick.body))
              setEditorKey((k) => k + 1)
              setSaved(false)
            }}
          >
            <option value="">Start from a library template…</option>
            {library.map((l) => (
              <option key={l.docKind} value={l.docKind}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <button type="button" onClick={() => pdfInputRef.current?.click()} disabled={busy}>
          Import PDF…
        </button>
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf,.pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void importPdf(f)
          }}
        />
        <button type="button" onClick={() => void saveToLibrary()} disabled={busy || !text.trim()}>
          Save to library
        </button>
        {libNote && <span style={{ color: '#166534', fontSize: '0.82rem' }}>{libNote}</span>}
      </div>

      <div className="tpl-insert">
        <span className="tpl-insert-label">Insert a field:</span>
        {fields.length === 0 && <span className="text-muted">No questions yet — add one →</span>}
        {fields.map((f) => (
          <button key={f.id} className="qb-pill" type="button" onClick={() => insertField(f.id)}>
            {f.label}
          </button>
        ))}
        <span className="tpl-newfield">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void addNewField()
              }
            }}
            placeholder="New field label…"
          />
          <button type="button" onClick={() => void addNewField()} disabled={!newLabel.trim()}>
            + Add &amp; insert
          </button>
        </span>
      </div>

      {orphans.length > 0 && (
        <div
          className="alert"
          style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}
        >
          Unbound markers (no matching question):{' '}
          {orphans.map((o) => (
            <code key={o} style={{ marginRight: '0.4rem' }}>{`{{${o}}}`}</code>
          ))}
          <button
            type="button"
            style={{ marginLeft: '0.5rem' }}
            onClick={() => void onAddFields(orphans.map((o) => ({ id: o, label: humanize(o) })))}
          >
            Add {orphans.length === 1 ? 'it' : 'them all'} as questions
          </button>
        </div>
      )}

      <div style={{ marginTop: '0.6rem' }}>
        <span className="tpl-insert-label" style={{ display: 'block', marginBottom: '0.35rem' }}>
          Document
        </span>
        <div className="tpl-split">
          <div className="tpl-split-col">
            <TemplateEditor
              key={editorKey}
              initialHtml={seedHtml}
              editorRef={editorRef}
              placeholder="Write the document. Click a field above to insert it as a marker…"
              onChange={(html) => {
                setText(htmlToMarkdown(html))
                setSaved(false)
                setErr(null)
              }}
            />
          </div>
          {showPreview && (
            <div className="tpl-split-col">
              <TemplatePreview body={text} />
            </div>
          )}
        </div>
      </div>

      {err && (
        <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>
          {err}
        </div>
      )}
      {saved && (
        <div
          className="alert"
          style={{
            marginTop: '0.5rem',
            background: 'var(--ok-soft)',
            color: '#166534',
            border: '1px solid #86efac',
          }}
        >
          Saved a new version.
        </div>
      )}
    </section>
  )
}
