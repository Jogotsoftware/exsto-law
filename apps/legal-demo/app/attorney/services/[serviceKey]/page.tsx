'use client'

// Service editor › SETTINGS tab. Owns the service's identity and how it's offered:
// display name, workflow route, booking-page description, document-generation mode
// (which also decides whether the Prompt tab appears), and per-service booking —
// including the live public booking link. Pricing lives on the Billing tab and the
// document list on the Templates tab; both carry forward untouched on save here
// (legal.service.update merges, so omitted config is preserved). The page chrome
// (title, status, Back, tabs) and the Enable/Disable control (top-right, gated on
// the server completeness check, with a modal listing what's left) live in the
// [serviceKey] layout, so this renders panel content only.
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { ServiceSettingsFields } from '@/components/ServiceSettingsFields'

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
  // BUILDER-UX-1 WP-1.3 — client-facing copy (booking-tile name + description).
  clientDisplayName: string | null
  clientDescription: string | null
  // BUILDER-UX-2 WP-7 — locale variants ({ es: { displayName, description } }).
  clientCopyI18n: Record<string, { displayName?: string; description?: string }> | null
  route: 'auto' | 'manual'
  intakeFormId: string
  documents: string[]
  cost: ServiceCost | null
  generationMode: GenerationMode
  booking: ServiceBooking | null
  appointmentRequired: boolean
  isActive: boolean
  sortOrder: number
  updatedAt: string
}
interface FormState {
  displayName: string
  description: string
  // BUILDER-UX-1 WP-1.3 — the client-facing copy (what the public booking tile
  // shows), edited here alongside the internal/attorney-facing fields.
  clientDisplayName: string
  clientDescription: string
  // WP-7 — the Spanish client copy (empty = the Spanish intake falls back to English).
  clientDisplayNameEs: string
  clientDescriptionEs: string
  route: 'auto' | 'manual'
  generationMode: GenerationMode
  bookingEnabled: boolean
  bookingSendInvite: boolean
  bookingDuration: BookingDuration
  appointmentRequired: boolean
}

