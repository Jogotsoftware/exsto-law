'use client'

// Question library (migration 0077) — the firm's reusable, single intake
// questions. Each carries a stable {{answer}} token reused across questionnaires,
// so a document template's {{insert}} binds once and fills everywhere. Managed
// here (rename / retype / re-option / archive) via the through-core
// legal.question_template.* tools. Authoring also happens inline from the service
// questionnaire editor's "Save to library"; this page is the bank's home.

import { useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { HelpCircleIcon, PlusIcon, SearchIcon, XIcon } from '@/components/icons'

// In lockstep with the legal API's KNOWN_FIELD_TYPES (minus members_repeater,
// which is questionnaire-structural, not a reusable single question).
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
const OPTION_TYPES = new Set<FieldType>(['select', 'checkbox'])
const TYPE_LABEL = (t: string) => FIELD_TYPES.find((f) => f.value === t)?.label ?? t

interface LibQuestion {
  questionTemplateId: string
  label: string
  type: string
  token: string
  options: string[] | null
}

// One row: an existing library question being edited, or a brand-new draft.
interface Draft {
  questionTemplateId: string | null
  label: string
  type: FieldType
  options: string // one per line
}

function toDraft(q: LibQuestion): Draft {
  return {
    questionTemplateId: q.questionTemplateId,
    label: q.label,
    type: (FIELD_TYPES.some((f) => f.value === q.type) ? q.type : 'text') as FieldType,
    options: (q.options ?? []).join('\n'),
  }
}

export default function QuestionLibraryPage() {
  const [items, setItems] = useState<LibQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  // Map of questionTemplateId (or 'new') → in-progress edit draft.
  const [edit, setEdit] = useState<Record<string, Draft>>({})

  async function load() {
    setError(null)
    try {
      const r = await callAttorneyMcp<{ questions: LibQuestion[] }>({
        toolName: 'legal.question_template.list',
      })
      setItems(r.questions)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  function startNew() {
    setEdit((m) => ({
      ...m,
      new: { questionTemplateId: null, label: '', type: 'text', options: '' },
    }))
  }
  function patch(key: string, d: Partial<Draft>) {
    setEdit((m) => ({ ...m, [key]: { ...m[key], ...d } }))
  }
  function cancel(key: string) {
    setEdit((m) => {
      const { [key]: _drop, ...rest } = m
      return rest
    })
  }

  async function save(key: string) {
    const d = edit[key]
    if (!d || !d.label.trim()) {
      setError('A question needs a label.')
      return
    }
    const options = OPTION_TYPES.has(d.type)
      ? d.options
          .split('\n')
          .map((o) => o.trim())
          .filter(Boolean)
      : undefined
    if (OPTION_TYPES.has(d.type) && (!options || options.length === 0)) {
      setError(`A ${TYPE_LABEL(d.type)} question needs at least one choice.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (d.questionTemplateId) {
        await callAttorneyMcp({
          toolName: 'legal.question_template.update',
          input: {
            questionTemplateId: d.questionTemplateId,
            label: d.label.trim(),
            type: d.type,
            ...(OPTION_TYPES.has(d.type) ? { options } : {}),
          },
        })
      } else {
        await callAttorneyMcp({
          toolName: 'legal.question_template.create',
          input: { label: d.label.trim(), type: d.type, ...(options ? { options } : {}) },
        })
      }
      cancel(key)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function archive(it: LibQuestion) {
    if (!window.confirm(`Archive “${it.label}”? It’s kept as history but removed from the picker.`))
      return
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.question_template.archive',
        input: { questionTemplateId: it.questionTemplateId },
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const needle = q.trim().toLowerCase()
  const filtered = needle
    ? items.filter(
        (i) => i.label.toLowerCase().includes(needle) || i.token.toLowerCase().includes(needle),
      )
    : items

  return (
    <>
      <div
        className="attorney-page-head"
        style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}
      >
        <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <HelpCircleIcon size={22} />
          Question library
        </h1>
        <span style={{ marginLeft: 'auto' }}>
          <button className="primary" onClick={startNew} disabled={busy || !!edit.new}>
            <PlusIcon size={16} /> New question
          </button>
        </span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="qlib-search" style={{ maxWidth: 420, margin: '0 0 1rem' }}>
        <SearchIcon size={15} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search questions or {{tokens}}…"
        />
      </div>

      {edit.new && (
        <QuestionRow
          draft={edit.new}
          onPatch={(d) => patch('new', d)}
          onSave={() => save('new')}
          onCancel={() => cancel('new')}
          busy={busy}
        />
      )}

      {loading ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : filtered.length === 0 && !edit.new ? (
        <p style={{ color: 'var(--muted)' }}>
          {items.length === 0
            ? 'No saved questions yet. Add one here, or use “Save to library” from a service questionnaire.'
            : 'No matches.'}
        </p>
      ) : (
        filtered.map((it) =>
          edit[it.questionTemplateId] ? (
            <QuestionRow
              key={it.questionTemplateId}
              draft={edit[it.questionTemplateId]}
              onPatch={(d) => patch(it.questionTemplateId, d)}
              onSave={() => save(it.questionTemplateId)}
              onCancel={() => cancel(it.questionTemplateId)}
              busy={busy}
            />
          ) : (
            <div key={it.questionTemplateId} className="qb-card" style={{ marginBottom: '0.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{it.label}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                    {TYPE_LABEL(it.type)} · <code>{`{{${it.token}}}`}</code>
                    {it.options && it.options.length > 0 ? ` · ${it.options.join(', ')}` : ''}
                  </div>
                </div>
                <button
                  onClick={() => setEdit((m) => ({ ...m, [it.questionTemplateId]: toDraft(it) }))}
                >
                  Edit
                </button>
                <button
                  className="qb-iconbtn qb-danger"
                  onClick={() => void archive(it)}
                  disabled={busy}
                  title="Archive question"
                  aria-label="Archive question"
                >
                  <XIcon size={15} />
                </button>
              </div>
            </div>
          ),
        )
      )}
    </>
  )
}

function QuestionRow({
  draft,
  onPatch,
  onSave,
  onCancel,
  busy,
}: {
  draft: Draft
  onPatch: (d: Partial<Draft>) => void
  onSave: () => void
  onCancel: () => void
  busy: boolean
}) {
  return (
    <div className="qb-card" style={{ marginBottom: '0.6rem' }}>
      <div className="form-grid">
        <label>
          <span>Question</span>
          <input
            value={draft.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            placeholder="e.g. Registered agent name"
          />
        </label>
        <label>
          <span>Answer type</span>
          <select
            value={draft.type}
            onChange={(e) => onPatch({ type: e.target.value as FieldType })}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {OPTION_TYPES.has(draft.type) && (
        <textarea
          className="qb-options"
          value={draft.options}
          onChange={(e) => onPatch({ options: e.target.value })}
          rows={2}
          placeholder="One choice per line"
        />
      )}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
        <button className="primary" onClick={onSave} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  )
}
