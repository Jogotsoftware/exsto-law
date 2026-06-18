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

interface ServiceDefinition {
  serviceKey: string
  displayName: string
  documents: string[]
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
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

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
  }, [load])

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
    <main>
      <div
        className="attorney-page-head"
        style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}
      >
        <h1 style={{ margin: 0 }}>Document templates</h1>
        <Link
          href={`/attorney/services/${serviceKey}`}
          className="back-link"
          style={{ marginLeft: 'auto' }}
        >
          Back to service
        </Link>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: '-0.4rem' }}>
        Write each document the way it should read. Insert a field by clicking a question below —
        that places a marker bound to the answer. Generating a document fills those markers from the
        client&rsquo;s answers; no AI is involved.
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
      ) : templates.length === 0 ? (
        <div className="loading-block">
          This service has no documents yet. Add a document on the service editor first.
        </div>
      ) : (
        templates.map((t) => (
          <KindEditor
            key={t.documentKind}
            serviceKey={serviceKey}
            template={t}
            fields={fields}
            onAddFields={addFieldsToQuestionnaire}
          />
        ))
      )}
    </main>
  )
}

function KindEditor({
  serviceKey,
  template,
  fields,
  onAddFields,
}: {
  serviceKey: string
  template: TemplateDoc
  fields: QField[]
  onAddFields: (f: { id: string; label: string }[]) => Promise<void>
}) {
  const [text, setText] = useState(template.templateText ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const ref = useRef<HTMLTextAreaElement | null>(null)

  const tokens = extractTokens(text)
  const fieldIds = new Set(fields.map((f) => f.id))
  const orphans = tokens.filter((tok) => !fieldIds.has(tok))

  function insertAtCursor(snippet: string) {
    const el = ref.current
    const at = el ? el.selectionStart : text.length
    const next = text.slice(0, at) + snippet + text.slice(el ? el.selectionEnd : text.length)
    setText(next)
    setSaved(false)
    requestAnimationFrame(() => {
      if (el) {
        const pos = at + snippet.length
        el.focus()
        el.setSelectionRange(pos, pos)
      }
    })
  }

  async function addNewField() {
    const label = newLabel.trim()
    if (!label) return
    const id = slugify(label)
    await onAddFields([{ id, label }])
    insertAtCursor(`{{${id}}}`)
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
          className="primary"
          style={{ marginLeft: 'auto' }}
          onClick={save}
          disabled={busy || !text.trim()}
        >
          {busy ? 'Saving…' : 'Save new version'}
        </button>
      </div>

      <div className="tpl-insert">
        <span className="tpl-insert-label">Insert a field:</span>
        {fields.length === 0 && <span className="text-muted">No questions yet — add one →</span>}
        {fields.map((f) => (
          <button
            key={f.id}
            className="qb-pill"
            type="button"
            onClick={() => insertAtCursor(`{{${f.id}}}`)}
          >
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

      <label>
        <span>Document</span>
        <textarea
          ref={ref}
          className="tpl-canvas"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setSaved(false)
            setErr(null)
          }}
          rows={24}
          placeholder="Write the document. Click a field above to insert a {{marker}}…"
        />
      </label>

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
