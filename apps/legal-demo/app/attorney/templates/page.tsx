'use client'

// Templates tab — the firm's reusable, NOT-service-bound template library (Obj 9).
// Builder UX (UI refresh): a document-styled canvas, a click-to-insert merge-token
// palette (like Outreach's email tokens), AI-drafting from a plain-language brief,
// and import (paste or upload a text/markdown/HTML file). The body is text with
// {{tokens}}; CRUD + AI go through the through-core legal.template.* tools.

import { useEffect, useMemo, useRef, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { readDevSession } from '@/lib/auth'
import {
  SparklesIcon,
  FileTextIcon,
  EyeIcon,
  LayersIcon,
  XIcon,
  PlusIcon,
  CopyIcon,
  LayoutGridIcon,
} from '@/components/icons'
import { TemplateEditor, type TemplateEditorHandle } from '@/components/templates/TemplateEditor'
import type { VariableStatus } from '@/components/templates/TemplateVariableNode'
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

// Options for the "Draft with AI" model + skill pickers.
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

// A questionnaire from the firm library — used to seed a new template with its
// fields as {{variables}}. Only the bits the chooser consumes are typed.
interface QuestionnaireOpt {
  questionnaireTemplateId: string
  name: string
  fieldCount: number
  schema?: { sections?: Array<{ fields?: Array<{ id?: string; label?: string }> }> }
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
  // A document attached as context for the AI draft — parsed to text and folded
  // into the brief (not inserted into the body).
  const [aiAttachName, setAiAttachName] = useState('')
  const [aiAttachText, setAiAttachText] = useState('')
  const [aiAttaching, setAiAttaching] = useState(false)
  const [showAi, setShowAi] = useState(false)
  // "Draft with AI" options: model (defaults to cheapest) + optional forced skills.
  const [aiModelId, setAiModelId] = useState('')
  const [aiModels, setAiModels] = useState<AiModelOpt[]>([])
  const [aiSkills, setAiSkills] = useState<AiSkillOpt[]>([])
  const [aiSkillSlugs, setAiSkillSlugs] = useState<string[]>([])
  const [aiSkillQuery, setAiSkillQuery] = useState('')
  const [importing, setImporting] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showFields, setShowFields] = useState(false)
  // "New template" start-options chooser: scratch / clone existing / from a
  // questionnaire. Questionnaires load lazily the first time the chooser opens.
  const [showNew, setShowNew] = useState(false)
  const [questionnaires, setQuestionnaires] = useState<QuestionnaireOpt[] | null>(null)
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
  // Platform question-library tokens — the variables that have a corresponding
  // intake question. Used to color {{variables}} in the editor (best-effort; the
  // chips just fall back to "no question / yellow" if the library can't load).
  const [libraryTokens, setLibraryTokens] = useState<Set<string>>(() => new Set())

  function load() {
    setError(null)
    callAttorneyMcp<{ templates: Template[] }>({ toolName: 'legal.template.list' })
      .then((res) => setTemplates(res.templates))
      .catch((err) => setError(err.message))
  }
  useEffect(load, [])

  // Model + skill options for "Draft with AI" and the question library for variable
  // coloring — all fetched once on mount, best-effort. The model defaults to the
  // cheapest available Claude model (drafts are simple, so Haiku is plenty).
  useEffect(() => {
    let cancelled = false
    callAttorneyMcp<{ models: AiModelOpt[] }>({ toolName: 'legal.assistant.models' })
      .then((r) => {
        if (cancelled) return
        const claude = (r.models ?? []).filter((m) => m.provider === 'anthropic' && m.available)
        setAiModels(claude)
        const rank = (m: AiModelOpt) =>
          /haiku/i.test(m.model) ? 0 : /sonnet/i.test(m.model) ? 1 : /opus/i.test(m.model) ? 2 : 3
        const cheapest = [...claude].sort((a, b) => rank(a) - rank(b))[0]
        setAiModelId((cur) => cur || cheapest?.id || '')
      })
      .catch(() => {})
    callAttorneyMcp<{ skills: AiSkillOpt[] }>({ toolName: 'legal.skill.list' })
      .then((r) => {
        if (!cancelled) setAiSkills(r.skills ?? [])
      })
      .catch(() => {})
    callAttorneyMcp<{ questions: Array<{ token?: string }> }>({
      toolName: 'legal.question_template.list',
    })
      .then((r) => {
        if (cancelled) return
        const toks = (r.questions ?? []).map((q) => (q.token ?? '').trim()).filter(Boolean)
        setLibraryTokens(new Set(toks))
      })
      .catch(() => {
        // No library / tool unavailable — coloring still works off STANDARD_TOKENS
        // and the template's own defined variables.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Classify a {{variable}} for the editor: a variable backed by a question
  // (library question OR a defined template variable) is "matched" (blue); a
  // recognized variable with no question (e.g. an auto-fill token) is "orphaned"
  // (yellow); anything unrecognized is "unknown" (red).
  const validateVariable = useMemo(() => {
    const hasQuestion = new Set<string>([...libraryTokens, ...Object.keys(draft?.variables ?? {})])
    const known = new Set<string>([...hasQuestion, ...STANDARD_TOKENS.map((t) => t.id)])
    return (name: string): VariableStatus =>
      hasQuestion.has(name) ? 'matched' : known.has(name) ? 'orphaned' : 'unknown'
  }, [libraryTokens, draft?.variables])

  // Candidate names for the editor's `{{` autocomplete: the question library, the
  // standard merge tokens, and the template's own defined variables.
  const suggestVariables = useMemo(() => {
    const set = new Set<string>([
      ...libraryTokens,
      ...STANDARD_TOKENS.map((t) => t.id),
      ...Object.keys(draft?.variables ?? {}),
    ])
    return [...set].sort()
  }, [libraryTokens, draft?.variables])

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

  // Open the "how do you want to start?" chooser; lazy-load questionnaires once.
  function openNewChooser() {
    setShowNew(true)
    if (questionnaires === null) {
      callAttorneyMcp<{ questionnaires: QuestionnaireOpt[] }>({
        toolName: 'legal.questionnaire_template.list',
      })
        .then((r) => setQuestionnaires(r.questionnaires ?? []))
        .catch(() => setQuestionnaires([]))
    }
  }

  // Start from scratch (the original behavior), now routed through the chooser.
  function startFromScratch() {
    setShowNew(false)
    newDraft()
  }

  // Clone an existing template into a brand-new, unsaved draft (no entity id).
  function startFromClone(t: Template) {
    setShowNew(false)
    setAiPrompt('')
    loadPageSetup(null)
    setDraft({
      templateEntityId: null,
      name: `${t.name} (copy)`,
      category: t.category,
      body: t.body,
      docKind: t.docKind ?? '',
      variables: t.variables ?? {},
    })
    setSeedKey((k) => k + 1)
  }

  // Seed a new draft from a questionnaire: each field becomes a {{token}} in the
  // body (labelled) and a defined text variable, so the document is pre-wired to
  // the intake answers.
  function startFromQuestionnaire(q: QuestionnaireOpt) {
    setShowNew(false)
    const fields = (q.schema?.sections ?? []).flatMap((s) => s.fields ?? [])
    const variables: TemplateVariables = {}
    const lines: string[] = []
    for (const f of fields) {
      const tok = (f.id ?? '').trim().toLowerCase()
      if (!tok || variables[tok]) continue
      variables[tok] = { type: 'text' }
      lines.push(`${f.label?.trim() || humanize(tok)}: {{${tok}}}`)
    }
    setAiPrompt('')
    loadPageSetup(null)
    setDraft({
      templateEntityId: null,
      name: q.name ? `${q.name} — document` : '',
      category: 'document',
      body: lines.join('\n\n'),
      docKind: '',
      variables,
    })
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
      // Fold any attached reference document into the brief, so the AI drafts from
      // it. ai_draft is unchanged — the document rides along in `instructions`.
      const instructions = aiAttachText.trim()
        ? `${aiPrompt.trim()}\n\n--- Reference document${
            aiAttachName ? ` (${aiAttachName})` : ''
          } ---\n${aiAttachText.trim()}`
        : aiPrompt.trim()
      const r = await callAttorneyMcp<{ body: string }>({
        toolName: 'legal.template.ai_draft',
        input: {
          instructions,
          category: draft.category,
          skillSlugs: aiSkillSlugs.length ? aiSkillSlugs : undefined,
          modelId: aiModelId || undefined,
        },
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

  // Parse an uploaded file (PDF / Word / text) to plain text via the shared server
  // route (/api/attorney/templates/import). Reused by "import into body" and
  // "attach as AI-draft context". Dev forwards the demo-session headers.
  async function parseFileToText(file: File): Promise<string> {
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
    return data.text
  }

  // Import a document into the body (appended to the canvas).
  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-importing the same file
    if (!file || !draft) return
    setImporting(true)
    setError(null)
    try {
      const text = await parseFileToText(file)
      setDraft((d) => (d ? { ...d, body: d.body ? `${d.body}\n\n${text}` : text } : d))
      setSeedKey((k) => k + 1) // imported content appended → re-seed the editor
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  // Attach a document as CONTEXT for the AI draft — its text is folded into the
  // brief sent to legal.template.ai_draft (NOT inserted into the body), so the AI
  // can draft from a sample/source document.
  async function onAttachAiFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setAiAttaching(true)
    setError(null)
    try {
      setAiAttachText(await parseFileToText(file))
      setAiAttachName(file.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAiAttaching(false)
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
          <button className="primary" onClick={openNewChooser}>
            New template
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {showNew && (
        <div className="tpl-modal-backdrop" onClick={() => setShowNew(false)}>
          <div
            className="tpl-modal tpl-new-modal"
            role="dialog"
            aria-label="New template"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tpl-modal-head">
              <PlusIcon size={16} />
              <span>New template</span>
              <button
                type="button"
                className="tpl-modal-x"
                onClick={() => setShowNew(false)}
                aria-label="Close"
              >
                <XIcon size={16} />
              </button>
            </div>
            <div className="tpl-new-body">
              <button type="button" className="tpl-new-option" onClick={startFromScratch}>
                <FileTextIcon size={18} />
                <span className="tpl-new-option-t">Start from scratch</span>
                <span className="tpl-new-option-d">A blank document you build yourself.</span>
              </button>

              <div className="tpl-new-group">
                <div className="tpl-new-group-h">
                  <CopyIcon size={15} /> Clone an existing template
                </div>
                {templates && templates.length > 0 ? (
                  <ul className="tpl-new-list">
                    {templates.map((t) => (
                      <li key={t.templateEntityId}>
                        <button
                          type="button"
                          className="tpl-new-pick"
                          onClick={() => startFromClone(t)}
                        >
                          <span className="tpl-new-pick-name">{t.name || 'Untitled'}</span>
                          <span className="tpl-new-pick-meta">{t.category}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="tpl-new-empty">No templates yet.</p>
                )}
              </div>

              <div className="tpl-new-group">
                <div className="tpl-new-group-h">
                  <LayoutGridIcon size={15} /> Start from a questionnaire
                </div>
                {questionnaires === null ? (
                  <p className="tpl-new-empty">Loading questionnaires…</p>
                ) : questionnaires.length > 0 ? (
                  <ul className="tpl-new-list">
                    {questionnaires.map((q) => (
                      <li key={q.questionnaireTemplateId}>
                        <button
                          type="button"
                          className="tpl-new-pick"
                          onClick={() => startFromQuestionnaire(q)}
                        >
                          <span className="tpl-new-pick-name">
                            {q.name || 'Untitled questionnaire'}
                          </span>
                          <span className="tpl-new-pick-meta">
                            {q.fieldCount} field{q.fieldCount === 1 ? '' : 's'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="tpl-new-empty">No questionnaires in the library.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
                validateVariable={validateVariable}
                variableNames={suggestVariables}
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
                {/* Attach a reference document — its text is folded into the brief
                    so the AI drafts from it (it is NOT inserted into the body). */}
                <div className="tpl-ai-attach">
                  <input
                    id="tpl-ai-attach-input"
                    type="file"
                    accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                    style={{ display: 'none' }}
                    onChange={onAttachAiFile}
                  />
                  {aiAttachName ? (
                    <span className="tpl-ai-attach-chip" title={aiAttachName}>
                      <FileTextIcon size={13} />
                      <span className="tpl-ai-attach-name">{aiAttachName}</span>
                      <button
                        type="button"
                        className="tpl-ai-attach-x"
                        aria-label="Remove attached document"
                        onClick={() => {
                          setAiAttachName('')
                          setAiAttachText('')
                        }}
                      >
                        <XIcon size={12} />
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="tpl-ai-attach-btn"
                      disabled={aiBusy || aiAttaching}
                      onClick={() => document.getElementById('tpl-ai-attach-input')?.click()}
                    >
                      <FileTextIcon size={14} />
                      {aiAttaching ? 'Reading…' : 'Attach a document (optional)'}
                    </button>
                  )}
                </div>
                {!aiBusy && (
                  <div className="tpl-ai-opts">
                    <label className="tpl-ai-opt">
                      <span className="tpl-ai-opt-lbl">Model</span>
                      <select
                        className="tpl-ai-opt-select"
                        value={aiModelId}
                        onChange={(e) => setAiModelId(e.target.value)}
                      >
                        {aiModels.length === 0 && <option value="">Default</option>}
                        {aiModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="tpl-ai-skillpick">
                      <span className="tpl-ai-opt-lbl">Skills (optional — force a playbook)</span>
                      {aiSkillSlugs.length > 0 && (
                        <div className="tpl-ai-skillchips">
                          {aiSkillSlugs.map((slug) => (
                            <span key={slug} className="tpl-ai-skillchip">
                              {aiSkills.find((x) => x.slug === slug)?.name ?? slug}
                              <button
                                type="button"
                                onClick={() => setAiSkillSlugs((p) => p.filter((x) => x !== slug))}
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
                        value={aiSkillQuery}
                        onChange={(e) => setAiSkillQuery(e.target.value)}
                        placeholder="Search legal skills to force…"
                      />
                      {aiSkillQuery.trim() &&
                        (() => {
                          const q = aiSkillQuery.toLowerCase()
                          const matches = aiSkills
                            .filter(
                              (s) =>
                                !aiSkillSlugs.includes(s.slug) &&
                                (s.name.toLowerCase().includes(q) ||
                                  s.slug.toLowerCase().includes(q) ||
                                  s.practiceArea.toLowerCase().includes(q)),
                            )
                            .slice(0, 8)
                          return (
                            <div className="tpl-ai-skilllist">
                              {matches.length === 0 ? (
                                <div className="tpl-ai-skillempty">No matching skills.</div>
                              ) : (
                                matches.map((s) => (
                                  <button
                                    key={s.slug}
                                    type="button"
                                    className="tpl-ai-skillopt"
                                    onClick={() => {
                                      setAiSkillSlugs((p) => [...p, s.slug])
                                      setAiSkillQuery('')
                                    }}
                                  >
                                    <span>{s.name}</span>
                                    <small>{s.practiceArea}</small>
                                  </button>
                                ))
                              )}
                            </div>
                          )
                        })()}
                    </div>
                  </div>
                )}
                {aiBusy && (
                  <div className="tpl-drafting" role="status" aria-live="polite">
                    <div className="tpl-drafting-label">
                      <SparklesIcon size={14} /> Drafting your{' '}
                      {draft.category === 'email' ? 'email' : 'document'}…
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
