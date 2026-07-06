'use client'

// Questionnaire library (#4b) — the firm's reusable, NOT-service-bound intake
// forms. Build a questionnaire once (sections + fields) and attach it to any
// service from the service builder. CRUD via the through-core
// legal.questionnaire_template.* tools (backed by migration 0067).

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { formatDate } from '@/lib/datetime'
import { PageHead } from '@/components/PageHead'
import { LayersIcon, SearchIcon } from '@/components/icons'

type FieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'yes_no'
  | 'true_false'
  | 'checkbox'
  | 'date'
  | 'number'
  | 'address_autocomplete'

// Keep in lockstep with the service questionnaire editor's KNOWN_FIELD_TYPES so a
// library questionnaire renders identically once attached to a service.
const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Dropdown' },
  { value: 'yes_no', label: 'Yes / No' },
  { value: 'true_false', label: 'True / False' },
  { value: 'checkbox', label: 'Checkboxes (select many)' },
  { value: 'date', label: 'Date' },
  { value: 'number', label: 'Number' },
  { value: 'address_autocomplete', label: 'Address' },
]

// Answer types that carry a choice list.
const OPTION_TYPES = new Set<FieldType>(['select', 'checkbox'])

interface SchemaField {
  id: string
  label?: string
  type?: string
  required?: boolean
  options?: string[]
}
interface SchemaSection {
  id?: string
  title?: string
  fields?: SchemaField[]
}
interface AssocTemplate {
  templateEntityId: string
  name: string | null
}
interface QuestionnaireTemplate {
  questionnaireTemplateId: string
  name: string
  description: string | null
  fieldCount: number
  updatedAt: string
  schema: { id?: string; title?: string; sections?: SchemaSection[] }
  associatedTemplates?: AssocTemplate[]
}

// Builder-side shapes (options edited as one-per-line text).
interface BField {
  label: string
  type: FieldType
  required: boolean
  options: string
  // Stable {{answer}} token, kept when the field came from the question library
  // so it binds templates identically everywhere. Absent for hand-authored
  // fields — their id is slugged from the label on save.
  token?: string
}
interface BSection {
  title: string
  fields: BField[]
}
interface Draft {
  id: string | null // null = new
  name: string
  description: string
  sections: BSection[]
  // Template entity ids this questionnaire feeds (migration 0109).
  associatedTemplateIds: string[]
}

function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

// Normalize a typed VARIABLE to a valid {{token}} without fighting the user
// mid-word (keeps a trailing "_" so "company_" → "company_name" types cleanly).
function normToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .slice(0, 60)
}

const NEW_FIELD = (): BField => ({ label: '', type: 'text', required: true, options: '' })
const NEW_SECTION = (): BSection => ({ title: '', fields: [NEW_FIELD()] })
const EMPTY_DRAFT = (): Draft => ({
  id: null,
  name: '',
  description: '',
  sections: [{ title: 'Details', fields: [NEW_FIELD()] }],
  associatedTemplateIds: [],
})

// A reusable question from the firm's library (legal.question_template.list).
interface LibQuestion {
  questionTemplateId: string
  label: string
  type: string
  token: string
  options: string[] | null
}

// Map a picked library question into a builder field, keeping its stable
// {{answer}} token so the same question binds templates identically everywhere.
function fieldFromLib(q: LibQuestion): BField {
  return {
    label: q.label,
    type: (FIELD_TYPES.some((ft) => ft.value === q.type) ? q.type : 'text') as FieldType,
    required: true,
    options: (q.options ?? []).join('\n'),
    token: q.token || undefined,
  }
}

// "Add from library" — a searchable picker of the firm's reusable questions
// (mirrors the one in the service questionnaire editor). Picking one inserts it
// into the section carrying its {{answer}} token, so a question reused across
// questionnaires binds a template once and fills everywhere.
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
                  ? 'No saved questions yet. Save one from the question library.'
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
                  {FIELD_TYPES.find((ft) => ft.value === it.type)?.label ?? 'Short text'} ·{' '}
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

