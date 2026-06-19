'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

type GenerationMode = 'template_merge' | 'ai_draft'
type BookingDuration = 15 | 30 | 45 | 60

interface ServiceBooking {
  enabled: boolean
  send_calendar_invite: boolean
  duration_minutes: BookingDuration
}
interface ServiceCost {
  type: 'hourly' | 'fixed'
  amount: string
  hours: number | null
}

interface ServiceDefinition {
  id: string
  serviceKey: string
  displayName: string
  description: string | null
  route: 'auto' | 'manual'
  intakeFormId: string
  documents: string[]
  cost: ServiceCost | null
  generationMode: GenerationMode
  booking: ServiceBooking | null
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
  // Contract G (WP2.3): document generation + per-service booking, flattened for
  // the form. costType '' means no fee is set.
  generationMode: GenerationMode
  bookingEnabled: boolean
  bookingSendInvite: boolean
  bookingDuration: BookingDuration
  costType: '' | 'hourly' | 'fixed'
  costAmount: string
  costHours: string
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
  generationMode: 'template_merge',
  bookingEnabled: false,
  bookingSendInvite: true,
  bookingDuration: 30,
  costType: '',
  costAmount: '',
  costHours: '',
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
        generationMode: r.service.generationMode ?? 'template_merge',
        bookingEnabled: r.service.booking?.enabled ?? false,
        bookingSendInvite: r.service.booking?.send_calendar_invite ?? true,
        bookingDuration: r.service.booking?.duration_minutes ?? 30,
        costType: r.service.cost?.type ?? '',
        costAmount: r.service.cost?.amount ?? '',
        costHours: r.service.cost?.hours != null ? String(r.service.cost.hours) : '',
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
    if (form.costType !== '' && !/^\d+(\.\d{1,2})?$/.test(form.costAmount.trim())) {
      setError('Enter the rate as an amount like 350 or 350.00.')
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
      // Contract G (WP2.3): one save writes a single new immutable version carrying
      // metadata + generation_mode + the booking block + the inline rate. costType
      // '' clears the fee (cost: null).
      const cost: ServiceCost | null =
        form.costType === ''
          ? null
          : {
              type: form.costType,
              amount: form.costAmount.trim(),
              hours:
                form.costType === 'hourly' && form.costHours.trim() ? Number(form.costHours) : null,
            }
      const booking: ServiceBooking = {
        enabled: form.bookingEnabled,
        send_calendar_invite: form.bookingSendInvite,
        duration_minutes: form.bookingDuration,
      }
      await callAttorneyMcp({
        toolName: 'legal.service.update',
        input: { serviceKey, ...base, generationMode: form.generationMode, booking, cost },
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
            <>
              {/* How documents are produced (Contract G). Deterministic merge is
                  the default; AI drafting is opt-in. */}
              <fieldset className="svc-fieldset">
                <legend>Document generation</legend>
                <label>
                  <span>How documents are produced</span>
                  <select
                    value={form.generationMode}
                    onChange={(e) => update('generationMode', e.target.value as GenerationMode)}
                  >
                    <option value="template_merge">
                      Template merge — fill the template from the answers (no AI)
                    </option>
                    <option value="ai_draft">AI draft — the assistant writes the document</option>
                  </select>
                </label>
              </fieldset>

              {/* Inline rate (Contract K surfaces this; the value lives on the
                  service as transitions.cost). */}
              <fieldset className="svc-fieldset">
                <legend>Pricing</legend>
                <div className="form-grid">
                  <label>
                    <span>Fee</span>
                    <select
                      value={form.costType}
                      onChange={(e) => update('costType', e.target.value as FormState['costType'])}
                    >
                      <option value="">No fee set</option>
                      <option value="hourly">Hourly rate</option>
                      <option value="fixed">Fixed fee</option>
                    </select>
                  </label>
                  {form.costType !== '' && (
                    <label>
                      <span>
                        {form.costType === 'hourly' ? 'Hourly rate (USD)' : 'Flat fee (USD)'}
                      </span>
                      <input
                        inputMode="decimal"
                        value={form.costAmount}
                        onChange={(e) => update('costAmount', e.target.value)}
                        placeholder="350.00"
                      />
                    </label>
                  )}
                  {form.costType === 'hourly' && (
                    <label>
                      <span>Estimated hours (optional)</span>
                      <input
                        inputMode="numeric"
                        value={form.costHours}
                        onChange={(e) => update('costHours', e.target.value)}
                        placeholder="e.g. 3"
                      />
                    </label>
                  )}
                </div>
              </fieldset>

              {/* Per-service booking (Contract G). S5/S6 read this block. */}
              <fieldset className="svc-fieldset">
                <legend>Bookings</legend>
                <label className="svc-check">
                  <input
                    type="checkbox"
                    checked={form.bookingEnabled}
                    onChange={(e) => update('bookingEnabled', e.target.checked)}
                  />
                  <span>Offer this service for online booking</span>
                </label>
                <label className="svc-check">
                  <input
                    type="checkbox"
                    checked={form.bookingSendInvite}
                    onChange={(e) => update('bookingSendInvite', e.target.checked)}
                  />
                  <span>Send a calendar invite when a consultation is booked</span>
                </label>
                <label style={{ maxWidth: 240 }}>
                  <span>Consultation length</span>
                  <select
                    value={form.bookingDuration}
                    onChange={(e) =>
                      update('bookingDuration', Number(e.target.value) as BookingDuration)
                    }
                  >
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={45}>45 minutes</option>
                    <option value={60}>60 minutes</option>
                  </select>
                </label>
              </fieldset>
            </>
          )}

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
            <div>
              <div className="kv-label">Generation</div>
              <div className="kv-value">
                {form.generationMode === 'ai_draft' ? 'AI draft' : 'Template merge'}
              </div>
            </div>
            <div>
              <div className="kv-label">Pricing</div>
              <div className="kv-value">
                {form.costType === ''
                  ? '—'
                  : form.costType === 'hourly'
                    ? `$${form.costAmount}/hr${form.costHours ? ` · ~${form.costHours}h` : ''}`
                    : `$${form.costAmount} fixed`}
              </div>
            </div>
            <div>
              <div className="kv-label">Booking</div>
              <div className="kv-value">
                {form.bookingEnabled
                  ? `${form.bookingDuration} min${form.bookingSendInvite ? ' · sends invite' : ''}`
                  : 'Off'}
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
