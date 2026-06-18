'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

interface ServiceDefinition {
  id: string
  serviceKey: string
  displayName: string
  description: string | null
  route: 'auto' | 'manual'
  intakeFormId: string
  documents: string[]
  isActive: boolean
  sortOrder: number
  updatedAt: string
}

interface FormState {
  displayName: string
  // Round-tripped, not shown (WP2.3: no descriptions / no raw sort_order surfaced).
  description: string
  route: 'auto' | 'manual'
  documents: string[]
  sortOrder: string
}

interface Completeness {
  serviceKey: string
  ready: boolean
  missing: string[]
}

const EMPTY: FormState = {
  displayName: '',
  description: '',
  route: 'manual',
  documents: [],
  sortOrder: '',
}

export default function ServiceEditorPage() {
  const params = useParams<{ serviceKey: string }>()
  const router = useRouter()
  const serviceKey = params.serviceKey
  const isNew = serviceKey === 'new'

  const [form, setForm] = useState<FormState | null>(isNew ? EMPTY : null)
  const [meta, setMeta] = useState<ServiceDefinition | null>(null)
  const [completeness, setCompleteness] = useState<Completeness | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const [saved, setSaved] = useState(false)
  // Existing services open in a clean read state; the form (the "wizard") shows
  // only when editing or creating (WP2.3).
  const [editing, setEditing] = useState(isNew)

  const load = useCallback(async () => {
    if (isNew) return
    try {
      const r = await callAttorneyMcp<{ service: ServiceDefinition | null }>({
        toolName: 'legal.service.get',
        input: { serviceKey },
      })
      if (!r.service) {
        setError(`Service not found: ${serviceKey}`)
        return
      }
      setMeta(r.service)
      setForm({
        displayName: r.service.displayName,
        description: r.service.description ?? '',
        route: r.service.route,
        documents: r.service.documents,
        sortOrder: String(r.service.sortOrder),
      })
      const c = await callAttorneyMcp<Completeness>({
        toolName: 'legal.service.completeness',
        input: { serviceKey },
      })
      setCompleteness(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [isNew, serviceKey])

  useEffect(() => {
    load()
  }, [load])

  async function setActive(active: boolean) {
    setEnabling(true)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.service.set_active',
        input: { serviceKey, active },
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setEnabling(false)
    }
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f))
    setSaved(false)
  }

  async function save() {
    if (!form) return
    if (!form.displayName.trim()) {
      setError('A display name is required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const documents = form.documents.map((d) => d.trim()).filter(Boolean)
      const sortOrder = form.sortOrder.trim() ? Number(form.sortOrder) : undefined
      const base = {
        displayName: form.displayName.trim(),
        description: form.description.trim() || null,
        route: form.route,
        documents,
        sortOrder,
      }
      if (isNew) {
        const r = await callAttorneyMcp<{ service: ServiceDefinition }>({
          toolName: 'legal.service.create',
          input: base,
        })
        // Guided flow: a new service is created disabled with an empty
        // questionnaire, so send the attorney straight into the questionnaire
        // editor (step ②) rather than back to a half-built editor page.
        router.push(`/attorney/services/${r.service.serviceKey}/questionnaire`)
        return
      }
      await callAttorneyMcp({
        toolName: 'legal.service.update',
        input: { serviceKey, ...base },
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      await load()
      setEditing(false)
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
        <h1 style={{ margin: 0 }}>{isNew ? 'New service' : (meta?.displayName ?? 'Service')}</h1>
        <Link href="/attorney/services" className="back-link" style={{ marginLeft: 'auto' }}>
          Back to services
        </Link>
        {!isNew && (
          <Link href={`/attorney/services/${serviceKey}/questionnaire`} className="back-link">
            Edit questionnaire
          </Link>
        )}
        {!isNew && (
          <Link href={`/attorney/services/${serviceKey}/prompt`} className="back-link">
            Edit prompt
          </Link>
        )}
        {!isNew && (
          <Link href={`/attorney/services/${serviceKey}/template`} className="back-link">
            Edit templates
          </Link>
        )}
        {editing || isNew ? (
          <button className="primary" onClick={save} disabled={busy || !form}>
            {busy ? 'Saving…' : isNew ? 'Create service' : 'Save new version'}
          </button>
        ) : (
          <button className="primary" onClick={() => setEditing(true)}>
            Edit details
          </button>
        )}
      </div>

      {!isNew && (
        <p style={{ color: 'var(--muted)', marginTop: '-0.4rem' }}>
          Saving creates a new immutable version. The intake form binding and workflow route carry
          forward unless changed here.
        </p>
      )}

      {!isNew && meta && (editing || !meta.isActive) && (
        <SetupChecklist
          serviceKey={serviceKey}
          route={meta.route}
          isActive={meta.isActive}
          completeness={completeness}
          enabling={enabling}
          onEnable={() => setActive(true)}
          onDisable={() => setActive(false)}
        />
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {saved && (
        <div
          className="alert"
          style={{ background: 'var(--ok-soft)', color: '#166534', border: '1px solid #86efac' }}
        >
          Saved a new version.
        </div>
      )}

      {!form ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : editing || isNew ? (
        <section>
          <div className="form-grid">
            <label>
              <span>Display name</span>
              <input
                value={form.displayName}
                onChange={(e) => update('displayName', e.target.value)}
                placeholder="e.g. NC LLC — Single-Member Formation"
              />
            </label>
            <label>
              <span>Workflow route</span>
              <select
                value={form.route}
                onChange={(e) => update('route', e.target.value as 'auto' | 'manual')}
              >
                <option value="manual">Manual — attorney drafts</option>
                <option value="auto">Auto — drafts on submit (re-drafts after the call)</option>
              </select>
            </label>
          </div>
          <DocumentsPills
            documents={form.documents}
            onChange={(docs) => update('documents', docs)}
          />
          {!isNew && (
            <div style={{ marginTop: '0.9rem' }}>
              <button
                onClick={() => {
                  setEditing(false)
                  load()
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </section>
      ) : (
        <section>
          <div className="kv-grid">
            <div>
              <div className="kv-label">Status</div>
              <div className="kv-value">
                <span className={`badge ${meta?.isActive ? 'ok' : ''}`}>
                  {meta?.isActive ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>
            <div>
              <div className="kv-label">Workflow</div>
              <div className="kv-value">
                {form.route === 'auto' ? 'Auto — drafts on submit' : 'Manual — attorney drafts'}
              </div>
            </div>
            <div>
              <div className="kv-label">Documents</div>
              <div className="kv-value">
                {form.documents.length === 0
                  ? '—'
                  : form.documents.map((d) => (
                      <span key={d} className="qb-pill" style={{ marginRight: '0.3rem' }}>
                        {d.replace(/_/g, ' ')}
                      </span>
                    ))}
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  )
}

// Documents this service produces, as add/remove pills (WP2.3) — replaces the raw
// comma-separated input. Labels are humanized; the stored value is the slug.
function DocumentsPills({
  documents,
  onChange,
}: {
  documents: string[]
  onChange: (d: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
    if (!v || documents.includes(v)) return setDraft('')
    onChange([...documents, v])
    setDraft('')
  }
  return (
    <div style={{ marginTop: '0.6rem' }}>
      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Documents this service produces</span>
      <div className="qb-pills">
        {documents.map((d) => (
          <span key={d} className="qb-pill">
            {d.replace(/_/g, ' ')}
            <button
              type="button"
              title="Remove"
              onClick={() => onChange(documents.filter((x) => x !== d))}
            >
              ×
            </button>
          </span>
        ))}
        {documents.length === 0 && (
          <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>None yet</span>
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
          placeholder="e.g. operating agreement"
        />
        <button type="button" onClick={add}>
          Add
        </button>
      </div>
    </div>
  )
}

// The guided setup checklist + enable gate (PR4). Steps mirror the build flow:
// ① metadata (done once the row exists) ② questionnaire ③ prompt (auto only)
// ④ Enable. Steps ②/③ derive their status from the server's completeness check,
// so the UI and the set_active handler guard never disagree. The Enable button is
// disabled until completeness.ready; the remaining reasons are listed beneath it.
function SetupChecklist({
  serviceKey,
  route,
  isActive,
  completeness,
  enabling,
  onEnable,
  onDisable,
}: {
  serviceKey: string
  route: 'auto' | 'manual'
  isActive: boolean
  completeness: { ready: boolean; missing: string[] } | null
  enabling: boolean
  onEnable: () => void
  onDisable: () => void
}) {
  const missing = completeness?.missing ?? []
  const needsQuestionnaire = missing.some((m) => m.toLowerCase().includes('questionnaire'))
  const needsPrompt = missing.some((m) => m.toLowerCase().includes('prompt'))
  const needsTemplate = missing.some((m) => m.toLowerCase().includes('template'))
  const ready = completeness?.ready ?? false

  const steps: { n: string; label: string; done: boolean; href?: string }[] = [
    { n: '①', label: 'Service details', done: true },
    {
      n: '②',
      label: 'Questionnaire',
      done: !needsQuestionnaire,
      href: `/attorney/services/${serviceKey}/questionnaire`,
    },
  ]
  if (route === 'auto') {
    steps.push({
      n: '③',
      label: 'Drafting prompt',
      done: !needsPrompt,
      href: `/attorney/services/${serviceKey}/prompt`,
    })
    steps.push({
      n: '④',
      label: 'Document template',
      done: !needsTemplate,
      href: `/attorney/services/${serviceKey}/template`,
    })
  }

  return (
    <section style={{ borderLeft: '3px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
        <strong>Setup checklist</strong>
        <span className={`badge ${isActive ? 'ok' : ''}`} style={{ marginLeft: 'auto' }}>
          {isActive ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.4rem' }}>
        {steps.map((s) => (
          <li
            key={s.n}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}
          >
            <span aria-hidden style={{ color: s.done ? '#166534' : 'var(--muted)' }}>
              {s.done ? '✓' : '◯'}
            </span>
            <span style={{ color: s.done ? 'inherit' : 'var(--muted)' }}>{s.label}</span>
            {s.href && (
              <Link href={s.href} className="back-link" style={{ marginLeft: '0.4rem' }}>
                {s.done ? 'Edit' : 'Set up'}
              </Link>
            )}
          </li>
        ))}
        <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
          <span aria-hidden style={{ color: isActive ? '#166534' : 'var(--muted)' }}>
            {isActive ? '✓' : '◯'}
          </span>
          <span style={{ color: isActive ? 'inherit' : 'var(--muted)' }}>Enable for booking</span>
        </li>
      </ol>

      <div style={{ marginTop: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
        {isActive ? (
          <button className="danger outline" onClick={onDisable} disabled={enabling}>
            {enabling ? '…' : 'Disable service'}
          </button>
        ) : (
          <button
            className="primary"
            onClick={onEnable}
            disabled={enabling || !ready || completeness === null}
            title={
              ready ? 'Make this service bookable' : `Finish setup first: ${missing.join('; ')}`
            }
          >
            {enabling ? 'Enabling…' : 'Enable service'}
          </button>
        )}
        {!isActive && !ready && completeness && (
          <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
            Not bookable yet — complete the steps above.
          </span>
        )}
      </div>

      {!isActive && missing.length > 0 && (
        <ul
          style={{
            margin: '0.6rem 0 0',
            paddingLeft: '1.1rem',
            color: '#991b1b',
            fontSize: '0.82rem',
          }}
        >
          {missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
