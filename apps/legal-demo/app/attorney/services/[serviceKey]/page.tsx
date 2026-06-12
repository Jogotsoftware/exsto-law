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
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [isNew, serviceKey])

  useEffect(() => {
    load()
  }, [load])

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
        router.push(`/attorney/services/${r.service.serviceKey}`)
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
