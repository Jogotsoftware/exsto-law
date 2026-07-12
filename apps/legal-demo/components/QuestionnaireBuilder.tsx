'use client'

// BUILDER-UX-1 WP-4 — the ONE questionnaire field-editing builder, extracted
// from app/attorney/questionnaires/page.tsx so the standalone page AND the
// wizard-proposal pop-up share a single editor (never two). It owns the
// SECTIONS editing (sections, fields, type, required, variable {{token}},
// choices, add/remove, add-from-library); name/description and the associated-
// templates picker stay host chrome. Controlled: it takes `sections` + emits
// `onChange`; the host owns persistence via the exported `sectionsToSchema`
// (create/update through the same core tools) and seeds from a persisted or
// proposed schema via `schemaToSections`.
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { LayersIcon, SearchIcon } from '@/components/icons'

export type FieldType =
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
export const FIELD_TYPES: { value: FieldType; label: string }[] = [
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
export const OPTION_TYPES = new Set<FieldType>(['select', 'checkbox'])

export interface SchemaField {
  // Optional so an in-memory wizard proposal (whose fields may not carry a
  // stable id yet) is assignable; schemaToSections falls back to the label.
  id?: string
  label?: string
  type?: string
  required?: boolean
  options?: string[]
}
export interface SchemaSection {
  id?: string
  title?: string
  fields?: SchemaField[]
}
export interface QuestionnaireSchema {
  id?: string
  version?: number
  title?: string
  sections?: SchemaSection[]
}

// Builder-side shapes (options edited as one-per-line text).
export interface BField {
  label: string
  type: FieldType
  required: boolean
  options: string
  // Stable {{answer}} token, kept when the field came from the question library
  // so it binds templates identically everywhere. Absent for hand-authored
  // fields — their id is slugged from the label on save.
  token?: string
}
export interface BSection {
  title: string
  fields: BField[]
}

export function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

// Normalize a typed VARIABLE to a valid {{token}} without fighting the user
// mid-word (keeps a trailing "_" so "company_" → "company_name" types cleanly).
export function normToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .slice(0, 60)
}

export const NEW_FIELD = (): BField => ({ label: '', type: 'text', required: true, options: '' })
export const NEW_SECTION = (): BSection => ({ title: '', fields: [NEW_FIELD()] })

// schema → builder sections (preserves each field id as its {{token}} so re-save
// keeps stable ids / library bindings instead of re-slugging from the label).
export function schemaToSections(schema: QuestionnaireSchema | null | undefined): BSection[] {
  return (schema?.sections ?? []).map((s) => ({
    title: s.title ?? '',
    fields: (s.fields ?? []).map((f) => ({
      label: f.label ?? f.id ?? '',
      type: (FIELD_TYPES.some((ft) => ft.value === f.type) ? f.type : 'text') as FieldType,
      required: f.required ?? false,
      options: (f.options ?? []).join('\n'),
      token: f.id,
    })),
  }))
}

// builder sections → schema (the shape the core create/update tools accept and
// the wizard proposal carries). Fields without a label are dropped.
export function sectionsToSchema(
  name: string,
  sections: BSection[],
): { id: string; version: number; title: string; sections: SchemaSection[] } {
  return {
    id: slug(name) || 'questionnaire',
    version: 1,
    title: name.trim(),
    sections: sections.map((s, i) => ({
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

export function schemaFieldCount(sections: BSection[]): number {
  return sections.reduce((n, s) => n + s.fields.filter((f) => f.label.trim()).length, 0)
}

// A reusable question from the firm's library (legal.question_template.list).
interface LibQuestion {
  questionTemplateId: string
  label: string
  type: string
  token: string
  options: string[] | null
}

function fieldFromLib(q: LibQuestion): BField {
  return {
    label: q.label,
    type: (FIELD_TYPES.some((ft) => ft.value === q.type) ? q.type : 'text') as FieldType,
    required: true,
    options: (q.options ?? []).join('\n'),
    token: q.token || undefined,
  }
}

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

// The controlled field-editing builder. `sections` in, `onChange` out; the host
// owns name/description/associated-templates and persistence.
export function QuestionnaireBuilder({
  sections,
  onChange,
}: {
  sections: BSection[]
  onChange: (next: BSection[]) => void
}): React.ReactElement {
  function patchSection(si: number, patch: Partial<BSection>) {
    onChange(sections.map((s, i) => (i === si ? { ...s, ...patch } : s)))
  }
  function patchField(si: number, fi: number, patch: Partial<BField>) {
    onChange(
      sections.map((s, i) =>
        i === si
          ? { ...s, fields: s.fields.map((f, j) => (j === fi ? { ...f, ...patch } : f)) }
          : s,
      ),
    )
  }

  return (
    <div className="qb-builder">
      <p className="text-muted" style={{ fontSize: '0.82rem', margin: '-0.3rem 0 0.9rem' }}>
        Each question’s <strong>variable</strong> is the <code>{'{{token}}'}</code> its answer fills
        in the bound document template — set it to tie a question to a template field. Leave it
        blank to default to the question label.
      </p>

      {sections.map((section, si) => (
        <fieldset key={si} className="svc-fieldset qb-section">
          <legend>
            <input
              className="qb-section-title"
              value={section.title}
              onChange={(e) => patchSection(si, { title: e.target.value })}
              placeholder={`Section ${si + 1} title`}
            />
            {sections.length > 1 && (
              <button
                type="button"
                className="qb-remove"
                title="Remove section"
                onClick={() => onChange(sections.filter((_, i) => i !== si))}
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
                aria-label="Remove field"
                onClick={() =>
                  patchSection(si, { fields: section.fields.filter((_, j) => j !== fi) })
                }
              >
                <X size={14} aria-hidden />
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
              onPick={(lib) => patchSection(si, { fields: [...section.fields, fieldFromLib(lib)] })}
            />
          </div>
        </fieldset>
      ))}

      <button type="button" onClick={() => onChange([...sections, NEW_SECTION()])}>
        + Add section
      </button>
    </div>
  )
}