export default function QuestionnaireLibraryPage() {
  const [items, setItems] = useState<QuestionnaireTemplate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  // The firm's document templates, for the "Associated templates" picker.
  const [templates, setTemplates] = useState<{ templateEntityId: string; name: string }[]>([])

  function load() {
    setError(null)
    callAttorneyMcp<{ questionnaires: QuestionnaireTemplate[] }>({
      toolName: 'legal.questionnaire_template.list',
    })
      .then((r) => setItems(r.questionnaires))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }
  useEffect(load, [])

  useEffect(() => {
    callAttorneyMcp<{ templates: { templateEntityId: string; name: string; category: string }[] }>({
      toolName: 'legal.template.list',
    })
      .then((r) => setTemplates(r.templates.filter((t) => t.category === 'document')))
      .catch(() => setTemplates([]))
  }, [])

  function editFrom(t: QuestionnaireTemplate) {
    setDraft({
      id: t.questionnaireTemplateId,
      name: t.name,
      description: t.description ?? '',
      sections: (t.schema.sections ?? []).map((s) => ({
        title: s.title ?? '',
        fields: (s.fields ?? []).map((f) => ({
          label: f.label ?? f.id,
          type: (FIELD_TYPES.some((ft) => ft.value === f.type) ? f.type : 'text') as FieldType,
          required: f.required ?? false,
          options: (f.options ?? []).join('\n'),
          // Preserve the existing field id so re-saving keeps stable ids (and the
          // {{answer}} binding of any library-sourced question) instead of
          // re-slugging from the label.
          token: f.id,
        })),
      })),
      associatedTemplateIds: (t.associatedTemplates ?? []).map((a) => a.templateEntityId),
    })
  }

  function buildSchema(d: Draft) {
    return {
      id: d.id ? slug(d.name) || 'questionnaire' : slug(d.name) || 'questionnaire',
      version: 1,
      title: d.name.trim(),
      sections: d.sections.map((s, i) => ({
        id: slug(s.title) || `section_${i + 1}`,
        title: s.title.trim() || `Section ${i + 1}`,
        fields: s.fields
          .filter((f) => f.label.trim())
          .map((f) => ({
            id: f.token?.trim() || slug(f.label),
            label: f.label.trim(),
            type: f.type,
            required: f.required,
            ...(OPTION_TYPES.has(f.type)
              ? {
                  options: f.options
                    .split('\n')
                    .map((o) => o.trim())
                    .filter(Boolean),
                }
              : {}),
          })),
      })),
    }
  }

  async function save() {
    if (!draft) return
    if (!draft.name.trim()) {
      setError('Give the questionnaire a name.')
      return
    }
    const schema = buildSchema(draft)
    const totalFields = schema.sections.reduce((n, s) => n + s.fields.length, 0)
    if (totalFields === 0) {
      setError('Add at least one field with a label.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      let qtId = draft.id
      if (draft.id) {
        await callAttorneyMcp({
          toolName: 'legal.questionnaire_template.update',
          input: {
            questionnaireTemplateId: draft.id,
            name: draft.name.trim(),
            description: draft.description.trim() || null,
            schema,
          },
        })
      } else {
        const r = await callAttorneyMcp<{ questionnaire: { questionnaireTemplateId: string } }>({
          toolName: 'legal.questionnaire_template.create',
          input: { name: draft.name.trim(), description: draft.description.trim() || null, schema },
        })
        qtId = r.questionnaire.questionnaireTemplateId
      }
      // Persist the questionnaire → document-template association (migration 0109),
      // once the questionnaire entity exists. Sends the full desired set.
      if (qtId) {
        await callAttorneyMcp({
          toolName: 'legal.questionnaire_template.set_templates',
          input: { questionnaireTemplateId: qtId, templateEntityIds: draft.associatedTemplateIds },
        })
      }
      setDraft(null)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function archive(t: QuestionnaireTemplate) {
    if (!window.confirm(`Archive "${t.name}"? It leaves the active library (kept as history).`))
      return
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.questionnaire_template.archive',
        input: { questionnaireTemplateId: t.questionnaireTemplateId },
      })
      if (draft?.id === t.questionnaireTemplateId) setDraft(null)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // ── builder mutators ──
  function patchSection(si: number, patch: Partial<BSection>) {
    setDraft((d) =>
      d ? { ...d, sections: d.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)) } : d,
    )
  }
  function patchField(si: number, fi: number, patch: Partial<BField>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            sections: d.sections.map((s, i) =>
              i === si
                ? { ...s, fields: s.fields.map((f, j) => (j === fi ? { ...f, ...patch } : f)) }
                : s,
            ),
          }
        : d,
    )
  }

  return (
    <main>
      <PageHead
        title="Questionnaires"
        description="Reusable intake forms for the whole firm. Build one here, then attach it to any service from the service builder."
        actions={
          !draft ? (
            <button className="primary" onClick={() => setDraft(EMPTY_DRAFT())}>
              New questionnaire
            </button>
          ) : undefined
        }
      />
      <p className="text-muted">
        Manage the reusable single questions in the{' '}
        <a href="/attorney/questions">question library →</a>
      </p>

      {error && <div className="alert alert-error">{error}</div>}

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
            <h2>{draft.id ? 'Edit questionnaire' : 'New questionnaire'}</h2>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
              <button className="primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create questionnaire'}
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
              marginBottom: 'var(--space-4)',
            }}
          >
            <label style={{ flex: '1 1 18rem' }}>
              <span className="field-label">Name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. NC LLC intake"
              />
            </label>
            <label style={{ flex: '2 1 22rem' }}>
              <span className="field-label">Description (optional)</span>
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="What this questionnaire collects"
              />
            </label>
          </div>

          <fieldset className="svc-fieldset" style={{ marginBottom: 'var(--space-4)' }}>
            <legend>Associated document templates</legend>
            <p className="text-muted" style={{ fontSize: '0.82rem', margin: '-0.2rem 0 0.6rem' }}>
              The document template(s) this questionnaire feeds. When a client submits it, the
              answers fill the linked template(s) — and the pairing shows on both sides.
            </p>
            {templates.length === 0 ? (
              <p className="text-muted" style={{ fontSize: '0.82rem', margin: 0 }}>
                No document templates yet — create one in{' '}
                <a href="/attorney/templates">Templates</a>.
              </p>
            ) : (
              <div
                style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2) var(--space-5)' }}
              >
                {templates.map((t) => {
                  const on = draft.associatedTemplateIds.includes(t.templateEntityId)
                  return (
                    <label
                      key={t.templateEntityId}
                      className="svc-check"
                      style={{ flex: '0 0 auto' }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            associatedTemplateIds: e.target.checked
                              ? [...draft.associatedTemplateIds, t.templateEntityId]
                              : draft.associatedTemplateIds.filter(
                                  (id) => id !== t.templateEntityId,
                                ),
                          })
                        }
                      />
                      <span>{t.name}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </fieldset>

          <p className="text-muted" style={{ fontSize: '0.82rem', margin: '-0.3rem 0 0.9rem' }}>
            Each question’s <strong>variable</strong> is the <code>{'{{token}}'}</code> its answer
            fills in the bound document template — set it to tie a question to a template field.
            Leave it blank to default to the question label.
          </p>

          {draft.sections.map((section, si) => (
            <fieldset key={si} className="svc-fieldset qb-section">
              <legend>
                <input
                  className="qb-section-title"
                  value={section.title}
                  onChange={(e) => patchSection(si, { title: e.target.value })}
                  placeholder={`Section ${si + 1} title`}
                />
                {draft.sections.length > 1 && (
                  <button
                    type="button"
                    className="qb-remove"
                    title="Remove section"
                    onClick={() =>
                      setDraft({ ...draft, sections: draft.sections.filter((_, i) => i !== si) })
                    }
                  >
                    Remove section
                  </button>
                )}
              </legend>

              {section.fields.map((field, fi) => (
                <div key={fi} className="qb-field-row">
                  <input
                    className="qb-field-label"
                    value={field.label}
                    onChange={(e) => patchField(si, fi, { label: e.target.value })}
                    placeholder="Question label"
                  />
                  <span
                    className="qb-var"
                    title="The variable this answer fills in the document template. Leave blank to use the question label."
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 1,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: '0.8rem',
                      color: 'var(--muted)',
                    }}
                  >
                    {'{{'}
                    <input
                      value={field.token ?? ''}
                      onChange={(e) => patchField(si, fi, { token: normToken(e.target.value) })}
                      placeholder={slug(field.label) || 'variable'}
                      spellCheck={false}
                      aria-label="Variable name"
                      style={{
                        width: '7.5rem',
                        fontFamily: 'inherit',
                        fontSize: 'inherit',
                        padding: 'var(--space-1)',
                      }}
                    />
                    {'}}'}
                  </span>
                  <select
                    value={field.type}
                    onChange={(e) => patchField(si, fi, { type: e.target.value as FieldType })}
                    aria-label="Field type"
                  >
                    {FIELD_TYPES.map((ft) => (
                      <option key={ft.value} value={ft.value}>
                        {ft.label}
                      </option>
                    ))}
                  </select>
                  <label className="qb-req">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => patchField(si, fi, { required: e.target.checked })}
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    className="qb-remove"
                    title="Remove field"
                    onClick={() =>
                      patchSection(si, { fields: section.fields.filter((_, j) => j !== fi) })
                    }
                  >
                    ×
                  </button>
                  {OPTION_TYPES.has(field.type) && (
                    <textarea
                      className="qb-options"
                      value={field.options}
                      onChange={(e) => patchField(si, fi, { options: e.target.value })}
                      rows={2}
                      placeholder="One option per line"
                    />
                  )}
                </div>
              ))}

              <div
                style={{
                  display: 'flex',
                  gap: 'var(--space-2)',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  marginTop: 'var(--space-2)',
                }}
              >
                <button
                  type="button"
                  onClick={() => patchSection(si, { fields: [...section.fields, NEW_FIELD()] })}
                >
                  + Add field
                </button>
                <AddFromLibrary
                  onPick={(lib) =>
                    patchSection(si, { fields: [...section.fields, fieldFromLib(lib)] })
                  }
                />
              </div>
            </fieldset>
          ))}

          <button
            type="button"
            onClick={() => setDraft({ ...draft, sections: [...draft.sections, NEW_SECTION()] })}
          >
            + Add section
          </button>
        </section>
      )}

      {items === null && !error && (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      )}
      {items && items.length === 0 && !draft && (
        <section>
          <p>No questionnaires yet. Build your first reusable intake form.</p>
        </section>
      )}
      {items && items.length > 0 && (
        <section>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th style={{ textAlign: 'right' }}>Fields</th>
                  <th>Feeds</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.questionnaireTemplateId}>
                    <td>
                      <strong>{t.name || '(untitled)'}</strong>
                    </td>
                    <td className="text-muted">{t.description ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{t.fieldCount}</td>
                    <td className="text-muted">
                      {(t.associatedTemplates ?? []).length > 0
                        ? (t.associatedTemplates ?? []).map((a) => a.name || 'untitled').join(', ')
                        : '—'}
                    </td>
                    <td>{formatDate(t.updatedAt)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => editFrom(t)}>Edit</button>{' '}
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
