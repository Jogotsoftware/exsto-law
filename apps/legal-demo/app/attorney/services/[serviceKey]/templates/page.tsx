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
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { streamTemplateAi } from '@/lib/templateAiStream'
import { TemplateEditor, type TemplateEditorHandle } from '@/components/templates/TemplateEditor'
import type { VariableStatus } from '@/components/templates/TemplateVariableNode'
import { TemplatePreview } from '@/components/templates/TemplatePreview'
import { EyeIcon } from '@/components/icons'
import { htmlToMarkdown, markdownToHtml } from '@/lib/templateBody'

// Standard merge tokens available in every document (filled at generation time
// from the client/matter), so the `{{` autocomplete and chip coloring recognize
// them even when they aren't bound to a questionnaire field.
const STANDARD_TOKENS = [
  'client_name',
  'client_email',
  'client_address',
  'matter_number',
  'firm_name',
  'attorney_name',
  'effective_date',
  'today',
]

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

interface AiModelOpt {
  id: string
  label: string
  available: boolean
  provider: string
  model: string
}
interface AiSkillOpt {
  slug: string
  name: string
  practiceArea: string
}

// Skill-aware AI assist for a service document. Revises the current body (or drafts
// fresh when empty) via legal.template.ai_enhance — same Anthropic key, skill
// auto-routing, and anti-hallucination standard as the standalone library and the
// chatbot. It returns text the attorney reviews and saves; nothing is persisted
// until "Save new version". The model + forced skills are pickable; the default is
// the cheapest available Claude (Haiku), since a polish pass is simple.
function AiEnhancePanel({
  currentBody,
  fieldIds,
  onResult,
  onClose,
}: {
  currentBody: string
  fieldIds: string[]
  onResult: (body: string) => void
  onClose: () => void
}) {
  const [instr, setInstr] = useState('')
  const [busy, setBusy] = useState(false)
  const [streamed, setStreamed] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [models, setModels] = useState<AiModelOpt[]>([])
  const [modelId, setModelId] = useState('')
  const [skills, setSkills] = useState<AiSkillOpt[]>([])
  const [skillSlugs, setSkillSlugs] = useState<string[]>([])
  const [skillQuery, setSkillQuery] = useState('')
  const hasBody = currentBody.trim().length > 0

  useEffect(() => {
    let cancelled = false
    callAttorneyMcp<{ models: AiModelOpt[] }>({ toolName: 'legal.assistant.models' })
      .then((r) => {
        if (cancelled) return
        const claude = (r.models ?? []).filter((m) => m.provider === 'anthropic' && m.available)
        setModels(claude)
        const rank = (m: AiModelOpt) =>
          /haiku/i.test(m.model) ? 0 : /sonnet/i.test(m.model) ? 1 : /opus/i.test(m.model) ? 2 : 3
        const cheapest = [...claude].sort((a, b) => rank(a) - rank(b))[0]
        setModelId((cur) => cur || cheapest?.id || '')
      })
      .catch(() => {})
    callAttorneyMcp<{ skills: AiSkillOpt[] }>({ toolName: 'legal.skill.list' })
      .then((r) => {
        if (!cancelled) setSkills(r.skills ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function run() {
    setBusy(true)
    setErr(null)
    setStreamed('')
    // Stream the generation (vs. one blocking call): a full document outlasts the
    // serverless gateway timeout — that was the 504 on "Enhance with AI". Streaming
    // keeps the connection alive and shows the body as it's written.
    let acc = ''
    try {
      await streamTemplateAi(
        {
          mode: hasBody ? 'enhance' : 'draft',
          category: 'document',
          instructions: instr.trim() || undefined,
          currentBody: hasBody ? currentBody : undefined,
          fieldIds: fieldIds.length ? fieldIds : undefined,
          skillSlugs: skillSlugs.length ? skillSlugs : undefined,
          modelId: modelId || undefined,
        },
        {
          onText: (t) => {
            acc += t
            setStreamed(acc)
          },
          onDone: () => {
            const out = acc.trim()
            if (out) {
              onResult(out)
              onClose()
            } else {
              setErr('The model returned nothing — try again.')
            }
          },
          onError: (m) => setErr(m),
        },
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const q = skillQuery.trim().toLowerCase()
  const skillMatches = q
    ? skills
        .filter(
          (s) =>
            !skillSlugs.includes(s.slug) &&
            (s.name.toLowerCase().includes(q) ||
              s.slug.toLowerCase().includes(q) ||
              s.practiceArea.toLowerCase().includes(q)),
        )
        .slice(0, 8)
    : []

  return (
    <div className="tpl-ai-panel">
      <textarea
        className="tpl-ai-instr"
        value={instr}
        onChange={(e) => setInstr(e.target.value)}
        rows={3}
        disabled={busy}
        placeholder={
          hasBody
            ? 'What should change? e.g. “add a severability clause”, “make it more formal” — or leave blank for a polish pass.'
            : 'Describe the document to draft, e.g. “a simple mutual NDA for a North Carolina LLC”.'
        }
      />
      {!busy && (
        <div className="tpl-ai-opts">
          <label className="tpl-ai-opt">
            <span className="tpl-ai-opt-lbl">Model</span>
            <select
              className="tpl-ai-opt-select"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            >
              {models.length === 0 && <option value="">Default</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <div className="tpl-ai-skillpick">
            <span className="tpl-ai-opt-lbl">Skills (optional — force a playbook)</span>
            {skillSlugs.length > 0 && (
              <div className="tpl-ai-skillchips">
                {skillSlugs.map((slug) => (
                  <span key={slug} className="tpl-ai-skillchip">
                    {skills.find((x) => x.slug === slug)?.name ?? slug}
                    <button
                      type="button"
                      onClick={() => setSkillSlugs((p) => p.filter((x) => x !== slug))}
                      aria-label="Remove skill"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              className="tpl-ai-skillsearch"
              value={skillQuery}
              onChange={(e) => setSkillQuery(e.target.value)}
              placeholder="Search legal skills to force…"
            />
            {q && (
              <div className="tpl-ai-skilllist">
                {skillMatches.length === 0 ? (
                  <div className="tpl-ai-skillempty">No matching skills.</div>
                ) : (
                  skillMatches.map((s) => (
                    <button
                      key={s.slug}
                      type="button"
                      className="tpl-ai-skillopt"
                      onClick={() => {
                        setSkillSlugs((p) => [...p, s.slug])
                        setSkillQuery('')
                      }}
                    >
                      <span>{s.name}</span>
                      <span className="tpl-ai-skillarea">{s.practiceArea}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {busy && (
        <div className="tpl-ai-stream" aria-live="polite">
          <div className="tpl-ai-stream-head">
            <span className="spinner" /> {hasBody ? 'Revising…' : 'Drafting…'}
          </div>
          {streamed ? (
            <pre className="tpl-ai-stream-body">{streamed}</pre>
          ) : (
            <div className="tpl-ai-stream-wait">Working with the model…</div>
          )}
        </div>
      )}
      {err && (
        <div className="alert alert-error" style={{ marginTop: 'var(--space-2)' }}>
          {err}
        </div>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        <button type="button" className="primary" onClick={() => void run()} disabled={busy}>
          {busy ? 'Working…' : hasBody ? 'Enhance with AI' : 'Draft with AI'}
        </button>
        <button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  )
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
  // Firm-wide field catalog (legal.template.field_library): questionnaire field
  // ids other services define + platform merge slots. A {{token}} matching one is
  // recognized (yellow, one-click bindable) instead of unknown/red. Lower-cased.
  const [knownFields, setKnownFields] = useState<Set<string>>(() => new Set())

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

  // Best-effort, once: recognition degrades to STANDARD_TOKENS if the tool fails.
  useEffect(() => {
    let cancelled = false
    callAttorneyMcp<{ firmFields: Array<{ fieldId: string }>; mergeFields: string[] }>({
      toolName: 'legal.template.field_library',
    })
      .then((r) => {
        if (cancelled) return
        setKnownFields(
          new Set([
            ...(r.firmFields ?? []).map((f) => f.fieldId.toLowerCase()),
            ...(r.mergeFields ?? []).map((t) => t.toLowerCase()),
          ]),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

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
      {error && <div className="alert alert-error">{error}</div>}
      {note && <div className="alert alert-success">{note}</div>}

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
            <p className="text-muted" style={{ marginTop: 'var(--space-4)' }}>
              No documents yet — add one above to start writing its template.
            </p>
          ) : (
            templates.map((t) => (
              <KindEditor
                key={t.documentKind}
                serviceKey={serviceKey}
                template={t}
                fields={fields}
                knownFields={knownFields}
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
    <section className="tpl-docs">
      {err && (
        <div className="alert alert-error" style={{ marginTop: 'var(--space-2)' }}>
          {err}
        </div>
      )}
      {docs.length > 0 && (
        <div className="tpl-docs-pills">
          {docs.map((d) => (
            <span key={d} className="tpl-docs-pill">
              {humanKind(d)}
              <button
                type="button"
                title="Remove this document"
                aria-label={`Remove ${humanKind(d)}`}
                disabled={busy}
                onClick={() => void persist(docs.filter((x) => x !== d))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="tpl-docs-add">
        {available.length > 0 && (
          <select
            className="tpl-docs-select"
            value=""
            aria-label="Add a document from the template library"
            disabled={busy}
            onChange={(e) => {
              if (e.target.value) add(e.target.value)
            }}
          >
            <option value="">+ Add from library…</option>
            {available.map((l) => (
              <option key={l.docKind} value={l.docKind}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <input
          className="tpl-docs-new"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            }
          }}
          placeholder="or name a new document…"
        />
        <button
          type="button"
          className="tpl-docs-addbtn"
          onClick={() => add(draft)}
          disabled={busy || !draft.trim()}
        >
          Add
        </button>
      </div>
    </section>
  )
}

function KindEditor({
  serviceKey,
  template,
  fields,
  knownFields,
  library,
  onAddFields,
  onSavedToLibrary,
}: {
  serviceKey: string
  template: TemplateDoc
  fields: QField[]
  // Firm-wide catalog (other services' field ids + merge slots), lower-cased —
  // widens the "recognized" tier so an existing field is never flagged red.
  knownFields: Set<string>
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
  const [showAi, setShowAi] = useState(false)
  // "Insert a field" collapses by default so the field list doesn't eat vertical
  // space — typing `{{` in the editor is the primary way to drop a field anyway.
  const [showFields, setShowFields] = useState(false)
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

  const tokens = extractTokens(text)
  // Token/field matching is case-INSENSITIVE, mirroring renderTemplate (a
  // hand-typed {{COMPANY_NAME}} fills a company_name field at merge time), so
  // the editor never flags red something the merge would fill.
  const fieldIds = new Set(fields.map((f) => f.id.toLowerCase()))
  const orphans = tokens.filter((tok) => !fieldIds.has(tok.toLowerCase()))

  // Editor `{{` autocomplete + chip coloring: a bound questionnaire field is
  // "matched"; a token that exists elsewhere — a standard token, a platform merge
  // slot, or a field another service's questionnaire already defines (knownFields)
  // — is recognized but unbound here ("orphaned", one click away via the orphans
  // banner); anything else is "unknown" (exists nowhere yet).
  const suggestVariables = [...new Set([...fields.map((f) => f.id), ...STANDARD_TOKENS])].sort()
  const recognizedLower = new Set([...STANDARD_TOKENS.map((t) => t.toLowerCase()), ...knownFields])
  const validateVariable = (name: string): VariableStatus =>
    fieldIds.has(name.toLowerCase())
      ? 'matched'
      : recognizedLower.has(name.toLowerCase())
        ? 'orphaned'
        : 'unknown'

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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-2)',
        }}
      >
        <strong>{humanKind(template.documentKind)}</strong>
        <button
          type="button"
          className={showAi ? 'primary' : undefined}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
          }}
          onClick={() => setShowAi((v) => !v)}
          title="Draft or revise this document with skill-aware AI"
        >
          ✨ AI
        </button>
        <button
          type="button"
          className={showPreview ? 'primary' : undefined}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
          onClick={() => setShowPreview((v) => !v)}
          title="Preview the finished document with sample data, side by side"
        >
          <EyeIcon size={15} /> Preview
        </button>
        <button className="primary" onClick={save} disabled={busy || !text.trim()}>
          {busy ? 'Saving…' : 'Save new version'}
        </button>
      </div>

      {showAi && (
        <AiEnhancePanel
          currentBody={text}
          fieldIds={fields.map((f) => f.id)}
          onClose={() => setShowAi(false)}
          onResult={(body) => {
            // Replace the body with the AI revision; remount the editor to re-seed
            // (typing flows through onChange, but a wholesale swap must re-seed HTML).
            setText(body)
            setSeedHtml(markdownToHtml(body))
            setEditorKey((k) => k + 1)
            setSaved(false)
            setErr(null)
          }}
        />
      )}

      <div className="tpl-insert" style={{ marginBottom: 'var(--space-2)' }}>
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
        <button type="button" onClick={() => void saveToLibrary()} disabled={busy || !text.trim()}>
          Save to library
        </button>
        {libNote && <span className="badge ok">{libNote}</span>}
      </div>

      <div className="tpl-insert tpl-insert-collapsible">
        <button
          type="button"
          className="tpl-insert-toggle"
          aria-expanded={showFields}
          onClick={() => setShowFields((s) => !s)}
        >
          <span className={`tpl-insert-caret${showFields ? ' open' : ''}`} aria-hidden="true">
            ▸
          </span>
          Insert a field
          {fields.length > 0 && <span className="tpl-insert-count">{fields.length}</span>}
          <span className="tpl-insert-hint">or just type {'{{'} in the document</span>
        </button>
        {showFields && (
          <div className="tpl-insert-body">
            {fields.length === 0 && (
              <span className="text-muted">No questions yet — add one →</span>
            )}
            {fields.map((f) => (
              <button
                key={f.id}
                className="qb-pill"
                type="button"
                onClick={() => insertField(f.id)}
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
        )}
      </div>

      {orphans.length > 0 && (
        <div className="alert alert-warn">
          Unbound markers (no matching question):{' '}
          {orphans.map((o) => (
            <code key={o} style={{ marginRight: 'var(--space-2)' }}>{`{{${o}}}`}</code>
          ))}
          <button
            type="button"
            style={{ marginLeft: 'var(--space-2)' }}
            onClick={() => void onAddFields(orphans.map((o) => ({ id: o, label: humanize(o) })))}
          >
            Add {orphans.length === 1 ? 'it' : 'them all'} as questions
          </button>
        </div>
      )}

      <div style={{ marginTop: 'var(--space-2)' }}>
        <span
          className="tpl-insert-label"
          style={{ display: 'block', marginBottom: 'var(--space-1)' }}
        >
          Document
        </span>
        <div className="tpl-split">
          <div className="tpl-split-col">
            <TemplateEditor
              key={editorKey}
              initialHtml={seedHtml}
              editorRef={editorRef}
              placeholder="Write the document. Type {{ to insert a field…"
              validateVariable={validateVariable}
              variableNames={suggestVariables}
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
        <div className="alert alert-error" style={{ marginTop: 'var(--space-2)' }}>
          {err}
        </div>
      )}
      {saved && (
        <div className="alert alert-success" style={{ marginTop: 'var(--space-2)' }}>
          Saved a new version.
        </div>
      )}
    </section>
  )
}
