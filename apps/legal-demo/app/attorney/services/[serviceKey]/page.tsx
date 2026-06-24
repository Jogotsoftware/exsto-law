'use client'

// Service editor › SETTINGS tab. Owns the service's identity and how it's offered:
// display name, workflow route, booking-page description, document-generation mode
// (which also decides whether the Prompt tab appears), and per-service booking —
// including the live public booking link. Pricing lives on the Billing tab and the
// document list on the Templates tab; both carry forward untouched on save here
// (legal.service.update merges, so omitted config is preserved). Also hosts the
// enable/disable control (gated on the server completeness check). The page chrome
// (title, status, Back, tabs) is provided by the [serviceKey] layout, so this
// renders panel content only.
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
interface Completeness {
  serviceKey: string
  ready: boolean
  missing: string[]
}

interface FormState {
  displayName: string
  description: string
  route: 'auto' | 'manual'
  generationMode: GenerationMode
  bookingEnabled: boolean
  bookingSendInvite: boolean
  bookingDuration: BookingDuration
}

const EMPTY: FormState = {
  displayName: '',
  description: '',
  route: 'manual',
  generationMode: 'template_merge',
  bookingEnabled: false,
  bookingSendInvite: true,
  bookingDuration: 30,
}

export default function ServiceSettingsPage() {
  const params = useParams<{ serviceKey: string }>()
  const router = useRouter()
  const serviceKey = params.serviceKey
  const isNew = serviceKey === 'new'

  const [form, setForm] = useState<FormState | null>(isNew ? EMPTY : null)
  // The loaded service, kept so saves preserve config this tab doesn't edit
  // (documents, sort order — carried forward explicitly; cost — carried via merge).
  const [meta, setMeta] = useState<ServiceDefinition | null>(null)
  const [completeness, setCompleteness] = useState<Completeness | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const [saved, setSaved] = useState(false)
  const [origin, setOrigin] = useState('')

  useEffect(() => setOrigin(window.location.origin), [])

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
        generationMode: r.service.generationMode ?? 'template_merge',
        bookingEnabled: r.service.booking?.enabled ?? false,
        bookingSendInvite: r.service.booking?.send_calendar_invite ?? true,
        bookingDuration: r.service.booking?.duration_minutes ?? 30,
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
      await callAttorneyMcp({ toolName: 'legal.service.set_active', input: { serviceKey, active } })
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
      const booking: ServiceBooking = {
        enabled: form.bookingEnabled,
        send_calendar_invite: form.bookingSendInvite,
        duration_minutes: form.bookingDuration,
      }
      if (isNew) {
        // Create with identity + route only; the guided flow then sends the
        // attorney into the questionnaire. Generation/booking are written in a
        // second call only if they differ from defaults, to avoid a needless
        // version. Documents, pricing, questionnaire are configured on their tabs.
        const r = await callAttorneyMcp<{ service: ServiceDefinition }>({
          toolName: 'legal.service.create',
          input: {
            displayName: form.displayName.trim(),
            description: form.description.trim() || null,
            route: form.route,
          },
        })
        const newKey = r.service.serviceKey
        if (form.bookingEnabled || form.generationMode !== 'template_merge') {
          await callAttorneyMcp({
            toolName: 'legal.service.update',
            input: {
              serviceKey: newKey,
              displayName: form.displayName.trim(),
              description: form.description.trim() || null,
              route: form.route,
              generationMode: form.generationMode,
              booking,
            },
          })
        }
        router.push(`/attorney/services/${newKey}/questionnaire`)
        return
      }
      // Existing: send the fields this tab owns plus documents/sortOrder preserved
      // from the freshly-loaded meta (so they aren't reset); cost is omitted and
      // carried forward by the merge.
      await callAttorneyMcp({
        toolName: 'legal.service.update',
        input: {
          serviceKey,
          displayName: form.displayName.trim(),
          description: form.description.trim() || null,
          route: form.route,
          documents: meta?.documents ?? [],
          sortOrder: meta?.sortOrder,
          generationMode: form.generationMode,
          booking,
        },
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

  const bookingUrl = origin ? `${origin}/book?service=${serviceKey}` : ''

  return (
    <>
      {!isNew && meta && (
        <EnableGate
          isActive={meta.isActive}
          completeness={completeness}
          enabling={enabling}
          onEnable={() => setActive(true)}
          onDisable={() => setActive(false)}
        />
      )}

      {!isNew && (
        <p style={{ color: 'var(--muted)', marginTop: 'calc(var(--space-2) * -1)' }}>
          Saving creates a new immutable version. Pricing (Billing tab), documents and questionnaire
          (their tabs) carry forward unless changed there.
        </p>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {saved && <div className="alert alert-success">Saved a new version.</div>}

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
                <option value="auto">Attorney in the loop — auto-drafts on intake</option>
              </select>
            </label>
          </div>
          <label style={{ display: 'block', marginTop: 'var(--space-3)' }}>
            <span>Booking page description</span>
            <textarea
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              rows={2}
              placeholder="The plain-language summary clients see when choosing this service on the booking page."
            />
          </label>

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
            <p
              style={{
                color: 'var(--muted)',
                fontSize: 'var(--text-sm)',
                margin: 'var(--space-2) 0 0',
              }}
            >
              {form.generationMode === 'ai_draft'
                ? 'AI draft uses the per-document instructions on the Prompt tab.'
                : 'Template merge fills the bodies on the Templates tab — no Prompt tab needed.'}
            </p>
          </fieldset>

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
            {!isNew && (
              <BookingLink
                enabled={form.bookingEnabled}
                isActive={meta?.isActive ?? false}
                url={bookingUrl}
              />
            )}
            <p
              style={{
                color: 'var(--muted)',
                fontSize: 'var(--text-sm)',
                margin: 'var(--space-2) 0 0',
              }}
            >
              Days, hours and buffer are firm-wide —{' '}
              <Link href="/attorney/settings" className="back-link">
                edit booking hours in Settings
              </Link>
              .
            </p>
          </fieldset>

          <div style={{ marginTop: 'var(--space-3)' }}>
            <button className="primary" onClick={save} disabled={busy || !form.displayName.trim()}>
              {busy ? 'Saving…' : isNew ? 'Create service' : 'Save new version'}
            </button>
          </div>
        </section>
      )}
    </>
  )
}

// The live public booking link for this service. Shown once the service exists.
// Only actually reachable when the service is enabled AND booking is turned on, so
// we say so plainly rather than handing out a link that 404s/redirects.
function BookingLink({
  enabled,
  isActive,
  url,
}: {
  enabled: boolean
  isActive: boolean
  url: string
}) {
  const [copied, setCopied] = useState(false)
  const live = enabled && isActive
  return (
    <div style={{ marginTop: 'var(--space-2)' }}>
      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Booking link</span>
      <div className="qb-pill-add" style={{ marginTop: 'var(--space-1)' }}>
        <input value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            } catch {
              /* clipboard blocked — the field is selectable as a fallback */
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <a href={url} target="_blank" rel="noreferrer" className="back-link">
          Open ↗
        </a>
      </div>
      <p
        style={{
          color: live ? 'var(--ok)' : 'var(--muted)',
          fontSize: 'var(--text-xs)',
          margin: 'var(--space-1) 0 0',
        }}
      >
        {live
          ? 'Live — clients can book this service at the link above.'
          : !isActive
            ? 'The service must be enabled (below) before this link accepts bookings.'
            : 'Turn on “Offer this service for online booking” and save to make this link live.'}
      </p>
    </div>
  )
}

// Enable gate. When the service is already enabled it collapses to a single status
// line + Disable; when disabled it shows the Enable button, gated on the server
// completeness check so the UI and the set_active handler never disagree, plus the
// remaining requirements so the attorney knows why it isn't bookable yet.
function EnableGate({
  isActive,
  completeness,
  enabling,
  onEnable,
  onDisable,
}: {
  isActive: boolean
  completeness: { ready: boolean; missing: string[] } | null
  enabling: boolean
  onEnable: () => void
  onDisable: () => void
}) {
  if (isActive) {
    return (
      <section
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
        }}
      >
        <span style={{ color: 'var(--ok)' }}>✓ Enabled and bookable.</span>
        <button className="danger outline" onClick={onDisable} disabled={enabling}>
          {enabling ? '…' : 'Disable service'}
        </button>
      </section>
    )
  }

  const missing = completeness?.missing ?? []
  const ready = completeness?.ready ?? false

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <button
          className="primary"
          onClick={onEnable}
          disabled={enabling || !ready || completeness === null}
          title={ready ? 'Make this service bookable' : `Finish setup first: ${missing.join('; ')}`}
        >
          {enabling ? 'Enabling…' : 'Enable service'}
        </button>
        {!ready && completeness && (
          <span style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
            Not bookable yet — complete the requirements below.
          </span>
        )}
      </div>
      {missing.length > 0 && (
        <ul
          style={{
            margin: 'var(--space-2) 0 0',
            paddingLeft: 'var(--space-4)',
            color: 'var(--danger)',
            fontSize: 'var(--text-sm)',
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
