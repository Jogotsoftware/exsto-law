'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { CopyIcon, LayersIcon, PlusIcon, SearchIcon, UsersIcon, XIcon } from '@/components/icons'

// The exact field types the public booking page (apps/legal-demo/app/book)
// renders. Keep in lockstep with KNOWN_FIELD_TYPES in the legal API — anything
// else is rejected on save. The attorney picks by friendly label; the raw type
// key is never shown (WP2.4: no typed enums on the surface).
const FIELD_TYPES = [
  'text',
  'textarea',
  'select',
  'yes_no',
  'true_false',
  'checkbox',
  'date',
  'number',
  'address_autocomplete',
  'members_repeater',
] as const
type FieldType = (typeof FIELD_TYPES)[number]

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Short text',
  textarea: 'Long text',
  select: 'Dropdown',
  yes_no: 'Yes / No',
  true_false: 'True / False',
  checkbox: 'Checkboxes (select many)',
  date: 'Date',
  number: 'Number',
  address_autocomplete: 'Address',
  members_repeater: 'Members (repeating)',
}

// Answer types that carry a choice list edited via OptionPills.
const OPTION_FIELD_TYPES: ReadonlySet<FieldType> = new Set(['select', 'checkbox'])

interface EditorField {
  // The field's VARIABLE — the {{token}} a document-template merge-field binds to.
  // Editable per question (the "Variable" input); defaults to a slug of the label
  // when left blank, and is preserved across label changes so a template binding
  // never breaks. editorFieldToWire prefers this explicit value over the slug.
  id: string
  label: string
  type: FieldType
  required: boolean
  allow_unknown: boolean
  ask_attorney: boolean
  // select
  options: string[]
  // members_repeater
  memberFields: EditorField[]
  minItems: number
}

interface EditorSection {
  id: string
  title: string
  fields: EditorField[]
}

interface EditorDoc {
  id: string
  version: number
  title: string
  jurisdiction: string
  sections: EditorSection[]
}

// What the API/MCP returns/accepts (the FIXED schema contract). No `help` is ever
// written; no form `description` is ever written (WP2.4).
interface WireField {
  id: string
  label: string
  type: string
  required?: boolean
  allow_unknown?: boolean
  ask_attorney?: boolean
  options?: string[]
  memberFields?: WireField[]
  minItems?: number
}
interface WireSection {
  id: string
  title: string
  fields: WireField[]
}
interface WireDoc {
  id: string
  version: number
  title: string
  jurisdiction?: string
  sections: WireSection[]
}

function isFieldType(t: string): t is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(t)
}

// Slug from a human label, e.g. "Proposed LLC name" → "proposed_llc_name".
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

// Normalize a typed VARIABLE to a valid {{token}} without stripping a trailing
// "_" mid-word, so "company_" → "company_name" types cleanly.
function normToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .slice(0, 60)
}

// Reserve a unique id within `used`, falling back to a base and numeric suffix.
function uniqueId(preferred: string, fallback: string, used: Set<string>): string {
  const base = preferred || fallback || 'field'
  let id = base
  let n = 2
  while (used.has(id)) id = `${base}_${n++}`
  used.add(id)
  return id
}

function wireFieldToEditor(f: WireField): EditorField {
  return {
    id: f.id,
    label: f.label,
    // An unknown legacy type surfaces as Short text so the attorney can re-pick a
    // supported type before saving. Legacy `help` is intentionally dropped.
    type: isFieldType(f.type) ? f.type : 'text',
    required: f.required ?? false,
    allow_unknown: f.allow_unknown ?? false,
    ask_attorney: f.ask_attorney ?? false,
    options: Array.isArray(f.options) ? f.options : [],
    memberFields: Array.isArray(f.memberFields) ? f.memberFields.map(wireFieldToEditor) : [],
    minItems: typeof f.minItems === 'number' ? f.minItems : 1,
  }
}

function wireToEditor(doc: WireDoc): EditorDoc {
  return {
    id: doc.id,
    version: doc.version,
    title: doc.title ?? '',
    jurisdiction: doc.jurisdiction ?? '',
    sections: (doc.sections ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      fields: (s.fields ?? []).map(wireFieldToEditor),
    })),
  }
}

