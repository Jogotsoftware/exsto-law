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
  description: string
  route: 'auto' | 'manual'
  documents: string
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
  documents: '',
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
        documents: r.service.documents.join(', '),
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
      const documents = form.documents
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean)
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
        <button className="primary" onClick={save} disabled={busy || !form}>
          {busy ? 'Saving…' : isNew ? 'Create service' : 'Save new version'}
        </button>
      </div>

      {!isNew && (
        <p style={{ color: 'var(--muted)', marginTop: '-0.4rem' }}>
          Saving creates a new immutable version. The intake form binding and workflow route carry
          forward unless changed here.
        </p>
      )}

      {!isNew && meta && (
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
      ) : (
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
                <option value="auto">Auto — AI drafts after consultation</option>
              </select>
            </label>
            <label>
              <span>Documents (comma-separated)</span>
              <input
                value={form.documents}
                onChange={(e) => update('documents', e.target.value)}
                placeholder="operating_agreement, engagement_letter"
              />
            </label>
            <label>
              <span>Sort order</span>
              <input
                type="number"
                inputMode="numeric"
                value={form.sortOrder}
                onChange={(e) => update('sortOrder', e.target.value)}
                placeholder="0"
              />
            </label>
          </div>
          <label>
            <span>Description</span>
            <textarea
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              rows={3}
            />
          </label>
          {!isNew && meta && (
            <p style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
              Service key: <code>{meta.serviceKey}</code>
              {meta.intakeFormId && (
                <>
                  {' · '}Intake form: <code>{meta.intakeFormId}</code>
                </>
              )}
            </p>
          )}
        </section>
      )}
    </main>
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
