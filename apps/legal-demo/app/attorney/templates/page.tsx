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
import { PageHead } from '@/components/PageHead'
import { markdownToHtml, htmlToMarkdown } from '@/lib/templateBody'
import type { TemplateVariables, TemplateVariableSpec } from '@exsto/legal'

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

// Normalize a typed document kind to the snake_case tag style the library uses
// ("Operating Agreement" → operating_agreement) so promotion-time matching stays
// exact-string. Keeps a trailing "_" so "operating_" types cleanly mid-word.
function normKind(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .slice(0, 60)
}

// Canonical form for ASSOCIATION comparisons (review finding on #284): the
// docKind combobox keeps trailing underscores while typing (normKind), MCP
// writers store free-text kinds verbatim, and service documents are slugified —
// three spellings of the same kind. Slug both sides of the includes() the same
// way so "Operating Agreement " still associates with operating_agreement.
function canonKind(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// Display form of a kind slug ("operating_agreement" → "Operating Agreement").
// Same helper as the per-service templates page — attorneys never see snake_case.
function humanKind(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Searchable document-kind combobox: the kinds already in the library as click
// options, filtered as you type, plus "use as new kind" for anything novel (beta
// feedback: the raw text input read as a schema field, not a control).
function DocKindCombobox({
  value,
  kinds,
  onChange,
}: {
  value: string
  kinds: string[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  // What the attorney typed, shown verbatim while editing; null means "not
  // editing — display the stored slug in human form". The slug never surfaces.
  const [text, setText] = useState<string | null>(null)
  const needle = value.trim().toLowerCase()
  const matches = needle ? kinds.filter((k) => k.includes(needle)) : kinds
  const isNew = needle.length > 0 && !kinds.includes(needle)
  return (
    <span className="tpl-kind-combo">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label="Document kind"
        value={text ?? (value ? humanKind(value) : '')}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false)
          setText(null)
        }}
        onChange={(e) => {
          setText(e.target.value)
          onChange(normKind(e.target.value))
          setOpen(true)
        }}
        placeholder="Search or add a kind…"
      />
      {open && (matches.length > 0 || isNew) && (
        <div className="tpl-kind-pop" role="listbox">
          {matches.map((k) => (
            <button
              key={k}
              type="button"
              className={`tpl-var-suggest-item${k === needle ? ' active' : ''}`}
              // mousedown (not click) so the input's blur doesn't close the list first.
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(k)
                setText(null)
                setOpen(false)
              }}
            >
              {humanKind(k)}
            </button>
          ))}
          {isNew && (
            <button
              type="button"
              className="tpl-var-suggest-item tpl-kind-new"
              onMouseDown={(e) => {
                e.preventDefault()
                setText(null)
                setOpen(false)
              }}
            >
              + Use new kind “{humanKind(needle)}”
            </button>
          )}
        </div>
      )}
    </span>
  )
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
  // The "Insert a field" palette — collapsed by default (beta feedback: it listed
  // every merge variable expanded and crowded the editor). The ghost "+" in the
  // body and typing `{{` / `#` are the primary insert paths.
  const [showInsert, setShowInsert] = useState(false)
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
  // Firm-wide field catalog (legal.template.field_library). Blue is ASSOCIATION,
  // not mere existence: a token binds blue only when its question lives in a
  // questionnaire of a service that produces this template's docKind. Fields
  // that exist elsewhere (other services / merge slots) are yellow. Lower-cased.
  const [firmFieldEntries, setFirmFieldEntries] = useState<
    Array<{ fieldId: string; services: string[] }>
  >([])
  const [mergeFields, setMergeFields] = useState<Set<string>>(() => new Set())
  const [serviceDocuments, setServiceDocuments] = useState<
    Array<{ serviceKey: string; documents: string[] }>
  >([])

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
    callAttorneyMcp<{
      firmFields: Array<{ fieldId: string; services: string[] }>
      mergeFields: string[]
      serviceDocuments: Array<{ serviceKey: string; documents: string[] }>
    }>({
      toolName: 'legal.template.field_library',
    })
      .then((r) => {
        if (cancelled) return
        setFirmFieldEntries(
          (r.firmFields ?? []).map((f) => ({
            fieldId: f.fieldId.toLowerCase(),
            services: f.services ?? [],
          })),
        )
        setMergeFields(new Set((r.mergeFields ?? []).map((t) => t.toLowerCase())))
        setServiceDocuments(
          (r.serviceDocuments ?? []).map((sd) => ({
            serviceKey: sd.serviceKey,
            documents: (sd.documents ?? []).map((d) => d.toLowerCase()),
          })),
        )
      })
      .catch(() => {
        // Best-effort like the question library — coloring degrades gracefully.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // The questionnaires ASSOCIATED with this document: services whose document
  // list includes the draft's docKind. Their field ids are the only ones that
  // bind blue — a question existing elsewhere isn't a binding, it's a candidate.
  const associatedFields = useMemo(() => {
    const dk = draft?.category === 'document' ? canonKind(draft.docKind) : ''
    if (!dk) return new Set<string>()
    const producing = new Set(
      serviceDocuments
        .filter((sd) => sd.documents.some((doc) => canonKind(doc) === dk))
        .map((sd) => sd.serviceKey),
    )
    if (producing.size === 0) return new Set<string>()
    return new Set(
      firmFieldEntries
        .filter((f) => f.services.some((sk) => producing.has(sk)))
        .map((f) => f.fieldId),
    )
  }, [draft?.category, draft?.docKind, firmFieldEntries, serviceDocuments])

  // A spec that carries no configuration. save() drops these to keep the stored
  // map lean; coloring must agree (a trivial spec is NOT a defined field), or
  // chips flip blue → yellow across a save with no content change.
  const isTrivialSpec = (spec: TemplateVariableSpec): boolean =>
    spec.type === 'text' && !spec.required && !spec.default && !spec.options?.length

  // Classify a {{variable}} for the editor (per the 2026-07-06 spec):
  //   matched (blue)   — bound to a question in a questionnaire ASSOCIATED with
  //                      this document (a service producing this docKind), or a
  //                      field defined on the template itself.
  //   orphaned (yellow) — the field/question EXISTS (question library, another
  //                      service's questionnaire, standard/merge slots) but no
  //                      associated questionnaire asks it.
  //   unknown (red)    — exists nowhere yet.
  // Matching is case-INSENSITIVE, mirroring renderTemplate (a hand-typed
  // {{COMPANY_NAME}} fills a company_name field) — never flag red what exists.
  const validateVariable = useMemo(() => {
    const bound = new Set<string>([
      ...associatedFields,
      ...Object.entries(draft?.variables ?? {})
        .filter(([, spec]) => !isTrivialSpec(spec))
        .map(([t]) => t.toLowerCase()),
    ])
    const exists = new Set<string>([
      ...bound,
      ...[...libraryTokens].map((t) => t.toLowerCase()),
      ...firmFieldEntries.map((f) => f.fieldId),
      ...STANDARD_TOKENS.map((t) => t.id.toLowerCase()),
      ...mergeFields,
    ])
    return (name: string): VariableStatus =>
      bound.has(name.toLowerCase())
        ? 'matched'
        : exists.has(name.toLowerCase())
          ? 'orphaned'
          : 'unknown'
  }, [libraryTokens, draft?.variables, associatedFields, firmFieldEntries, mergeFields])

  // Candidate names for the editor's `{{` autocomplete: the question library, the
  // firm-wide field catalog, the standard merge tokens, and the template's own
  // defined variables.
  const suggestVariables = useMemo(() => {
    const set = new Set<string>([
      ...libraryTokens,
      ...firmFieldEntries.map((f) => f.fieldId),
      ...mergeFields,
      ...STANDARD_TOKENS.map((t) => t.id),
      ...Object.keys(draft?.variables ?? {}),
    ])
    return [...set].sort()
  }, [libraryTokens, draft?.variables, firmFieldEntries, mergeFields])

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

  // Start a fresh draft and open the AI brief — the list-view "Draft with AI"
  // entry point (the in-editor button just opens the modal on the open draft).
  function startAiDraft() {
    newDraft()
    setShowAi(true)
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

  // Import a document into the body (appended to the canvas). Works from the list
  // view too: if no draft is open yet, the import starts a fresh one.
  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-importing the same file
    if (!file) return
    const hadDraft = Boolean(draft)
    setImporting(true)
    setError(null)
    try {
      const text = await parseFileToText(file)
      setDraft((d) => {
        const base = d ?? { ...EMPTY_DRAFT }
        return { ...base, body: base.body ? `${base.body}\n\n${text}` : text }
      })
      if (!hadDraft) loadPageSetup(null) // fresh draft → default page setup
      setSeedKey((k) => k + 1) // imported content → re-seed the editor
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
    // Case-insensitive: a spec keyed company_name survives a body typed
    // {{COMPANY_NAME}} (the merge treats them as the same field).
    const bodyTokens = new Set(extractTokens(draft.body).map((t) => t.toLowerCase()))
    const variables: TemplateVariables = {}
    for (const [tok, spec] of Object.entries(draft.variables)) {
      if (!bodyTokens.has(tok.toLowerCase())) continue
      if (!isTrivialSpec(spec)) variables[tok] = spec
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
    ? extractTokens(draft.body).filter(
        (t) => !STANDARD_TOKENS.some((s) => s.id === t.toLowerCase()),
      )
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
      <PageHead
        title="Templates"
        actions={
          !draft ? (
            <>
              <button className="primary" onClick={openNewChooser}>
                New template
              </button>
              <button
                type="button"
                className="tpl-ai-btn"
                onClick={startAiDraft}
                title="Start a new template and draft it with AI (uses your Anthropic key)"
              >
                <SparklesIcon size={15} /> Draft with AI
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={importing}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
              >
                <FileTextIcon size={15} /> {importing ? 'Importing…' : 'Import file'}
              </button>
            </>
          ) : undefined
        }
      />

      {/* One hidden file input for BOTH the header and the in-editor "Import file"
          buttons, mounted at page level so import works from the list view too. */}
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        style={{ display: 'none' }}
        onChange={onImportFile}
      />

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
        <section style={{ marginBottom: 'var(--space-5)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-3)',
            }}
          >
            <h2>{draft.templateEntityId ? 'Edit template' : 'New template'}</h2>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
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
                style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
              >
                <FileTextIcon size={15} /> {importing ? 'Importing…' : 'Import file'}
              </button>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
              <button
                type="button"
                className={showFields ? 'primary' : undefined}
                onClick={() => setShowFields((v) => !v)}
                title="Configure each field's type, default, and whether it's required"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
              >
                <LayersIcon size={15} /> Fields
              </button>
              <button
                type="button"
                className={showPreview ? 'primary' : undefined}
                onClick={() => setShowPreview((v) => !v)}
                title={
                  showPreview
                    ? 'Back to editing'
                    : 'Preview the finished document with sample data (replaces the editor until toggled back)'
                }
                style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
              >
                <EyeIcon size={15} /> {showPreview ? 'Edit' : 'Preview'}
              </button>
              <button className="primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : draft.templateEntityId ? 'Save changes' : 'Create template'}
              </button>
              <button onClick={() => setDraft(null)} disabled={saving}>
                Cancel
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 'var(--space-4)',
              flexWrap: 'wrap',
              marginBottom: 'var(--space-3)',
            }}
          >
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
                <DocKindCombobox
                  value={draft.docKind}
                  kinds={[
                    ...new Set(
                      (templates ?? [])
                        .map((t) => (t.docKind ?? '').trim().toLowerCase())
                        .filter(Boolean),
                    ),
                  ].sort()}
                  onChange={(v) => setDraft((d) => (d ? { ...d, docKind: v } : d))}
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

          {/* Click-to-insert token palette — collapsed by default; the ghost "+"
              in the body and typing `{{` / `#` are the primary insert paths. */}
          <div className="tpl-insert tpl-insert-collapsible">
            <button
              type="button"
              className="tpl-insert-toggle"
              aria-expanded={showInsert}
              onClick={() => setShowInsert((s) => !s)}
            >
              <span className={`tpl-insert-caret${showInsert ? ' open' : ''}`} aria-hidden="true">
                ▸
              </span>
              Insert a field
              <span className="tpl-insert-count">{STANDARD_TOKENS.length + bodyTokens.length}</span>
              <span className="tpl-insert-hint">
                or type {'{{'} or # in the document, or click the + at your cursor
              </span>
            </button>
            {showInsert && (
              <div className="tpl-insert-body">
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
            )}
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

          {/* WYSIWYG canvas OR full-width live preview — an Edit/Preview switch,
              not a split (beta feedback: side-by-side muddied the view). The
              editor stays MOUNTED (display:none) while previewing so toggling
              never re-mounts it or loses cursor/undo state. The body is stored as
              markdown with {{tokens}}, round-tripped via the shared bridge. */}
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
            <div className="tpl-split-col" style={showPreview ? { display: 'none' } : undefined}>
              <TemplateEditor
                initialHtml={initialHtml}
                placeholder={
                  draft.category === 'email'
                    ? 'Write the email… type {{ or # (or click the + at your cursor) to drop a {{token}}.'
                    : 'Dear {{client_name}}, …  — type {{ or # (or click the + at your cursor) to drop a {{token}}.'
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
        <section>
          <div className="table-wrap">
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
                    <td>{t.docKind ? humanKind(t.docKind) : '—'}</td>
                    <td>{new Date(t.updatedAt).toLocaleDateString()}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => edit(t)}>Edit</button>{' '}
                      <button onClick={() => archive(t)}>Archive</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  )
}
