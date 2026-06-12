'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

// The exact field types the public booking page (apps/legal-demo/app/book)
// renders. Keep in lockstep with KNOWN_FIELD_TYPES in the legal API — anything
// else is rejected on save.
const FIELD_TYPES = [
  'text',
  'textarea',
  'select',
  'date',
  'number',
  'address_autocomplete',
  'members_repeater',
] as const
type FieldType = (typeof FIELD_TYPES)[number]

interface EditorField {
  id: string
  label: string
  type: FieldType
  required: boolean
  help: string
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
  description: string
  jurisdiction: string
  sections: EditorSection[]
}

// What the API/MCP returns/accepts (the FIXED schema contract).
interface WireField {
  id: string
  label: string
  type: string
  required?: boolean
  help?: string
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
  description?: string
  jurisdiction?: string
  sections: WireSection[]
}

function isFieldType(t: string): t is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(t)
}

function wireFieldToEditor(f: WireField): EditorField {
  return {
    id: f.id,
    label: f.label,
    // An unknown legacy type (e.g. a repo "repeater" or "boolean") surfaces as
    // text so the attorney can re-pick a supported type before saving.
    type: isFieldType(f.type) ? f.type : 'text',
    required: f.required ?? false,
    help: f.help ?? '',
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
    description: doc.description ?? '',
    jurisdiction: doc.jurisdiction ?? '',
    sections: (doc.sections ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      fields: (s.fields ?? []).map(wireFieldToEditor),
    })),
  }
}

// Editor → wire. Drops empty optional values so the saved schema stays clean, and
// only carries options for select / memberFields+minItems for members_repeater.
function editorFieldToWire(f: EditorField): WireField {
  const out: WireField = { id: f.id.trim(), label: f.label.trim(), type: f.type }
  if (f.required) out.required = true
  if (f.help.trim()) out.help = f.help.trim()
  if (f.type === 'select') out.options = f.options.map((o) => o.trim()).filter(Boolean)
  if (f.type === 'members_repeater') {
    out.memberFields = f.memberFields.map(editorFieldToWire)
    out.minItems = f.minItems
  }
  return out
}

function editorToWire(doc: EditorDoc): WireDoc {
  return {
    id: doc.id,
    version: doc.version,
    title: doc.title.trim(),
    ...(doc.description.trim() ? { description: doc.description.trim() } : {}),
    ...(doc.jurisdiction.trim() ? { jurisdiction: doc.jurisdiction.trim() } : {}),
    sections: doc.sections.map((s) => ({
      id: s.id.trim(),
      title: s.title.trim(),
      fields: s.fields.map(editorFieldToWire),
    })),
  }
}

function emptyField(): EditorField {
  return {
    id: '',
    label: '',
    type: 'text',
    required: false,
    help: '',
    options: [],
    memberFields: [],
    minItems: 1,
  }
}

function emptySection(): EditorSection {
  return { id: '', title: '', fields: [emptyField()] }
}

// Move item at idx by delta within an array, returning a new array.
function move<T>(arr: T[], idx: number, delta: number): T[] {
  const next = idx + delta
  if (next < 0 || next >= arr.length) return arr
  const copy = [...arr]
  const [item] = copy.splice(idx, 1)
  copy.splice(next, 0, item)
  return copy
}

