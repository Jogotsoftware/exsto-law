'use client'

import { useCallback, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { fetchSession } from '@/lib/auth'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import { PageHead } from '@/components/PageHead'
import { UsersRolesSection } from './UsersRolesSection'
import { AiUsageSection } from './AiUsageSection'

type Provider = 'google_calendar' | 'anthropic' | 'openai' | 'perplexity' | 'granola' | 'docusign'

// google_calendar AND granola are OAuth providers (connect via a browser flow),
// docusign is coming-soon — the rest are api-key.
type ApiKeyProvider = Exclude<Provider, 'google_calendar' | 'docusign' | 'granola'>

interface IntegrationStatus {
  provider: Provider
  authKind: 'api_key' | 'oauth' | 'coming_soon'
  connected: boolean
  comingSoon?: boolean
  lastFour: string | null
  connectedAt: string | null
  lastVerifiedAt: string | null
  lastVerifyError: string | null
  lastProbeAt: string | null
  accountEmail?: string | null
}

interface GoogleStatus {
  connected: boolean
  accountEmail: string | null
  calendarId: string | null
  scope: string | null
  expiresAt: string | null
}

interface TenantSettings {
  firmName: string | null
  attorneyName: string | null
  firmEmail: string | null
  firmPhone: string | null
  firmAddress: string | null
  defaultHourlyRateUsd: number | null
  defaultLlcFlatFeeUsd: number | null
  updatedAt: string | null
}

interface FirmSignature {
  signature: string | null
  enabled: boolean
  isDefault: boolean
  resolved: string
}

interface SignatureSettings {
  signature: FirmSignature
  sendAsDisplayName: string
}

// Firm booking rules (Contract L) — the constraints the public availability
// engine slices slots against. Mirrors the FirmBookingRules type in the legal
// vertical.
interface BookingRules {
  timezone: string
  bookableDays: number[]
  bookableHours: { start: number; end: number }
  slotGranularityMinutes: number
  bufferMinutes: number
  minLeadTimeHours: number
  defaultDurationMinutes: number
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Human 12-hour label for an hour-of-day (0–24). The booking engine still stores
// 0–23 start / 1–24 end internally; we only present them as real clock times.
function formatHour(h: number): string {
  if (h === 0 || h === 24) return '12:00 AM'
  if (h === 12) return '12:00 PM'
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`
}
const START_HOURS = Array.from({ length: 24 }, (_, h) => h) // 0–23
const END_HOURS = Array.from({ length: 24 }, (_, h) => h + 1) // 1–24

// Curated US timezones (this is a US law firm). The stored value is prepended if
// it falls outside the list, so the select never silently drops a real setting.
const TIMEZONES: [string, string][] = [
  ['America/New_York', 'Eastern (New York)'],
  ['America/Chicago', 'Central (Chicago)'],
  ['America/Denver', 'Mountain (Denver)'],
  ['America/Phoenix', 'Mountain — no DST (Phoenix)'],
  ['America/Los_Angeles', 'Pacific (Los Angeles)'],
  ['America/Anchorage', 'Alaska (Anchorage)'],
  ['Pacific/Honolulu', 'Hawaii (Honolulu)'],
]

const BUFFER_OPTIONS: [number, string][] = [
  [0, 'No buffer'],
  [5, '5 minutes'],
  [10, '10 minutes'],
  [15, '15 minutes'],
  [30, '30 minutes'],
  [45, '45 minutes'],
  [60, '1 hour'],
]
const LEAD_TIME_OPTIONS: [number, string][] = [
  [0, 'No minimum'],
  [1, '1 hour'],
  [2, '2 hours'],
  [4, '4 hours'],
  [12, '12 hours'],
  [24, '1 day'],
  [48, '2 days'],
  [72, '3 days'],
]

const PROVIDER_META: Record<Provider, { name: string }> = {
  google_calendar: { name: 'Google (Calendar & Email)' },
  anthropic: { name: 'Anthropic Claude' },
  openai: { name: 'OpenAI' },
  perplexity: { name: 'Perplexity' },
  granola: { name: 'Granola' },
  docusign: { name: 'DocuSign' },
}

// Deep links to where each provider issues API keys, surfaced as a
// "Find my API key →" link in the connect modal. These providers are API-key
// based — none offers an OAuth "log in to connect" flow for API access — so the
// help link is the best we can do until one does.
const API_KEY_HELP: Partial<Record<Provider, string>> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  perplexity: 'https://www.perplexity.ai/settings/api',
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<TenantSettings | null>(null)
  const [integrations, setIntegrations] = useState<IntegrationStatus[] | null>(null)
  const [google, setGoogle] = useState<GoogleStatus | null>(null)
  const [savedSettings, setSavedSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [connectingProvider, setConnectingProvider] = useState<ApiKeyProvider | null>(null)
  const [sig, setSig] = useState<SignatureSettings | null>(null)
  const [sigDraft, setSigDraft] = useState<string>('')
  const [sigEnabled, setSigEnabled] = useState<boolean>(true)
  const [savedSig, setSavedSig] = useState(false)
  const [bookingRules, setBookingRules] = useState<BookingRules | null>(null)
  const [savedRules, setSavedRules] = useState(false)
  // Firm details edit mode: the section is read-only until the attorney clicks
  // Edit, which swaps the static values for inputs.
  const [editingFirm, setEditingFirm] = useState(false)

  const refreshIntegrations = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<{ integrations: IntegrationStatus[] }>({
        toolName: 'legal.integration.list',
      })
      setIntegrations(r.integrations)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const refreshGoogle = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<{ status: GoogleStatus }>({ toolName: 'legal.google.status' })
      setGoogle(r.status)
    } catch {
      setGoogle({
        connected: false,
        accountEmail: null,
        calendarId: null,
        scope: null,
        expiresAt: null,
      })
    }
  }, [])

  const refreshSettings = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<{ settings: TenantSettings }>({
        toolName: 'legal.settings.get',
      })
      setSettings(r.settings)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const refreshSignature = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<SignatureSettings>({
        toolName: 'legal.settings.signature.get',
      })
      setSig(r)
      // Seed the editable draft with the stored text, or the firm-derived default
      // so the attorney edits from a sensible starting point rather than blank.
      setSigDraft(r.signature.signature ?? r.signature.resolved ?? '')
      setSigEnabled(r.signature.enabled)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const refreshBookingRules = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<{ rules: BookingRules }>({
        toolName: 'legal.booking_rules.get',
      })
      setBookingRules(r.rules)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    refreshSettings()
    refreshIntegrations()
    refreshGoogle()
    refreshSignature()
    refreshBookingRules()
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const err = params.get('google_error')
      if (err) setError(err)
    }
  }, [refreshSettings, refreshIntegrations, refreshGoogle, refreshSignature, refreshBookingRules])

  function updateField<K extends keyof TenantSettings>(key: K, value: TenantSettings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s))
    setSavedSettings(false)
  }

  function updateRule<K extends keyof BookingRules>(key: K, value: BookingRules[K]) {
    setBookingRules((r) => (r ? { ...r, [key]: value } : r))
    setSavedRules(false)
  }

  function toggleBookableDay(day: number) {
    setBookingRules((r) => {
      if (!r) return r
      const has = r.bookableDays.includes(day)
      const next = has ? r.bookableDays.filter((d) => d !== day) : [...r.bookableDays, day]
      return { ...r, bookableDays: next.sort((a, b) => a - b) }
    })
    setSavedRules(false)
  }

  async function saveBookingRules() {
    if (!bookingRules) return
    setBusy('booking_rules')
    setError(null)
    try {
      const r = await callAttorneyMcp<{ rules: BookingRules }>({
        toolName: 'legal.booking_rules.update',
        input: bookingRules,
      })
      setBookingRules(r.rules) // server clamps; reflect the canonical values back
      setSavedRules(true)
      setTimeout(() => setSavedRules(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function saveSettings() {
    if (!settings) return
    setBusy('settings')
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.settings.update',
        input: {
          firmName: settings.firmName,
          attorneyName: settings.attorneyName,
          firmEmail: settings.firmEmail,
          firmPhone: settings.firmPhone,
          firmAddress: settings.firmAddress,
        },
      })
      setEditingFirm(false)
      setSavedSettings(true)
      setTimeout(() => setSavedSettings(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function saveSignature() {
    setBusy('signature')
    setError(null)
    try {
      const r = await callAttorneyMcp<SignatureSettings>({
        toolName: 'legal.settings.signature.set',
        input: { signature: sigDraft, enabled: sigEnabled },
      })
      setSig(r)
      setSigDraft(r.signature.signature ?? r.signature.resolved ?? '')
      setSigEnabled(r.signature.enabled)
      setSavedSig(true)
      setTimeout(() => setSavedSig(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function connectGoogle() {
    // Per-attorney connect (migration 0016): the init route reads the connecting
    // attorney's tenantId + actorId from the verified session cookie, so the
    // credentials are stored under THIS attorney. We still check the session
    // client-side for a friendly "sign in first" message.
    const session = await fetchSession()
    if (!session) {
      setError('Sign in first, then connect your calendar.')
      return
    }
    setBusy('connect_google')
    const params = new URLSearchParams({
      mode: 'calendar',
      return_to: '/attorney/settings',
    })
    window.location.href = `/api/auth/google/init?${params.toString()}`
  }

  async function disconnectGoogle() {
    if (
      !confirm(
        'Disconnect Google? Bookings will stop sending calendar invites and client emails until reconnected.',
      )
    )
      return
    setBusy('disconnect_google')
    try {
      await callAttorneyMcp({ toolName: 'legal.google.disconnect' })
      await refreshGoogle()
      await refreshIntegrations()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  // Granola: per-attorney browser OAuth → MCP (WP1.2). Mirrors Google: redirect to
  // the server-side init route, which stores the connection under this attorney.
  async function connectGranola() {
    const session = await fetchSession()
    if (!session) {
      setError('Sign in first, then connect Granola.')
      return
    }
    setBusy('connect_granola')
    window.location.href = `/api/auth/granola/init?return_to=/attorney/settings`
  }

  async function disconnectGranola() {
    if (
      !confirm(
        'Disconnect Granola? Consultation transcripts will stop importing until reconnected.',
      )
    )
      return
    setBusy('disconnect_granola')
    try {
      await callAttorneyMcp({ toolName: 'legal.granola.disconnect' })
      await refreshIntegrations()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function handleDisconnect(provider: ApiKeyProvider) {
    if (!confirm(`Disconnect ${PROVIDER_META[provider].name}?`)) return
    setBusy(`disconnect_${provider}`)
    try {
      await callAttorneyMcp({ toolName: 'legal.integration.disconnect', input: { provider } })
      await refreshIntegrations()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  // Never silently drop a saved timezone that isn't in the curated list.
  const tzOptions: [string, string][] =
    bookingRules && !TIMEZONES.some(([tz]) => tz === bookingRules.timezone)
      ? [[bookingRules.timezone, bookingRules.timezone], ...TIMEZONES]
      : TIMEZONES

  return (
    <main>
      <PageHead
        title="Settings"
        description="Integrations, firm details, invoice template, email signature, and booking rules."
      />

      {error && <div className="alert alert-error">{error}</div>}

      <CollapsibleSection title="Integrations">
        {integrations === null ? (
          <div className="loading-block">
            <span className="spinner" /> Loading…
          </div>
        ) : (
          <div className="integration-grid">
            {integrations.map((i) => (
              <IntegrationCard
                key={i.provider}
                status={i}
                google={google}
                busy={busy}
                onConnectGoogle={connectGoogle}
                onDisconnectGoogle={disconnectGoogle}
                onConnectGranola={connectGranola}
                onDisconnectGranola={disconnectGranola}
                onConnectKey={() =>
                  i.provider !== 'google_calendar' &&
                  i.provider !== 'docusign' &&
                  setConnectingProvider(i.provider as ApiKeyProvider)
                }
                onDisconnectKey={() =>
                  i.provider !== 'google_calendar' &&
                  i.provider !== 'docusign' &&
                  handleDisconnect(i.provider as ApiKeyProvider)
                }
              />
            ))}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Firm details">
        {!settings ? (
          <div className="loading-block">
            <span className="spinner" /> Loading…
          </div>
        ) : (
          <>
            <div className="firm-details-actions">
              {editingFirm ? (
                <>
                  <button
                    onClick={() => {
                      setEditingFirm(false)
                      setError(null)
                      refreshSettings() // discard unsaved edits
                    }}
                    disabled={busy === 'settings'}
                  >
                    Cancel
                  </button>
                  <button className="primary" onClick={saveSettings} disabled={busy === 'settings'}>
                    {busy === 'settings' ? 'Saving…' : 'Save'}
                  </button>
                </>
              ) : (
                <button onClick={() => setEditingFirm(true)}>Edit</button>
              )}
            </div>
            {savedSettings && <div className="alert alert-success">Saved.</div>}
            {editingFirm ? (
              <>
                <div className="form-grid">
                  <label>
                    <span>Firm name</span>
                    <input
                      value={settings.firmName ?? ''}
                      onChange={(e) => updateField('firmName', e.target.value || null)}
                    />
                  </label>
                  <label>
                    <span>Lead attorney</span>
                    <input
                      value={settings.attorneyName ?? ''}
                      onChange={(e) => updateField('attorneyName', e.target.value || null)}
                    />
                  </label>
                  <label>
                    <span>Firm email</span>
                    <input
                      type="email"
                      value={settings.firmEmail ?? ''}
                      onChange={(e) => updateField('firmEmail', e.target.value || null)}
                    />
                  </label>
                  <label>
                    <span>Firm phone</span>
                    <input
                      type="tel"
                      value={settings.firmPhone ?? ''}
                      onChange={(e) => updateField('firmPhone', e.target.value || null)}
                    />
                  </label>
                </div>
                <label>
                  <span>Firm address</span>
                  <textarea
                    value={settings.firmAddress ?? ''}
                    onChange={(e) => updateField('firmAddress', e.target.value || null)}
                    rows={2}
                  />
                </label>
              </>
            ) : (
              <div className="kv-grid">
                <div>
                  <div className="kv-label">Firm name</div>
                  <div className="kv-value">{settings.firmName ?? '—'}</div>
                </div>
                <div>
                  <div className="kv-label">Lead attorney</div>
                  <div className="kv-value">{settings.attorneyName ?? '—'}</div>
                </div>
                <div>
                  <div className="kv-label">Firm email</div>
                  <div className="kv-value">{settings.firmEmail ?? '—'}</div>
                </div>
                <div>
                  <div className="kv-label">Firm phone</div>
                  <div className="kv-value">{settings.firmPhone ?? '—'}</div>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div className="kv-label">Firm address</div>
                  <div className="kv-value" style={{ whiteSpace: 'pre-wrap' }}>
                    {settings.firmAddress ?? '—'}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Invoice template">
        <InvoiceTemplateSection />
      </CollapsibleSection>

      <CollapsibleSection title="Email signature">
        {savedSig && (
          <div className="alert alert-success">Saved. New emails will use this signature.</div>
        )}
        {!sig ? (
          <div className="loading-block">
            <span className="spinner" /> Loading…
          </div>
        ) : (
          <>
            <p style={{ color: 'var(--muted)', margin: '0 0 var(--space-3)' }}>
              Appended automatically to every outbound client email — manual sends, replies, booking
              confirmations and invoices. Sent as <strong>{sig.sendAsDisplayName}</strong> from your
              connected Gmail.
            </p>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                marginBottom: 'var(--space-3)',
              }}
            >
              <input
                type="checkbox"
                checked={sigEnabled}
                onChange={(e) => {
                  setSigEnabled(e.target.checked)
                  setSavedSig(false)
                }}
                style={{ width: 'auto' }}
              />
              <span>Append a signature to outbound email</span>
            </label>
            <label>
              <span>Signature</span>
              <textarea
                value={sigDraft}
                onChange={(e) => {
                  setSigDraft(e.target.value)
                  setSavedSig(false)
                }}
                rows={5}
                disabled={!sigEnabled}
                placeholder={'Best regards,\nJuan Carlos Pacheco\nPacheco Law Firm'}
              />
            </label>
            {sigEnabled && sig.signature.isDefault && (
              <p
                style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: 'var(--space-2) 0 0' }}
              >
                Until you save your own, emails are signed with a signature derived from your firm
                details above.
              </p>
            )}
            {!sigEnabled && (
              <p
                style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: 'var(--space-2) 0 0' }}
              >
                Outbound email will not carry a signature.
              </p>
            )}
            <div className="firm-details-actions" style={{ marginTop: 'var(--space-4)' }}>
              <button className="primary" onClick={saveSignature} disabled={busy === 'signature'}>
                {busy === 'signature' ? 'Saving…' : 'Save signature'}
              </button>
            </div>
          </>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Booking rules">
        <p style={{ color: 'var(--muted)', marginTop: 0 }}>
          The public booking page offers times that fit these rules and the real Google calendar.
          Per-service durations (set on each service) override the default below.
        </p>
        {savedRules && <div className="alert alert-success">Saved.</div>}
        {!bookingRules ? (
          <div className="loading-block">
            <span className="spinner" /> Loading…
          </div>
        ) : (
          <>
            <label>
              <span>Bookable days</span>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {WEEKDAY_LABELS.map((label, day) => {
                  const on = bookingRules.bookableDays.includes(day)
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleBookableDay(day)}
                      className={on ? 'primary' : ''}
                      aria-pressed={on}
                      style={{ minWidth: '3.2rem' }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </label>
            <div className="form-grid">
              <label>
                <span>Bookable hours — start</span>
                <select
                  value={bookingRules.bookableHours.start}
                  onChange={(e) =>
                    updateRule('bookableHours', {
                      ...bookingRules.bookableHours,
                      start: Number(e.target.value),
                    })
                  }
                >
                  {START_HOURS.map((h) => (
                    <option key={h} value={h}>
                      {formatHour(h)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Bookable hours — end</span>
                <select
                  value={bookingRules.bookableHours.end}
                  onChange={(e) =>
                    updateRule('bookableHours', {
                      ...bookingRules.bookableHours,
                      end: Number(e.target.value),
                    })
                  }
                >
                  {END_HOURS.map((h) => (
                    <option key={h} value={h}>
                      {formatHour(h)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Buffer between calls</span>
                <select
                  value={bookingRules.bufferMinutes}
                  onChange={(e) => updateRule('bufferMinutes', Number(e.target.value))}
                >
                  {BUFFER_OPTIONS.map(([n, label]) => (
                    <option key={n} value={n}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Minimum notice before a booking</span>
                <select
                  value={bookingRules.minLeadTimeHours}
                  onChange={(e) => updateRule('minLeadTimeHours', Number(e.target.value))}
                >
                  {LEAD_TIME_OPTIONS.map(([n, label]) => (
                    <option key={n} value={n}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Default consultation length</span>
                <select
                  value={bookingRules.defaultDurationMinutes}
                  onChange={(e) => updateRule('defaultDurationMinutes', Number(e.target.value))}
                >
                  {[15, 30, 45, 60].map((n) => (
                    <option key={n} value={n}>
                      {n} minutes
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Timezone</span>
                <select
                  value={bookingRules.timezone}
                  onChange={(e) => updateRule('timezone', e.target.value)}
                >
                  {tzOptions.map(([tz, label]) => (
                    <option key={tz} value={tz}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="firm-details-actions" style={{ marginTop: 'var(--space-4)' }}>
              <button
                className="primary"
                onClick={saveBookingRules}
                disabled={busy === 'booking_rules'}
              >
                {busy === 'booking_rules' ? 'Saving…' : 'Save booking rules'}
              </button>
            </div>
          </>
        )}
      </CollapsibleSection>

      <CalendarCategoriesSection />

      <UsersRolesSection />

      <AiUsageSection />

      {connectingProvider && (
        <ConnectKeyModal
          provider={connectingProvider}
          onClose={() => setConnectingProvider(null)}
          onDone={async () => {
            setConnectingProvider(null)
            await refreshIntegrations()
          }}
        />
      )}
    </main>
  )
}

interface InvoiceTemplateConfig {
  firmName: string
  firmAddress: string
  firmPhone: string
  logoDataUrl: string | null
  accentColor: string
  columns: { matter: boolean; quantity: boolean; rate: boolean }
  headerNote: string
  paymentInstructions: string
}

function base64ToBlobUrl(base64: string, type = 'application/pdf'): string {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type }))
}

// Invoice template editor (Phase 3): edit the firm's invoice branding/content and
// see a live PDF preview rendered by the same engine that produces real invoices.
function InvoiceTemplateSection() {
  const [cfg, setCfg] = useState<InvoiceTemplateConfig | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const preview = useCallback(async (config: InvoiceTemplateConfig) => {
    setBusy('preview')
    try {
      const r = await callAttorneyMcp<{ pdf: { base64: string } }>({
        toolName: 'legal.invoice.template_preview',
        input: { config },
      })
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return base64ToBlobUrl(r.pdf.base64)
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    callAttorneyMcp<{ template: InvoiceTemplateConfig }>({
      toolName: 'legal.firm.get_invoice_template',
    })
      .then((r) => {
        setCfg(r.template)
        void preview(r.template)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [preview])

  function set<K extends keyof InvoiceTemplateConfig>(key: K, value: InvoiceTemplateConfig[K]) {
    setCfg((c) => (c ? { ...c, [key]: value } : c))
    setSaved(false)
  }

  async function onLogo(file: File | null) {
    if (!file) return set('logoDataUrl', null)
    if (file.size > 500_000) {
      setError('Logo is too large — use an image under 500 KB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => set('logoDataUrl', String(reader.result))
    reader.readAsDataURL(file)
  }

  async function save() {
    if (!cfg) return
    setBusy('save')
    setError(null)
    try {
      await callAttorneyMcp({ toolName: 'legal.firm.set_invoice_template', input: { config: cfg } })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      void preview(cfg)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (!cfg)
    return (
      <div className="loading-block">
        <span className="spinner" /> Loading…
      </div>
    )

  return (
    <>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Customize the invoice clients receive — branding and content. The preview on the right is
        the real PDF, rendered by the same engine that produces sent invoices.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {saved && <div className="alert alert-success">Saved.</div>}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-5)',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
        }}
      >
        <div style={{ flex: '1 1 320px', minWidth: 300 }}>
          <div className="form-grid">
            <label>
              <span>Firm name</span>
              <input value={cfg.firmName} onChange={(e) => set('firmName', e.target.value)} />
            </label>
            <label>
              <span>Accent color</span>
              <input
                type="color"
                value={cfg.accentColor}
                onChange={(e) => set('accentColor', e.target.value)}
                style={{ width: 60, padding: 2 }}
              />
            </label>
            <label>
              <span>Firm phone</span>
              <input value={cfg.firmPhone} onChange={(e) => set('firmPhone', e.target.value)} />
            </label>
          </div>
          <label>
            <span>Firm address</span>
            <textarea
              value={cfg.firmAddress}
              onChange={(e) => set('firmAddress', e.target.value)}
              rows={2}
            />
          </label>
          <label>
            <span>Logo (PNG/JPG, under 500 KB)</span>
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => void onLogo(e.target.files?.[0] ?? null)}
            />
          </label>
          {cfg.logoDataUrl && (
            <button
              onClick={() => set('logoDataUrl', null)}
              style={{ marginTop: 'var(--space-1)' }}
            >
              Remove logo
            </button>
          )}
          <fieldset className="svc-fieldset" style={{ marginTop: 'var(--space-3)' }}>
            <legend>Columns</legend>
            {(['matter', 'quantity', 'rate'] as const).map((col) => (
              <label
                key={col}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                <input
                  type="checkbox"
                  checked={cfg.columns[col]}
                  onChange={(e) => set('columns', { ...cfg.columns, [col]: e.target.checked })}
                  style={{ width: 'auto' }}
                />
                <span style={{ textTransform: 'capitalize' }}>{col}</span>
              </label>
            ))}
          </fieldset>
          <label>
            <span>Header note (optional)</span>
            <input value={cfg.headerNote} onChange={(e) => set('headerNote', e.target.value)} />
          </label>
          <label>
            <span>Footer / payment instructions</span>
            <textarea
              value={cfg.paymentInstructions}
              onChange={(e) => set('paymentInstructions', e.target.value)}
              rows={2}
            />
          </label>
          <div className="firm-details-actions" style={{ marginTop: 'var(--space-4)' }}>
            <button onClick={() => void preview(cfg)} disabled={busy === 'preview'}>
              {busy === 'preview' ? 'Rendering…' : 'Refresh preview'}
            </button>
            <button className="primary" onClick={save} disabled={busy === 'save'}>
              {busy === 'save' ? 'Saving…' : 'Save template'}
            </button>
          </div>
        </div>
        <div style={{ flex: '1 1 360px', minWidth: 320 }}>
          {previewUrl ? (
            <iframe
              title="Invoice preview"
              src={previewUrl}
              style={{ width: '100%', height: 520, border: '1px solid var(--border)' }}
            />
          ) : (
            <div className="loading-block">
              <span className="spinner" /> Rendering preview…
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function IntegrationCard({
  status,
  google,
  busy,
  onConnectGoogle,
  onDisconnectGoogle,
  onConnectGranola,
  onDisconnectGranola,
  onConnectKey,
  onDisconnectKey,
}: {
  status: IntegrationStatus
  google: GoogleStatus | null
  busy: string | null
  onConnectGoogle: () => void
  onDisconnectGoogle: () => void
  onConnectGranola: () => void
  onDisconnectGranola: () => void
  onConnectKey: () => void
  onDisconnectKey: () => void
}) {
  const meta = PROVIDER_META[status.provider]
  const isGoogle = status.provider === 'google_calendar'
  const isGranola = status.provider === 'granola'
  // Surface only the Google scopes that are NOT granted — empty when all live,
  // so a fully-connected Google account shows no scope noise at all.
  const scope = google?.scope ?? ''
  const missingGoogleScopes = isGoogle
    ? (
        [
          ['calendar.events', 'Calendar'],
          ['gmail.readonly', 'Email read'],
          ['gmail.send', 'Email send'],
        ] as const
      )
        .filter(([s]) => !scope.includes(s))
        .map(([, label]) => label)
    : []
  return (
    <div
      className={`integration-card ${status.connected ? 'connected' : ''} ${status.comingSoon ? 'coming-soon' : ''}`}
    >
      <div className="integration-card-main">
        <div className="integration-card-head">
          <div className="integration-card-title">{meta.name}</div>
          <Status status={status} />
        </div>

        {/* Google scope detail — silent when all scopes are granted; only the
            missing capability is surfaced, with a reconnect hint. */}
        {isGoogle && status.connected && google?.connected && missingGoogleScopes.length > 0 && (
          <div className="integration-card-warn">
            {missingGoogleScopes.join(', ')} not granted — reconnect to enable.
          </div>
        )}

        {status.lastVerifyError && (
          <div className="integration-card-error">{status.lastVerifyError}</div>
        )}

        {/* Probe-gated freshness (WP1.5): when a connection last passed a real
            capability check. 'Connected' only ever appears after a probe passes. */}
        {status.connected && status.lastProbeAt && (
          <div
            style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: 'var(--space-1)' }}
            title={status.lastProbeAt}
          >
            Last checked {new Date(status.lastProbeAt).toLocaleString()}
          </div>
        )}
      </div>

      <div className="integration-card-actions">
        {status.comingSoon && <button disabled>Coming soon</button>}
        {isGoogle &&
          !status.comingSoon &&
          (status.connected ? (
            <button
              className="danger outline"
              onClick={onDisconnectGoogle}
              disabled={busy === 'disconnect_google'}
            >
              {busy === 'disconnect_google' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : (
            <button
              className="primary"
              onClick={onConnectGoogle}
              disabled={busy === 'connect_google'}
            >
              {busy === 'connect_google' ? 'Redirecting…' : 'Connect Google'}
            </button>
          ))}
        {isGranola &&
          !status.comingSoon &&
          (status.connected ? (
            <button
              className="danger outline"
              onClick={onDisconnectGranola}
              disabled={busy === 'disconnect_granola'}
            >
              {busy === 'disconnect_granola' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : (
            <button
              className="primary"
              onClick={onConnectGranola}
              disabled={busy === 'connect_granola'}
            >
              {busy === 'connect_granola' ? 'Redirecting…' : 'Connect Granola'}
            </button>
          ))}
        {status.authKind === 'api_key' &&
          (status.connected ? (
            <>
              <button onClick={onConnectKey}>Replace key</button>
              <button
                className="danger outline"
                onClick={onDisconnectKey}
                disabled={busy === `disconnect_${status.provider}`}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button className="primary" onClick={onConnectKey}>
              Connect
            </button>
          ))}
      </div>
    </div>
  )
}

function Status({ status }: { status: IntegrationStatus }) {
  if (status.comingSoon) return <span className="integration-pill coming">Coming soon</span>
  if (!status.connected) return <span className="integration-pill off">Not connected</span>
  const label = status.accountEmail
    ? `Connected as ${status.accountEmail}`
    : status.lastFour
      ? `Connected · …${status.lastFour}`
      : 'Connected'
  return <span className="integration-pill on">{label}</span>
}

function ConnectKeyModal({
  provider,
  onClose,
  onDone,
}: {
  provider: ApiKeyProvider
  onClose: () => void
  onDone: () => void
}) {
  const meta = PROVIDER_META[provider]
  const keyHelpUrl = API_KEY_HELP[provider]
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!apiKey.trim()) {
      setError('Paste an API key first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const input: { provider: ApiKeyProvider; apiKey: string } = {
        provider,
        apiKey: apiKey.trim(),
      }
      const r = await callAttorneyMcp<{ ok: boolean; error?: string }>({
        toolName: 'legal.integration.connect',
        input,
      })
      if (!r.ok) {
        setError(r.error ?? 'Failed to verify the key.')
        return
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Connect {meta.name}</h2>
          <button onClick={onClose} aria-label="Close" className="modal-close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--muted)' }}>
            Paste your API key. We&apos;ll verify it with {meta.name} before saving.
          </p>
          <label>
            <span>API key</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              autoFocus
            />
          </label>
          {keyHelpUrl && (
            <a
              href={keyHelpUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-block', fontSize: '0.82rem', marginTop: '-0.3rem' }}
            >
              Find my {meta.name} API key →
            </a>
          )}
          {error && <div className="alert alert-error">{error}</div>}
        </div>
        <div className="modal-foot">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={save} disabled={busy}>
            {busy ? 'Verifying…' : 'Test & save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Calendar categories (the color palette for consultation call-types) ───────
// Self-contained: fetches + saves the firm's `firm.calendar_categories` palette
// (config-as-data, versioned + audited via legal.calendar.categories.set). The
// server normalizes — derives stable keys, dedupes, validates hex — so the editor
// stays a thin UI. Existing rows keep their key, so already-tagged consultations
// stay linked when a label is renamed.
interface EditCategory {
  key: string
  label: string
  color: string
}
function slugifyKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
function CalendarCategoriesSection() {
  const [cats, setCats] = useState<EditCategory[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<{ categories: EditCategory[] }>({
        toolName: 'legal.calendar.categories.get',
      })
      setCats(r.categories)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])

  function update(i: number, patch: Partial<EditCategory>) {
    setCats((c) => (c ? c.map((cat, idx) => (idx === i ? { ...cat, ...patch } : cat)) : c))
    setSaved(false)
  }
  function remove(i: number) {
    setCats((c) => (c ? c.filter((_, idx) => idx !== i) : c))
    setSaved(false)
  }
  function add() {
    setCats((c) => [...(c ?? []), { key: '', label: '', color: '#2563eb' }])
    setSaved(false)
  }

  async function save() {
    if (!cats) return
    // Derive a stable key for new rows; existing rows keep theirs (server dedupes).
    const prepared = cats
      .map((c) => ({ ...c, label: c.label.trim(), key: c.key || slugifyKey(c.label) }))
      .filter((c) => c.label && c.key)
    setBusy(true)
    setError(null)
    try {
      const r = await callAttorneyMcp<{ categories: EditCategory[] }>({
        toolName: 'legal.calendar.categories.set',
        input: { categories: prepared },
      })
      setCats(r.categories)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <CollapsibleSection title="Calendar categories">
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Color-code consultations by call type. Tag any event with one of these from its edit menu on
        the calendar.
      </p>
      {saved && <div className="alert alert-success">Saved.</div>}
      {error && <div className="alert alert-error">{error}</div>}
      {!cats ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {cats.length === 0 && (
              <p className="text-muted text-sm" style={{ margin: 0 }}>
                No categories yet. Add one below.
              </p>
            )}
            {cats.map((cat, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  flexWrap: 'wrap',
                }}
              >
                <input
                  type="color"
                  value={cat.color}
                  onChange={(e) => update(i, { color: e.target.value })}
                  aria-label="Color"
                  style={{
                    width: '2.4rem',
                    height: '2.2rem',
                    padding: 0,
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                  }}
                />
                <input
                  type="text"
                  value={cat.label}
                  placeholder="e.g. Court appearance"
                  onChange={(e) => update(i, { label: e.target.value })}
                  style={{ flex: 1, minWidth: '12rem' }}
                />
                <button type="button" onClick={() => remove(i)} aria-label="Remove category">
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div
            className="firm-details-actions"
            style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' }}
          >
            <button type="button" onClick={add}>
              + Add category
            </button>
            <button className="primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save categories'}
            </button>
          </div>
        </>
      )}
    </CollapsibleSection>
  )
}
