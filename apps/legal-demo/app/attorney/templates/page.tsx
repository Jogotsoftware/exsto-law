'use client'

// Templates tab — the firm's reusable, NOT-service-bound template library (Obj 9).
// WP-E (Legal Instruments redesign): a comp-faithful gallery of proportional page
// thumbnails + a full-page editor (docs/design/legal-instruments — TEMPLATES /
// TEMPLATE EDITOR). The body is text with {{tokens}}; CRUD + AI go through the
// through-core legal.template.* tools.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { useConfirm } from '@/components/ConfirmModal'
import { TemplateConfigModal } from '@/components/configEditors'
import { readDevSession } from '@/lib/auth'
import {
  FileTextIcon,
  EyeIcon,
  XIcon,
  PlusIcon,
  CopyIcon,
  LayoutGridIcon,
  ChevronLeftIcon,
  PaperclipIcon,
  MoreHorizontalIcon,
} from '@/components/icons'
import { TemplateEditor, type TemplateEditorHandle } from '@/components/templates/TemplateEditor'
import type { VariableStatus } from '@/components/templates/TemplateVariableNode'
import { TemplateFieldsPanel } from '@/components/templates/TemplateFieldsPanel'
import { DocumentSheet, TokenChip } from '@/components/DocumentSheet'
import { GemCluster } from '@/components/GemSparkle'
import { markdownToHtml, htmlToMarkdown } from '@/lib/templateBody'
import { buildPreview } from '@/lib/templatePreview'
import { streamTemplateAi } from '@/lib/templateAiStream'
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
// Source of truth: the server's system-token set (verticals/legal/src/api/
// tokenClasses.ts) — keep this list in step with it. client_address is
// deliberately absent: it is CLIENT data, so a template using it correctly
// triggers a questionnaire proposal.
const STANDARD_TOKENS: { id: string; label: string }[] = [
  { id: 'client_name', label: 'Client name' },
  { id: 'client_email', label: 'Client email' },
  { id: 'matter_number', label: 'Matter number' },
  { id: 'firm_name', label: 'Firm name' },
  { id: 'firm_address', label: 'Firm address' },
  { id: 'firm_phone', label: 'Firm phone' },
  { id: 'firm_email', label: 'Firm email' },
  { id: 'attorney_name', label: 'Attorney name' },
  { id: 'attorney_email', label: 'Attorney email' },
  { id: 'effective_date', label: 'Effective date' },
  { id: 'today', label: "Today's date" },
  { id: 'letter_date', label: 'Letter date' },
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
// feedback: the raw text input read as a schema field, not a control). Unchanged
// by WP-E — an app-only meta control the comp's static demo doesn't model.
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

// The kind badge shown on a gallery card and the editor header — real data (the
// comp's "Letter"/"Agreement" badges are placeholder taxonomy this app doesn't
// have): the template's own document-kind tag when set, else its category.
function kindBadge(t: Pick<Template, 'category' | 'docKind'>): string {
  return t.docKind ? humanKind(t.docKind) : t.category === 'email' ? 'Email' : 'Document'
}

// Split a line of body text into literal-text / {{token}} runs, so a gallery
// thumbnail can render real merge tokens as gold chips (comp: editBlocks runs).
function renderTokenRuns(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const re = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(<TokenChip key={i++}>{`{{${m[1]}}}`}</TokenChip>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

// A light-touch markdown-to-plain pass for thumbnail text — strips heading
// markers, emphasis, and any raw inline HTML the body carries (aligned blocks
// / per-run styling are kept as literal <p style="..."> etc. in the stored
// markdown, see lib/templateBody.ts's alignedBlock rule — a thumbnail must
// never show that markup verbatim). Keeps {{tokens}} intact for
// renderTokenRuns above. No length-slicing here: overflow/ellipsis in CSS
// (.li-tpl-thumb-heading / .li-tpl-thumb-line) truncates visually without
// ever cutting a {{token}} in half.
function stripMd(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Real content for a gallery card thumbnail: the template's own first heading
// (or its name, if the body has none yet) + a few real body lines — never the
// comp's placeholder bars (README rule 4: comp demo data is never hardcoded).
function thumbPreview(t: Template): { heading: string; lines: string[] } {
  // isHeading is read off the RAW row (before stripMd removes the `#` marker
  // it's testing for) — stripMd is applied only to the text kept for display.
  const rawRows = (t.body ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  let heading = ''
  const lines: string[] = []
  for (const raw of rawRows) {
    const isHeading = /^#{1,6}\s+/.test(raw)
    const row = stripMd(raw)
    if (!row) continue
    if (!heading) {
      heading = row
      continue
    }
    if (isHeading) continue // one heading in the snippet, like the comp
    lines.push(row)
    if (lines.length >= 4) break
  }
  return { heading: heading || t.name || 'Untitled', lines }
}

export default function TemplatesPage() {
  const { confirm, confirmElement } = useConfirm()
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  // "New template" start-options chooser: scratch / clone existing / from a
  // questionnaire. Questionnaires load lazily the first time the chooser opens.
  const [showNew, setShowNew] = useState(false)
  // Phase 9: the shared edit-in-modal, opened per template row.
  const [modalTemplate, setModalTemplate] = useState<Template | null>(null)
  // The gallery card kebab menu (Edit in window / Retire) — only one open at a
  // time; the comp's card is a single "open the editor" click target, so these
  // two existing actions live behind a small per-card overflow instead.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [questionnaires, setQuestionnaires] = useState<QuestionnaireOpt[] | null>(null)
  const editorRef = useRef<TemplateEditorHandle | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const aiAttachRef = useRef<HTMLInputElement | null>(null)

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

  // Persistent inline AI-edit bar (comp: TEMPLATE EDITOR "Draft or revise with
  // AI"). One control drafts (empty body) or revises (non-empty body) the OPEN
  // document via legal.template.ai_enhance, streamed the same way the
  // per-service editor's "✨ AI" panel already does (lib/templateAiStream.ts).
  const [aiText, setAiText] = useState('')
  const [aiRunning, setAiRunning] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiAttachName, setAiAttachName] = useState('')
  const [aiAttachText, setAiAttachText] = useState('')
  const [aiAttaching, setAiAttaching] = useState(false)

  function load() {
    setError(null)
    callAttorneyMcp<{ templates: Template[] }>({ toolName: 'legal.template.list' })
      .then((res) => setTemplates(res.templates))
      .catch((err) => setError(err.message))
  }
  useEffect(load, [])

  // The question library (for variable coloring) + the firm-wide field catalog —
  // fetched once on mount, best-effort.
  useEffect(() => {
    let cancelled = false
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

  function closeDraft() {
    setDraft(null)
    setAiText('')
    setAiError(null)
    setAiAttachName('')
    setAiAttachText('')
    setShowPreview(false)
  }

  function edit(t: Template) {
    setDraft({
      templateEntityId: t.templateEntityId,
      name: t.name,
      category: t.category,
      body: t.body,
      docKind: t.docKind ?? '',
      variables: t.variables ?? {},
    })
    setAiText('')
    setAiError(null)
    setSeedKey((k) => k + 1)
  }

  function newDraft() {
    setDraft({ ...EMPTY_DRAFT })
    setAiText('')
    setAiError(null)
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
    setDraft({
      templateEntityId: null,
      name: `${t.name} (copy)`,
      category: t.category,
      body: t.body,
      docKind: t.docKind ?? '',
      variables: t.variables ?? {},
    })
    setAiText('')
    setAiError(null)
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
    setDraft({
      templateEntityId: null,
      name: q.name ? `${q.name} — document` : '',
      category: 'document',
      body: lines.join('\n\n'),
      docKind: '',
      variables,
    })
    setAiText('')
    setAiError(null)
    setSeedKey((k) => k + 1)
  }

  // Field metadata edits from the merge-fields rail.
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

  // Parse an uploaded file (PDF / Word / text) to plain text via the shared server
  // route (/api/attorney/templates/import). Reused by "import into body" and
  // "attach as AI context".
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
      setSeedKey((k) => k + 1) // imported content → re-seed the editor
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  // Attach a document as CONTEXT for the AI bar — its text is folded into the
  // instructions sent to legal.template.ai_enhance (NOT inserted into the body).
  async function onAttachAiFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setAiAttaching(true)
    setAiError(null)
    try {
      setAiAttachText(await parseFileToText(file))
      setAiAttachName(file.name)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err))
    } finally {
      setAiAttaching(false)
    }
  }

  // Draft (empty body) or revise (non-empty body) the open document with AI —
  // the persistent inline bar's one action. Streams over SSE (a full document
  // outlasts the serverless gateway's sync timeout) and applies the result once
  // done, same pattern as the per-service editor's AiEnhancePanel.
  async function runAiEdit() {
    if (!draft || !aiText.trim()) return
    const hasBody = draft.body.trim().length > 0
    const instructions = aiAttachText.trim()
      ? `${aiText.trim()}\n\n--- Reference document${
          aiAttachName ? ` (${aiAttachName})` : ''
        } ---\n${aiAttachText.trim()}`
      : aiText.trim()
    setAiRunning(true)
    setAiError(null)
    let acc = ''
    try {
      await streamTemplateAi(
        {
          mode: hasBody ? 'enhance' : 'draft',
          category: draft.category,
          instructions,
          currentBody: hasBody ? draft.body : undefined,
          fieldIds: Object.keys(draft.variables).length ? Object.keys(draft.variables) : undefined,
        },
        {
          onText: (t) => {
            acc += t
          },
          onDone: () => {
            const out = acc.trim()
            if (out) {
              setDraft((d) => (d ? { ...d, body: out } : d))
              setSeedKey((k) => k + 1)
              setAiText('')
              setAiAttachName('')
              setAiAttachText('')
            } else {
              setAiError('The model returned nothing — try again.')
            }
          },
          onError: (m) => setAiError(m),
        },
      )
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err))
    } finally {
      setAiRunning(false)
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
        await callAttorneyMcp({
          toolName: 'legal.template.create',
          input: {
            name: draft.name.trim(),
            category: draft.category,
            body: draft.body,
            docKind: draft.category === 'document' ? draft.docKind.trim() || undefined : undefined,
            variables,
          },
        })
      }
      closeDraft()
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function archive(t: Template) {
    const ok = await confirm({
      title: `Retire “${t.name}”?`,
      body: 'It will leave the library and every picker — kept as history; documents already generated from it are untouched. Retiring is blocked while a service or questionnaire still uses it.',
      confirmLabel: 'Retire',
      danger: true,
    })
    if (!ok) return
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.template.retire',
        input: { templateEntityId: t.templateEntityId },
      })
      if (draft?.templateEntityId === t.templateEntityId) closeDraft()
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const bodyTokens = draft ? extractTokens(draft.body) : []

  // HTML the editor mounts with. Recomputed only on a deliberate re-seed
  // (seedKey), never on every keystroke — so typing doesn't reset the editor.
  // Intentionally keyed on seedKey, not draft.body (which the editor owns once
  // mounted); draftBodyRef gives the memo the latest body without re-running it.
  const draftBodyRef = useRef('')
  draftBodyRef.current = draft?.body ?? ''
  const initialHtml = useMemo(() => markdownToHtml(draftBodyRef.current), [seedKey])

  return (
    <main className="li-tpl">
      {confirmElement}

      {/* One hidden file input for import, mounted once — the editor's toolbar-
          adjacent import button opens it. */}
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        style={{ display: 'none' }}
        onChange={onImportFile}
      />
      <input
        ref={aiAttachRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        style={{ display: 'none' }}
        onChange={onAttachAiFile}
      />

      {error && <div className="alert alert-error li-tpl-alert">{error}</div>}

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

      {!draft && (
        <>
          <div className="li-tpl-gallery-head">
            <h1 className="li-tpl-title">Templates</h1>
            <button type="button" className="li-tpl-new-btn" onClick={openNewChooser}>
              <PlusIcon size={16} />
              New template
            </button>
          </div>

          {templates === null && !error && (
            <div className="loading-block" role="status">
              <span className="spinner" /> Loading…
            </div>
          )}
          {templates && templates.length === 0 && (
            <p className="li-tpl-empty">
              No templates yet. Create your first reusable document or email template.
            </p>
          )}
          {templates && templates.length > 0 && (
            <div className="li-tpl-grid">
              {templates.map((t) => {
                const preview = thumbPreview(t)
                const tokenCount = extractTokens(t.body).length
                const updated = new Date(t.updatedAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })
                const menuOpen = openMenuId === t.templateEntityId
                return (
                  <div key={t.templateEntityId} className="li-tpl-card-wrap">
                    <button
                      type="button"
                      className="li-tpl-card"
                      onClick={() => edit(t)}
                      aria-label={`Open ${t.name || 'untitled template'}`}
                    >
                      <div className="li-tpl-card-thumbwrap">
                        <DocumentSheet variant="thumb" className="li-tpl-card-thumb">
                          <div className="li-tpl-thumb-heading">
                            {renderTokenRuns(preview.heading)}
                          </div>
                          <div className="li-tpl-thumb-body">
                            {preview.lines.map((l, i) => (
                              <div key={i} className="li-tpl-thumb-line">
                                {renderTokenRuns(l)}
                              </div>
                            ))}
                          </div>
                        </DocumentSheet>
                      </div>
                      <div className="li-tpl-card-meta">
                        <div className="li-tpl-card-row">
                          <span className="li-tpl-card-name">{t.name || '(untitled)'}</span>
                          <span className="li-tpl-card-badge">{kindBadge(t)}</span>
                        </div>
                        <div className="li-tpl-card-sub">
                          {tokenCount} merge token{tokenCount === 1 ? '' : 's'} · updated {updated}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="li-tpl-card-menu-btn"
                      aria-label={`More actions for ${t.name || 'untitled template'}`}
                      aria-expanded={menuOpen}
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenMenuId(menuOpen ? null : t.templateEntityId)
                      }}
                    >
                      <MoreHorizontalIcon size={16} />
                    </button>
                    {menuOpen && (
                      <div className="li-tpl-card-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenMenuId(null)
                            setModalTemplate(t)
                          }}
                        >
                          Edit in window
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="li-tpl-card-menu-danger"
                          onClick={() => {
                            setOpenMenuId(null)
                            void archive(t)
                          }}
                        >
                          Retire
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {draft && (
        <section className="li-tpl-editor">
          <button type="button" className="li-tpl-back" onClick={closeDraft}>
            <ChevronLeftIcon size={16} />
            Templates
          </button>

          <div className="li-tpl-editor-head">
            <div className="li-tpl-editor-headline">
              <input
                type="text"
                className="li-tpl-name-input"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Untitled template"
                aria-label="Template name"
              />
              <span className="li-tpl-kind-badge">{kindBadge(draft)}</span>
            </div>
            <div className="li-tpl-editor-actions">
              <button
                type="button"
                className={`li-tpl-preview-toggle${showPreview ? ' active' : ''}`}
                onClick={() => setShowPreview((v) => !v)}
                aria-pressed={showPreview}
                title="Preview the finished document with sample data, side by side"
              >
                <EyeIcon size={15} />
                Preview
              </button>
              <button type="button" className="li-tpl-save-btn" onClick={save} disabled={saving}>
                {saving
                  ? 'Saving…'
                  : draft.templateEntityId
                    ? 'Save new version'
                    : 'Create template'}
              </button>
            </div>
          </div>

          <div className="li-tpl-meta-row">
            <label className="li-tpl-meta-field">
              <span>Type</span>
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
              <label className="li-tpl-meta-field">
                <span>Document kind</span>
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
          </div>

          {/* Persistent inline AI-edit bar (comp: always visible under the header). */}
          <div className="li-tpl-ai-bar">
            <GemCluster size={20} />
            <input
              type="text"
              className="li-tpl-ai-input"
              value={aiText}
              disabled={aiRunning}
              onChange={(e) => setAiText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !aiRunning && aiText.trim()) {
                  e.preventDefault()
                  void runAiEdit()
                }
              }}
              placeholder={
                draft.body.trim()
                  ? 'Draft or revise with AI — e.g. “add a severability clause”, “make it more formal”…'
                  : 'Draft with AI — e.g. “a mutual NDA for an LLC, 2-year term”…'
              }
            />
            {aiAttachName ? (
              <span className="li-tpl-ai-chip" title={aiAttachName}>
                <PaperclipIcon size={12} />
                <span className="li-tpl-ai-chip-name">{aiAttachName}</span>
                <button
                  type="button"
                  aria-label="Remove attached reference document"
                  onClick={() => {
                    setAiAttachName('')
                    setAiAttachText('')
                  }}
                >
                  <XIcon size={11} />
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="li-tpl-ai-icon-btn"
                disabled={aiRunning || aiAttaching}
                onClick={() => aiAttachRef.current?.click()}
                title="Attach a reference document for AI context (optional)"
                aria-label="Attach a reference document for AI context"
              >
                <PaperclipIcon size={14} />
              </button>
            )}
            <button
              type="button"
              className="li-tpl-ai-icon-btn"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
              title={importing ? 'Importing…' : 'Import a document into the body'}
              aria-label="Import a document into the body"
            >
              <FileTextIcon size={14} />
            </button>
            {aiRunning ? (
              <span className="li-tpl-ai-busy" role="status" aria-live="polite">
                <span className="li-tpl-ai-spin" aria-hidden="true" />
                Editing…
              </span>
            ) : (
              <button
                type="button"
                className="li-tpl-ai-run"
                onClick={() => void runAiEdit()}
                disabled={!aiText.trim()}
              >
                Edit with AI
              </button>
            )}
          </div>
          {aiError && <div className="alert alert-error li-tpl-alert">{aiError}</div>}

          <div className="li-tpl-workspace">
            <div className="li-tpl-canvas-main">
              <TemplateEditor
                variant="li"
                aiRunning={aiRunning}
                initialHtml={initialHtml}
                placeholder={
                  draft.category === 'email'
                    ? 'Write the email… type {{ or # to drop a {{token}}.'
                    : 'Dear {{client_name}}, …  — type {{ or # to drop a {{token}}.'
                }
                onChange={onEditorChange}
                editorRef={editorRef}
                validateVariable={validateVariable}
                variableNames={suggestVariables}
              >
                {showPreview && (
                  <TemplateSampleSheet body={draft.body} variables={draft.variables} />
                )}
              </TemplateEditor>
            </div>
            <aside className="li-tpl-rail">
              <div className="li-tpl-rail-title">Merge fields</div>
              <p className="li-tpl-rail-hint">
                Each <code className="li-token-chip">{'{{token}}'}</code> in the document is filled
                from these fields at generation time.
              </p>
              <TemplateFieldsPanel
                tokens={bodyTokens}
                variables={draft.variables}
                onChange={onVariablesChange}
                onInsert={insertToken}
              />
              <div className="li-tpl-rail-subtitle">Standard fields</div>
              <div className="li-tpl-standard-chips">
                {STANDARD_TOKENS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="li-tpl-standard-chip"
                    onClick={() => insertToken(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </aside>
          </div>
        </section>
      )}

      {/* UI-BUILDER-FIX-1 Phase 9: the shared edit-in-modal (view / rich-text
          edit / AI-regenerate via worker_job / save) — no navigation. */}
      {modalTemplate && (
        <TemplateConfigModal
          template={modalTemplate}
          onClose={() => setModalTemplate(null)}
          onChanged={load}
        />
      )}
    </main>
  )
}

// The comp's side-by-side "Preview · sample data" page — a second DocumentSheet
// `editor` page rendering the SAME body merged against sample data (the shared
// preview engine, lib/templatePreview.ts) instead of the editable canvas.
function TemplateSampleSheet({ body, variables }: { body: string; variables: TemplateVariables }) {
  const { html } = useMemo(() => buildPreview(body, undefined, variables), [body, variables])
  return (
    <DocumentSheet variant="editor" serif className="li-tpl-page li-tpl-page--preview">
      <span className="li-tpl-preview-tag">Preview · sample data</span>
      {/* html is sanitized by renderDocumentHtml (lib/documentHtml.ts) via buildPreview. */}
      <div className="li-tpl-page-body" dangerouslySetInnerHTML={{ __html: html }} />
    </DocumentSheet>
  )
}