// Editor → wire. Assigns a stable id (existing kept, new slugged from the label)
// and carries only the humane-intake flags + type-specific extras. No help, no
// description.
function editorFieldToWire(f: EditorField, used: Set<string>): WireField {
  const out: WireField = {
    id: uniqueId(f.id.trim(), slugify(f.label), used),
    label: f.label.trim(),
    type: f.type,
  }
  if (f.required) out.required = true
  if (f.allow_unknown) out.allow_unknown = true
  if (f.ask_attorney) out.ask_attorney = true
  if (OPTION_FIELD_TYPES.has(f.type)) out.options = f.options.map((o) => o.trim()).filter(Boolean)
  if (f.type === 'members_repeater') {
    const memberUsed = new Set<string>()
    out.memberFields = f.memberFields.map((mf) => editorFieldToWire(mf, memberUsed))
    out.minItems = f.minItems
  }
  return out
}

function editorToWire(doc: EditorDoc): WireDoc {
  const fieldIds = new Set<string>()
  const sectionIds = new Set<string>()
  return {
    id: doc.id,
    version: doc.version,
    title: doc.title.trim(),
    ...(doc.jurisdiction.trim() ? { jurisdiction: doc.jurisdiction.trim() } : {}),
    sections: doc.sections.map((s) => ({
      id: uniqueId(s.id.trim(), slugify(s.title), sectionIds),
      title: s.title.trim(),
      fields: s.fields.map((f) => editorFieldToWire(f, fieldIds)),
    })),
  }
}

function emptyField(): EditorField {
  return {
    id: '',
    label: '',
    type: 'text',
    required: false,
    allow_unknown: false,
    ask_attorney: false,
    options: [],
    memberFields: [],
    minItems: 1,
  }
}

function emptySection(): EditorSection {
  return { id: '', title: '', fields: [emptyField()] }
}

// Move the item at `from` to `to`, returning a new array.
function moveTo<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr
  const copy = [...arr]
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}