const EMPTY: FormState = {
  displayName: '',
  description: '',
  clientDisplayName: '',
  clientDescription: '',
  clientDisplayNameEs: '',
  clientDescriptionEs: '',
  route: 'manual',
  generationMode: 'template_merge',
  bookingEnabled: false,
  bookingSendInvite: true,
  bookingDuration: 30,
  appointmentRequired: true,
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
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
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
        clientDisplayName: r.service.clientDisplayName ?? '',
        clientDescription: r.service.clientDescription ?? '',
        clientDisplayNameEs: r.service.clientCopyI18n?.es?.displayName ?? '',
        clientDescriptionEs: r.service.clientCopyI18n?.es?.description ?? '',
        route: r.service.route,
        generationMode: r.service.generationMode ?? 'template_merge',
        bookingEnabled: r.service.booking?.enabled ?? false,
        bookingSendInvite: r.service.booking?.send_calendar_invite ?? true,
        bookingDuration: r.service.booking?.duration_minutes ?? 30,
        // Defensive ?? true: a stale server bundle without the field must not
        // silently flip existing services to intake-only.
        appointmentRequired: r.service.appointmentRequired ?? true,
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

  // WP-7: clearing BOTH Spanish inputs removes the es entry (the Spanish intake
  // falls back to English) while any OTHER locales carry forward untouched.
  function dropEs(
    map: Record<string, { displayName?: string; description?: string }> | null | undefined,
  ): Record<string, { displayName?: string; description?: string }> | null {
    if (!map) return null
    const rest = Object.fromEntries(Object.entries(map).filter(([k]) => k !== 'es'))
    return Object.keys(rest).length ? rest : null
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
        if (
          form.bookingEnabled ||
          form.generationMode !== 'template_merge' ||
          !form.appointmentRequired ||
          form.clientDisplayName.trim() ||
          form.clientDescription.trim()
        ) {
          await callAttorneyMcp({
            toolName: 'legal.service.update',
            input: {
              serviceKey: newKey,
              displayName: form.displayName.trim(),
              description: form.description.trim() || null,
              clientDisplayName: form.clientDisplayName.trim() || null,
              clientDescription: form.clientDescription.trim() || null,
              clientCopyI18n:
                form.clientDisplayNameEs.trim() || form.clientDescriptionEs.trim()
                  ? {
                      ...(meta?.clientCopyI18n ?? {}),
                      es: {
                        ...(form.clientDisplayNameEs.trim()
                          ? { displayName: form.clientDisplayNameEs.trim() }
                          : {}),
                        ...(form.clientDescriptionEs.trim()
                          ? { description: form.clientDescriptionEs.trim() }
                          : {}),
                      },
                    }
                  : (meta?.clientCopyI18n ?? null),
              route: form.route,
              generationMode: form.generationMode,
              booking,
              appointmentRequired: form.appointmentRequired,
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
          clientDisplayName: form.clientDisplayName.trim() || null,
          clientDescription: form.clientDescription.trim() || null,
          // WP-7: the es inputs build the es entry, merged over the loaded locale
          // map so any OTHER locales survive; clearing both es inputs drops the es
          // entry (dropEs) so the Spanish intake falls back to English.
          clientCopyI18n:
            form.clientDisplayNameEs.trim() || form.clientDescriptionEs.trim()
              ? {
                  ...(meta?.clientCopyI18n ?? {}),
                  es: {
                    ...(form.clientDisplayNameEs.trim()
                      ? { displayName: form.clientDisplayNameEs.trim() }
                      : {}),
                    ...(form.clientDescriptionEs.trim()
                      ? { description: form.clientDescriptionEs.trim() }
                      : {}),
                  },
                }
              : dropEs(meta?.clientCopyI18n),
          route: form.route,
          documents: meta?.documents ?? [],
          sortOrder: meta?.sortOrder,
          generationMode: form.generationMode,
          booking,
          appointmentRequired: form.appointmentRequired,
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
      {!isNew && (
        <p style={{ color: 'var(--muted)', marginTop: 'calc(var(--space-2) * -1)' }}>
          Saving creates a new immutable version. Pricing (Billing tab), documents and questionnaire
          (their tabs) carry forward unless changed there.
        </p>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {saved && <div className="alert alert-success">Saved a new version.</div>}

      {!form ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      ) : (
        <section>
          {/* BUILDER-UX-2 WP-2: the identity + client-copy + generation fields are the
              SHARED ServiceSettingsFields — the same form the wizard's ServiceEditorModal
              renders (one editor, no fork). The booking-schedule fieldset below is
              page-only. */}
          <ServiceSettingsFields
            value={{
              displayName: form.displayName,
              route: form.route,
              clientDisplayName: form.clientDisplayName,
              clientDescription: form.clientDescription,
              clientDisplayNameEs: form.clientDisplayNameEs,
              clientDescriptionEs: form.clientDescriptionEs,
              description: form.description,
              generationMode: form.generationMode,
              appointmentRequired: form.appointmentRequired,
            }}
            onChange={(next) =>
              setForm((f) =>
                f
                  ? {
                      ...f,
                      displayName: next.displayName,
                      route: next.route,
                      clientDisplayName: next.clientDisplayName,
                      clientDescription: next.clientDescription,
                      clientDisplayNameEs: next.clientDisplayNameEs,
                      clientDescriptionEs: next.clientDescriptionEs,
                      description: next.description,
                      generationMode: next.generationMode,
                    }
                  : f,
              )
            }
          />

          <fieldset className="svc-fieldset">
            <legend>Bookings</legend>
            <label className="svc-check">
              <input
                type="checkbox"
                checked={form.appointmentRequired}
                onChange={(e) => update('appointmentRequired', e.target.checked)}
              />
              <span>Clients schedule a consultation when they book this service</span>
            </label>
            {!form.appointmentRequired && (
              <p
                style={{
                  color: 'var(--muted)',
                  fontSize: 'var(--text-sm)',
                  margin: '0 0 var(--space-2)',
                }}
              >
                Intake only — clients submit the questionnaire and the matter opens without an
                appointment. Great for document-review services.
              </p>
            )}
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
                disabled={!form.appointmentRequired}
                onChange={(e) => update('bookingSendInvite', e.target.checked)}
              />
              <span>Send a calendar invite when a consultation is booked</span>
            </label>
            <label style={{ maxWidth: 240, opacity: form.appointmentRequired ? 1 : 0.5 }}>
              <span>Consultation length</span>
              <select
                value={form.bookingDuration}
                disabled={!form.appointmentRequired}
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