export default function QuestionnaireEditorPage() {
  const params = useParams<{ serviceKey: string }>()
  const serviceKey = params.serviceKey

  const [doc, setDoc] = useState<EditorDoc | null>(null)
  const [empty, setEmpty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await callAttorneyMcp<{ questionnaire: WireDoc | null }>({
        toolName: 'legal.service.questionnaire.get',
        input: { serviceKey },
      })
      if (!r.questionnaire) {
        // No form bound yet — start from a blank one section.
        setEmpty(true)
        setDoc({
          id: serviceKey,
          version: 1,
          title: '',
          description: '',
          jurisdiction: '',
          sections: [emptySection()],
        })
        return
      }
      setEmpty(false)
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

  return (
    <main>
      <div
        className="attorney-page-head"
        style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}
      >
        <h1 style={{ margin: 0 }}>Edit questionnaire</h1>
        <Link
          href={`/attorney/services/${serviceKey}`}
          className="back-link"
          style={{ marginLeft: 'auto' }}
        >
          Back to service
        </Link>
        <button className="primary" onClick={save} disabled={busy || !doc}>
          {busy ? 'Saving…' : 'Save new version'}
        </button>
      </div>

      <p style={{ color: 'var(--muted)', marginTop: '-0.4rem' }}>
        The intake form clients fill out when booking <code>{serviceKey}</code>. Saving creates a
        new immutable version; the booking page picks it up immediately.
        {empty && ' No saved form yet — this starts from the bound default.'}
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {saved && (
        <div
          className="alert"
          style={{ background: 'var(--ok-soft)', color: '#166534', border: '1px solid #86efac' }}
        >
          Saved a new version.
        </div>
      )}

      {!doc ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : (
        <>
          <section>
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
            <label>
              <span>Form description (shown to the client)</span>
              <textarea
                value={doc.description}
                onChange={(e) => patch((d) => ({ ...d, description: e.target.value }))}
                rows={2}
              />
            </label>
          </section>

          {doc.sections.map((section, si) => (
            <section key={si} style={{ borderLeft: '3px solid var(--border)' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '0.6rem',
                }}
              >
                <strong>Section {si + 1}</strong>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.35rem' }}>
                  <button
                    onClick={() => patch((d) => ({ ...d, sections: move(d.sections, si, -1) }))}
                    disabled={si === 0}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => patch((d) => ({ ...d, sections: move(d.sections, si, 1) }))}
                    disabled={si === doc.sections.length - 1}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    className="danger outline"
                    onClick={() =>
                      patch((d) => ({ ...d, sections: d.sections.filter((_, i) => i !== si) }))
                    }
                  >
                    Remove section
                  </button>
                </span>
              </div>
              <div className="form-grid">
                <label>
                  <span>Section id</span>
                  <input
                    value={section.id}
                    onChange={(e) => patchSection(si, (s) => ({ ...s, id: e.target.value }))}
                    placeholder="e.g. company"
                  />
                </label>
                <label>
                  <span>Section title</span>
                  <input
                    value={section.title}
                    onChange={(e) => patchSection(si, (s) => ({ ...s, title: e.target.value }))}
                    placeholder="e.g. About the company"
                  />
                </label>
              </div>

              {section.fields.map((field, fi) => (
                <FieldEditor
                  key={fi}
                  field={field}
                  index={fi}
                  count={section.fields.length}
                  onChange={(mut) => patchField(si, fi, mut)}
                  onMove={(delta) =>
                    patchSection(si, (s) => ({ ...s, fields: move(s.fields, fi, delta) }))
                  }
                  onRemove={() =>
                    patchSection(si, (s) => ({ ...s, fields: s.fields.filter((_, i) => i !== fi) }))
                  }
                />
              ))}

              <button
                onClick={() =>
                  patchSection(si, (s) => ({ ...s, fields: [...s.fields, emptyField()] }))
                }
              >
                + Add field
              </button>
            </section>
          ))}

          <button
            onClick={() => patch((d) => ({ ...d, sections: [...d.sections, emptySection()] }))}
          >
            + Add section
          </button>
        </>
      )}
    </main>
  )
}

function FieldEditor({
  field,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  field: EditorField
  index: number
  count: number
  onChange: (mut: (f: EditorField) => EditorField) => void
  onMove: (delta: number) => void
  onRemove: () => void
}) {
  return (
    <fieldset className="member-row" style={{ marginTop: '0.6rem' }}>
      <legend>
        Field {index + 1}
        <span style={{ marginLeft: '0.6rem', display: 'inline-flex', gap: '0.3rem' }}>
          <button onClick={() => onMove(-1)} disabled={index === 0} title="Move up">
            ↑
          </button>
          <button onClick={() => onMove(1)} disabled={index === count - 1} title="Move down">
            ↓
          </button>
          <button className="danger outline" onClick={onRemove}>
            Remove
          </button>
        </span>
      </legend>
      <div className="form-grid">
        <label>
          <span>Field id</span>
          <input
            value={field.id}
            onChange={(e) => onChange((f) => ({ ...f, id: e.target.value }))}
            placeholder="e.g. company_name"
          />
        </label>
        <label>
          <span>Label</span>
          <input
            value={field.label}
            onChange={(e) => onChange((f) => ({ ...f, label: e.target.value }))}
            placeholder="e.g. Proposed LLC name"
          />
        </label>
        <label>
          <span>Type</span>
          <select
            value={field.type}
            onChange={(e) => onChange((f) => ({ ...f, type: e.target.value as FieldType }))}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="member-manager">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onChange((f) => ({ ...f, required: e.target.checked }))}
          />
          <span>Required</span>
        </label>
      </div>
      <label>
        <span>Help text (optional)</span>
        <input
          value={field.help}
          onChange={(e) => onChange((f) => ({ ...f, help: e.target.value }))}
        />
      </label>

      {field.type === 'select' && (
        <label>
          <span>Options (one per line)</span>
          <textarea
            value={field.options.join('\n')}
            onChange={(e) => onChange((f) => ({ ...f, options: e.target.value.split('\n') }))}
            rows={3}
            placeholder={'member_managed\nmanager_managed'}
          />
        </label>
      )}

      {field.type === 'members_repeater' && (
        <div style={{ marginTop: '0.5rem' }}>
          <label>
            <span>Minimum members</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={field.minItems}
              onChange={(e) => onChange((f) => ({ ...f, minItems: Number(e.target.value) || 0 }))}
            />
          </label>
          <div style={{ fontWeight: 600, margin: '0.5rem 0 0.3rem' }}>Member fields</div>
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
                onChange((f) => ({ ...f, memberFields: move(f.memberFields, mi, delta) }))
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
            onClick={() =>
              onChange((f) => ({ ...f, memberFields: [...f.memberFields, emptyField()] }))
            }
          >
            + Add member field
          </button>
        </div>
      )}
    </fieldset>
  )
}