// Select a reusable questionnaire from the firm library (#4b) to seed this
// service's form, or jump to the library builder. Applying loads the chosen
// schema into the editor (in memory) — the attorney reviews and Saves a version.
function StartFromLibrary({ onApply }: { onApply: (schema: WireDoc) => void }) {
  const [items, setItems] = useState<
    { questionnaireTemplateId: string; name: string; schema: WireDoc }[]
  >([])
  useEffect(() => {
    callAttorneyMcp<{
      questionnaires: { questionnaireTemplateId: string; name: string; schema: WireDoc }[]
    }>({ toolName: 'legal.questionnaire_template.list' })
      .then((r) => setItems(r.questionnaires))
      .catch(() => setItems([]))
  }, [])
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        flexWrap: 'wrap',
        margin: '0 0 var(--space-4)',
      }}
    >
      {items.length > 0 && (
        <select
          value=""
          aria-label="Start from a library questionnaire"
          onChange={(e) => {
            const it = items.find((i) => i.questionnaireTemplateId === e.target.value)
            e.target.value = ''
            if (
              it &&
              window.confirm(
                `Replace this service's questionnaire with "${it.name}" from the library? You can edit it before saving.`,
              )
            ) {
              onApply(it.schema)
            }
          }}
        >
          <option value="">Start from a library questionnaire…</option>
          {items.map((i) => (
            <option key={i.questionnaireTemplateId} value={i.questionnaireTemplateId}>
              {i.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

export default function QuestionnaireEditorPage() {
  const params = useParams<{ serviceKey: string }>()
  const serviceKey = params.serviceKey

  const [doc, setDoc] = useState<EditorDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  // A transient confirmation distinct from the questionnaire "Saved a new version"
  // banner (e.g. "Saved to the question library").
  const [notice, setNotice] = useState<string | null>(null)
  // Drag-to-reorder context: which section, and (for a field) which field index.
  const [drag, setDrag] = useState<{ si: number; fi: number | null } | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await callAttorneyMcp<{ questionnaire: WireDoc | null }>({
        toolName: 'legal.service.questionnaire.get',
        input: { serviceKey },
      })
      if (!r.questionnaire) {
        setDoc({
          id: serviceKey,
          version: 1,
          title: '',
          jurisdiction: '',
          sections: [emptySection()],
        })
        return
      }
      setDoc(wireToEditor(r.questionnaire))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [serviceKey])

  useEffect(() => {
    load()
  }, [load])

  function patch(mut: (d: EditorDoc) => EditorDoc) {
    setDoc((d) => (d ? mut(d) : d))
    setSaved(false)
  }
  function patchSection(si: number, mut: (s: EditorSection) => EditorSection) {
    patch((d) => ({ ...d, sections: d.sections.map((s, i) => (i === si ? mut(s) : s)) }))
  }
  function patchField(si: number, fi: number, mut: (f: EditorField) => EditorField) {
    patchSection(si, (s) => ({ ...s, fields: s.fields.map((f, i) => (i === fi ? mut(f) : f)) }))
  }

  async function save() {
    if (!doc) return
    setBusy(true)
    setError(null)
    try {
      const wire = editorToWire(doc)
      await callAttorneyMcp({
        toolName: 'legal.service.questionnaire.update',
        input: { serviceKey, intakeSchema: wire },
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Promote a single question into the firm QUESTION library (migration 0077) so
  // it can be reused in any questionnaire, carrying its stable {{answer}} token.
  async function saveQuestionToLibrary(field: EditorField) {
    if (!field.label.trim()) {
      setError('Give the question a label before saving it to the library.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // The library entry is a COPY: the questionnaire field keeps its own id, so
      // a template already bound to {{field_id}} is never silently re-pointed even
      // if the library de-duplicates the token (e.g. company_name → company_name_2).
      await callAttorneyMcp({
        toolName: 'legal.question_template.create',
        input: {
          label: field.label.trim(),
          type: field.type,
          token: field.id || undefined,
          ...(OPTION_FIELD_TYPES.has(field.type)
            ? { options: field.options.map((o) => o.trim()).filter(Boolean) }
            : {}),
        },
      })
      setNotice(`“${field.label.trim()}” saved to the question library.`)
      setTimeout(() => setNotice(null), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Promote the current in-editor form into the firm questionnaire library so it
  // can seed other services (a copy outward — this service is untouched).
  async function saveToLibrary() {
    if (!doc) return
    const name = window.prompt(
      'Save this questionnaire to the library as:',
      'Untitled questionnaire',
    )
    if (!name || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.questionnaire_template.create',
        input: { name: name.trim(), schema: editorToWire(doc) },
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          justifyContent: 'flex-end',
          marginBottom: 'var(--space-4)',
        }}
      >
        <button type="button" onClick={() => void saveToLibrary()} disabled={busy || !doc}>
          Save to library
        </button>
        <button className="primary" onClick={save} disabled={busy || !doc}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>

      <StartFromLibrary
        onApply={(schema) => {
          setDoc(wireToEditor(schema))
          setSaved(false)
        }}
      />

      {error && <div className="alert alert-error">{error}</div>}
      {saved && <div className="alert alert-success">Saved a new version.</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {!doc ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : (
        <div className="qb-builder">
          <div className="qb-card">
            <div className="form-grid">
              <label>
                <span>Form title</span>
                <input
                  value={doc.title}
                  onChange={(e) => patch((d) => ({ ...d, title: e.target.value }))}
                  placeholder="e.g. NC LLC operating agreement intake"
                />
              </label>
              <label>
                <span>Jurisdiction</span>
                <input
                  value={doc.jurisdiction}
                  onChange={(e) => patch((d) => ({ ...d, jurisdiction: e.target.value }))}
                  placeholder="e.g. NC"
                />
              </label>
            </div>
          </div>

          {doc.sections.map((section, si) => (
            <section
              key={si}
              className="qb-card qb-section-card"
              onDragOver={(e) => {
                if (drag && drag.fi === null) e.preventDefault()
              }}
              onDrop={() => {
                if (drag && drag.fi === null && drag.si !== si) {
                  patch((d) => ({ ...d, sections: moveTo(d.sections, drag.si, si) }))
                }
                setDrag(null)
              }}
            >
              <div className="qb-card-head">
                <span
                  className="qb-grip"
                  draggable
                  onDragStart={() => setDrag({ si, fi: null })}
                  onDragEnd={() => setDrag(null)}
                  title="Drag to reorder section"
                  aria-hidden
                >
                  ⠿
                </span>
                <span className="qb-num">Section {si + 1}</span>
                <input
                  className="qb-title-input"
                  value={section.title}
                  onChange={(e) => patchSection(si, (s) => ({ ...s, title: e.target.value }))}
                  placeholder="Section title — e.g. About the company"
                  aria-label={`Section ${si + 1} title`}
                />
                <span className="qb-actions">
                  <button
                    className="qb-iconbtn"
                    onClick={() =>
                      patch((d) => ({ ...d, sections: moveTo(d.sections, si, si - 1) }))
                    }
                    disabled={si === 0}
                    title="Move section up"
                    aria-label="Move section up"
                  >
                    ↑
                  </button>
                  <button
                    className="qb-iconbtn"
                    onClick={() =>
                      patch((d) => ({ ...d, sections: moveTo(d.sections, si, si + 1) }))
                    }
                    disabled={si === doc.sections.length - 1}
                    title="Move section down"
                    aria-label="Move section down"
                  >
                    ↓
                  </button>
                  <button
                    className="qb-iconbtn qb-danger"
                    onClick={() =>
                      patch((d) => ({ ...d, sections: d.sections.filter((_, i) => i !== si) }))
                    }
                    title="Remove section"
                    aria-label="Remove section"
                  >
                    <XIcon size={15} />
                  </button>
                </span>
              </div>

              {section.fields.map((field, fi) => (
                <FieldEditor
                  key={fi}
                  field={field}
                  index={fi}
                  count={section.fields.length}
                  draggable
                  onDragStart={() => setDrag({ si, fi })}
                  onDragEnd={() => setDrag(null)}
                  onDropField={() => {
                    if (drag && drag.fi !== null && drag.si === si && drag.fi !== fi) {
                      patchSection(si, (s) => ({
                        ...s,
                        fields: moveTo(s.fields, drag.fi as number, fi),
                      }))
                    }
                    setDrag(null)
                  }}
                  dragActive={!!drag && drag.fi !== null && drag.si === si}
                  onChange={(mut) => patchField(si, fi, mut)}
                  onMove={(delta) =>
                    patchSection(si, (s) => ({ ...s, fields: moveTo(s.fields, fi, fi + delta) }))
                  }
                  onRemove={() =>
                    patchSection(si, (s) => ({ ...s, fields: s.fields.filter((_, i) => i !== fi) }))
                  }
                  onSaveToLibrary={() => void saveQuestionToLibrary(field)}
                  saveBusy={busy}
                />
              ))}

              <div className="qb-add-row">
                <button
                  className="qb-add qb-add-q"
                  onClick={() =>
                    patchSection(si, (s) => ({ ...s, fields: [...s.fields, emptyField()] }))
                  }
                >
                  <PlusIcon size={16} />
                  Add question
                </button>
                <AddFromLibrary
                  onPick={(q) =>
                    patchSection(si, (s) => ({
                      ...s,
                      fields: [...s.fields, libQuestionToField(q)],
                    }))
                  }
                />
              </div>
            </section>
          ))}

          <button
            className="qb-add"
            onClick={() => patch((d) => ({ ...d, sections: [...d.sections, emptySection()] }))}
          >
            <PlusIcon size={16} />
            Add section
          </button>
        </div>
      )}
    </>
  )
}

// One library question (migration 0077). The token is the stable {{answer}} key.
interface LibQuestion {
  questionTemplateId: string
  label: string
  type: string
  token: string
  options: string[] | null
}

// A library question → an editor field. The token becomes the field id (preserved
// by editorToWire), so a template merge-field bound to {{token}} fills from it.
function libQuestionToField(q: LibQuestion): EditorField {
  return {
    id: q.token,
    label: q.label,
    type: isFieldType(q.type) ? q.type : 'text',
    required: false,
    allow_unknown: false,
    ask_attorney: false,
    options: Array.isArray(q.options) ? q.options : [],
    memberFields: [],
    minItems: 1,
  }
}

// "Add from library" — a searchable picker of reusable questions. Adding one drops
// it into the section carrying its stable {{answer}} token, so the same question
// reused across questionnaires binds templates once and fills everywhere.
function AddFromLibrary({ onPick }: { onPick: (q: LibQuestion) => void }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<LibQuestion[]>([])
  const [q, setQ] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!open || loaded) return
    callAttorneyMcp<{ questions: LibQuestion[] }>({ toolName: 'legal.question_template.list' })
      .then((r) => setItems(r.questions))
      .catch(() => setItems([]))
      .finally(() => setLoaded(true))
  }, [open, loaded])

  const needle = q.trim().toLowerCase()
  const filtered = needle
    ? items.filter(
        (i) => i.label.toLowerCase().includes(needle) || i.token.toLowerCase().includes(needle),
      )
    : items

  return (
    <div className="qlib-picker">
      <button className="qb-add qb-add-lib" type="button" onClick={() => setOpen((o) => !o)}>
        <LayersIcon size={16} />
        Add from library
      </button>
      {open && (
        <div className="qlib-pop" role="dialog" aria-label="Question library">
          <div className="qlib-search">
            <SearchIcon size={15} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the question library…"
            />
          </div>
          <div className="qlib-list">
            {!loaded && <div className="qlib-empty">Loading…</div>}
            {loaded && filtered.length === 0 && (
              <div className="qlib-empty">
                {items.length === 0
                  ? 'No saved questions yet. Save a question to the library from its ⧉ icon.'
                  : 'No matches.'}
              </div>
            )}
            {filtered.map((it) => (
              <button
                key={it.questionTemplateId}
                type="button"
                className="qlib-item"
                onClick={() => {
                  onPick(it)
                  setOpen(false)
                  setQ('')
                }}
              >
                <span className="qlib-item-label">{it.label}</span>
                <span className="qlib-item-meta">
                  {FIELD_TYPE_LABELS[(isFieldType(it.type) ? it.type : 'text') as FieldType]} ·{' '}
                  {`{{${it.token}}}`}
                </span>
              </button>
            ))}
          </div>
          <Link href="/attorney/questions" className="qlib-manage">
            Manage question library →
          </Link>
        </div>
      )}
    </div>
  )
}

function OptionPills({
  options,
  onChange,
}: {
  options: string[]
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (!v || options.includes(v)) return setDraft('')
    onChange([...options, v])
    setDraft('')
  }
  return (
    <div>
      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Choices</span>
      <div className="qb-pills">
        {options.map((opt, i) => (
          <span key={i} className="qb-pill">
            {opt}
            <button
              type="button"
              title="Remove choice"
              onClick={() => onChange(options.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </span>
        ))}
        {options.length === 0 && (
          <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>No choices yet</span>
        )}
      </div>
      <div className="qb-pill-add">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="Add a choice and press Enter"
        />
        <button type="button" onClick={add}>
          Add
        </button>
      </div>
    </div>
  )
}

function FieldEditor({
  field,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  draggable,
  onDragStart,
  onDragEnd,
  onDropField,
  dragActive,
  onSaveToLibrary,
  saveBusy,
}: {
  field: EditorField
  index: number
  count: number
  onChange: (mut: (f: EditorField) => EditorField) => void
  onMove: (delta: number) => void
  onRemove: () => void
  draggable?: boolean
  onDragStart?: () => void
  onDragEnd?: () => void
  onDropField?: () => void
  dragActive?: boolean
  // Top-level fields only: promote this question into the firm question library.
  onSaveToLibrary?: () => void
  saveBusy?: boolean
}) {
  return (
    <fieldset
      className="qb-q"
      onDragOver={(e) => {
        if (dragActive) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      onDrop={(e) => {
        if (onDropField) {
          e.stopPropagation()
          onDropField()
        }
      }}
    >
      <legend className="qb-q-head">
        {draggable && (
          <span
            className="qb-grip"
            draggable
            onDragStart={(e) => {
              e.stopPropagation()
              onDragStart?.()
            }}
            onDragEnd={() => onDragEnd?.()}
            title="Drag to reorder question"
            aria-hidden
          >
            ⠿
          </span>
        )}
        <span className="qb-q-num">Question {index + 1}</span>
        <span className="qb-actions">
          {onSaveToLibrary && (
            <button
              className="qb-iconbtn"
              onClick={onSaveToLibrary}
              disabled={saveBusy}
              title="Save this question to the library"
              aria-label="Save this question to the library"
            >
              <CopyIcon size={14} />
            </button>
          )}
          <button
            className="qb-iconbtn"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title="Move question up"
            aria-label="Move question up"
          >
            ↑
          </button>
          <button
            className="qb-iconbtn"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            title="Move question down"
            aria-label="Move question down"
          >
            ↓
          </button>
          <button
            className="qb-iconbtn qb-danger"
            onClick={onRemove}
            title="Remove question"
            aria-label="Remove question"
          >
            <XIcon size={15} />
          </button>
        </span>
      </legend>
      <div className="form-grid">
        <label>
          <span>Question</span>
          <input
            value={field.label}
            onChange={(e) => onChange((f) => ({ ...f, label: e.target.value }))}
            placeholder="e.g. Proposed LLC name"
          />
        </label>
        <label>
          <span>
            Variable{' '}
            <span className="text-muted" style={{ fontWeight: 400 }}>
              — the <code>{'{{token}}'}</code> this fills in the template
            </span>
          </span>
          <input
            value={field.id}
            onChange={(e) => onChange((f) => ({ ...f, id: normToken(e.target.value) }))}
            placeholder={slugify(field.label) || 'variable'}
            spellCheck={false}
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
          />
        </label>
        <label>
          <span>Answer type</span>
          <select
            value={field.type}
            onChange={(e) => onChange((f) => ({ ...f, type: e.target.value as FieldType }))}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {FIELD_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="qb-switches">
        <label className="qb-switch">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onChange((f) => ({ ...f, required: e.target.checked }))}
          />
          <span>Required</span>
        </label>
        <label className="qb-switch">
          <input
            type="checkbox"
            checked={field.allow_unknown}
            onChange={(e) => onChange((f) => ({ ...f, allow_unknown: e.target.checked }))}
          />
          <span>Allow “I don’t know”</span>
        </label>
        <label className="qb-switch">
          <input
            type="checkbox"
            checked={field.ask_attorney}
            onChange={(e) => onChange((f) => ({ ...f, ask_attorney: e.target.checked }))}
          />
          <span>Flag for attorney follow-up</span>
        </label>
      </div>

      {OPTION_FIELD_TYPES.has(field.type) && (
        <OptionPills
          options={field.options}
          onChange={(next) => onChange((f) => ({ ...f, options: next }))}
        />
      )}

      {field.type === 'members_repeater' && (
        <div className="qb-sub">
          <label className="qb-minitems">
            <span>Minimum members</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={field.minItems}
              onChange={(e) => onChange((f) => ({ ...f, minItems: Number(e.target.value) || 0 }))}
            />
          </label>
          <div className="qb-sub-title">
            <UsersIcon size={15} />
            Per-member questions
          </div>
          {field.memberFields.map((mf, mi) => (
            <FieldEditor
              key={mi}
              field={mf}
              index={mi}
              count={field.memberFields.length}
              onChange={(mut) =>
                onChange((f) => ({
                  ...f,
                  memberFields: f.memberFields.map((x, i) => (i === mi ? mut(x) : x)),
                }))
              }
              onMove={(delta) =>
                onChange((f) => ({ ...f, memberFields: moveTo(f.memberFields, mi, mi + delta) }))
              }
              onRemove={() =>
                onChange((f) => ({
                  ...f,
                  memberFields: f.memberFields.filter((_, i) => i !== mi),
                }))
              }
            />
          ))}
          <button
            className="qb-add qb-add-q"
            onClick={() =>
              onChange((f) => ({ ...f, memberFields: [...f.memberFields, emptyField()] }))
            }
          >
            <PlusIcon size={16} />
            Add per-member question
          </button>
        </div>
      )}
    </fieldset>
  )
}
