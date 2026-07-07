'use client'

// Question library (migration 0077) — EVERY intake question the firm has: the
// reusable saved questions (each with a stable {{answer}} token, managed here via
// the through-core legal.question_template.* tools) PLUS the questions defined
// inside each service's intake form (read-only here; edited in the service
// builder). Beta feedback: showing only the saved bank hid the questions a live
// service was already asking. Authoring also happens inline from the service
// questionnaire editor's "Save to library"; this page is the bank's home.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PageHead } from '@/components/PageHead'
import { PlusIcon, SearchIcon, XIcon } from '@/components/icons'

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

// Normalize a typed VARIABLE to a valid {{token}} (keeps a trailing "_" so
// "company_" → "company_name" types cleanly). The backend re-normalizes + uniquifies.
function normToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .slice(0, 60)
}
function slug(s: string): string {
  return normToken(s).replace(/^_+|_+$/g, '')
}

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
  // The {{answer}} variable. Editable when creating; the stable binding key once
  // saved, so existing questions show it read-only.
  token: string
}

function toDraft(q: LibQuestion): Draft {
  return {
    questionTemplateId: q.questionTemplateId,
    label: q.label,
    type: (FIELD_TYPES.some((f) => f.value === q.type) ? q.type : 'text') as FieldType,
    options: (q.options ?? []).join('\n'),
    token: q.token,
  }
}

// A question living inside a service's intake form — surfaced here so the library
// is the full inventory, but edited in the service builder (it is service config,
// not a question_template entity).
interface ServiceQuestion {
  serviceKey: string
  serviceName: string
  label: string
  type: string
  token: string
  options: string[] | null
}

export default function QuestionLibraryPage() {
  const [items, setItems] = useState<LibQuestion[]>([])
  const [svcQuestions, setSvcQuestions] = useState<ServiceQuestion[]>([])
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
    // Questions defined inside each service's intake form, best-effort: a failure
    // here must not blank the saved bank.
    try {
      const { services } = await callAttorneyMcp<{
        services: Array<{ serviceKey: string; displayName: string }>
      }>({ toolName: 'legal.service.list_all' })
      const perService = await Promise.all(
        services.map((s) =>
          callAttorneyMcp<{
            questionnaire: {
              sections?: Array<{
                fields?: Array<{ id?: string; label?: string; type?: string; options?: string[] }>
              }>
            } | null
          }>({ toolName: 'legal.service.questionnaire.get', input: { serviceKey: s.serviceKey } })
            .then((r) =>
              (r.questionnaire?.sections ?? []).flatMap((sec) =>
                (sec.fields ?? []).map((f) => ({
                  serviceKey: s.serviceKey,
                  serviceName: s.displayName,
                  label: f.label?.trim() || f.id || '(unlabelled)',
                  type: f.type ?? 'text',
                  token: f.id ?? '',
                  options: f.options?.length ? f.options : null,
                })),
              ),
            )
            .catch(() => [] as ServiceQuestion[]),
        ),
      )
      setSvcQuestions(perService.flat())
    } catch {
      setSvcQuestions([])
    }
  }
  useEffect(() => {
    void load()
  }, [])

  function startNew() {
    setEdit((m) => ({
      ...m,
      new: { questionTemplateId: null, label: '', type: 'text', options: '', token: '' },
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
          input: {
            label: d.label.trim(),
            type: d.type,
            ...(d.token.trim() ? { token: d.token.trim() } : {}),
            ...(options ? { options } : {}),
          },
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

  // Service-intake questions not already in the saved bank (dedupe by token: a
  // library question attached to a service is already listed above).
  const bankTokens = new Set(items.map((i) => i.token.toLowerCase()))
  const svcOnly = svcQuestions.filter((s) => !bankTokens.has(s.token.toLowerCase()))
  const svcFiltered = needle
    ? svcOnly.filter(
        (i) =>
          i.label.toLowerCase().includes(needle) ||
          i.token.toLowerCase().includes(needle) ||
          i.serviceName.toLowerCase().includes(needle),
      )
    : svcOnly

  return (
    <main>
      <PageHead
        title="Question library"
        actions={
          <button className="primary" onClick={startNew} disabled={busy || !!edit.new}>
            <PlusIcon size={16} /> New question
          </button>
        }
      />

      {error && <div className="alert alert-error">{error}</div>}

      <div className="qlib-search" style={{ maxWidth: 420, margin: '0 0 var(--space-4)' }}>
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
      ) : filtered.length === 0 && svcFiltered.length === 0 && !edit.new ? (
        <p style={{ color: 'var(--muted)' }}>
          {items.length === 0 && svcOnly.length === 0
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
            <div
              key={it.questionTemplateId}
              className="qb-card"
              style={{ marginBottom: 'var(--space-2)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
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

      {/* Questions living inside a service's intake form (not in the saved bank) —
          part of the firm's full question inventory, edited in the service builder. */}
      {!loading && svcFiltered.length > 0 && (
        <>
          <h3 style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>In service intake forms</h3>
          {svcFiltered.map((it, i) => (
            <div
              key={`${it.serviceKey}-${it.token}-${i}`}
              className="qb-card"
              style={{ marginBottom: 'var(--space-2)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{it.label}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                    {TYPE_LABEL(it.type)} · <code>{`{{${it.token}}}`}</code> · from{' '}
                    <strong>{it.serviceName}</strong>
                    {it.options && it.options.length > 0 ? ` · ${it.options.join(', ')}` : ''}
                  </div>
                </div>
                <Link
                  href={`/attorney/services/${encodeURIComponent(it.serviceKey)}/questionnaire`}
                >
                  <button>Edit in service</button>
                </Link>
              </div>
            </div>
          ))}
        </>
      )}
    </main>
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
    <div className="qb-card" style={{ marginBottom: 'var(--space-2)' }}>
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
          <span>
            Variable{' '}
            <span className="text-muted" style={{ fontWeight: 400 }}>
              — the <code>{'{{token}}'}</code> templates bind to
            </span>
          </span>
          <input
            value={draft.token}
            onChange={(e) => onPatch({ token: normToken(e.target.value) })}
            placeholder={slug(draft.label) || 'variable'}
            spellCheck={false}
            readOnly={draft.questionTemplateId !== null}
            title={
              draft.questionTemplateId !== null
                ? 'The variable is the stable binding key and cannot be changed after a question is created.'
                : 'Defaults to a slug of the question label if left blank.'
            }
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              opacity: draft.questionTemplateId !== null ? 0.6 : 1,
            }}
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
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
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
