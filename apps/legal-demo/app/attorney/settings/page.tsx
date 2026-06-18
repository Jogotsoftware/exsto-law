'use client'

import { useCallback, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { fetchSession } from '@/lib/auth'

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

const PROVIDER_META: Record<Provider, { name: string; desc: string }> = {
  google_calendar: {
    name: 'Google (Calendar & Email)',
    desc: 'One connection covers everything: booking-page availability, Google Calendar invites, reading client email threads, and sending email from your Gmail.',
  },
  anthropic: {
    name: 'Anthropic Claude',
    desc: 'Your own Anthropic API key for drafting (overrides the platform default).',
  },
  openai: {
    name: 'OpenAI',
    desc: 'OpenAI API key for ChatGPT-powered features and fallback drafting.',
  },
  perplexity: {
    name: 'Perplexity',
    desc: 'Perplexity API key for research inside the attorney workspace.',
  },
  granola: {
    name: 'Granola',
    desc: 'Auto-record and transcribe consultation calls into the matter timeline.',
  },
  docusign: {
    name: 'DocuSign',
    desc: 'Coming soon — native e-signature is in active development.',
  },
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

  useEffect(() => {
    refreshSettings()
    refreshIntegrations()
    refreshGoogle()
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const err = params.get('google_error')
      if (err) setError(err)
    }
  }, [refreshSettings, refreshIntegrations, refreshGoogle])

  function updateField<K extends keyof TenantSettings>(key: K, value: TenantSettings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s))
    setSavedSettings(false)
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
          defaultHourlyRateUsd: settings.defaultHourlyRateUsd,
          defaultLlcFlatFeeUsd: settings.defaultLlcFlatFeeUsd,
        },
      })
      setSavedSettings(true)
      setTimeout(() => setSavedSettings(false), 2000)
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

  return (
    <main>
      <div className="attorney-page-head">
        <h1>Settings</h1>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <section>
        <h2>Integrations</h2>
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
      </section>

      <section>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '0.85rem' }}
        >
          <h2 style={{ margin: 0 }}>Firm</h2>
          <button
            className="primary"
            onClick={saveSettings}
            disabled={busy === 'settings' || !settings}
            style={{ marginLeft: 'auto' }}
          >
            {busy === 'settings' ? 'Saving…' : 'Save firm + defaults'}
          </button>
        </div>
        {savedSettings && (
          <div
            className="alert"
            style={{ background: 'var(--ok-soft)', color: '#166534', border: '1px solid #86efac' }}
          >
            Saved.
          </div>
        )}
        {!settings ? (
          <div className="loading-block">
            <span className="spinner" /> Loading…
          </div>
        ) : (
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
        )}
      </section>

      <section>
        <h2>Defaults</h2>
        {settings && (
          <div className="form-grid">
            <label>
              <span>Default hourly rate (USD)</span>
              <input
                type="number"
                inputMode="decimal"
                value={settings.defaultHourlyRateUsd ?? ''}
                onChange={(e) =>
                  updateField(
                    'defaultHourlyRateUsd',
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
              />
            </label>
            <label>
              <span>Default NC LLC flat fee (USD)</span>
              <input
                type="number"
                inputMode="decimal"
                value={settings.defaultLlcFlatFeeUsd ?? ''}
                onChange={(e) =>
                  updateField(
                    'defaultLlcFlatFeeUsd',
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
              />
            </label>
          </div>
        )}
      </section>

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
  return (
    <div
      className={`integration-card ${status.connected ? 'connected' : ''} ${status.comingSoon ? 'coming-soon' : ''}`}
    >
      <div className="integration-card-head">
        <div className="integration-card-title">{meta.name}</div>
        <Status status={status} />
      </div>
      <div className="integration-card-desc">{meta.desc}</div>

      {/* Google scope detail — one connection should show calendar + email read
          + email send all granted. A legacy connection missing email read shows
          a reconnect hint. */}
      {isGoogle && status.connected && google?.connected && (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.2rem' }}>
          {(google.scope ?? '').includes('calendar.events') ? (
            <span className="badge ok">Calendar ✓</span>
          ) : (
            <span className="badge danger">Calendar missing</span>
          )}
          {(google.scope ?? '').includes('gmail.readonly') ? (
            <span className="badge ok">Email read ✓</span>
          ) : (
            <span className="badge warn">Email read not granted — reconnect to enable</span>
          )}
          {(google.scope ?? '').includes('gmail.send') ? (
            <span className="badge ok">Email send ✓</span>
          ) : (
            <span className="badge warn">Email send not granted — reconnect to enable</span>
          )}
        </div>
      )}

      {status.lastVerifyError && (
        <div className="integration-card-error">{status.lastVerifyError}</div>
      )}

      {/* Probe-gated freshness (WP1.5): when a connection last passed a real
          capability check. 'Connected' only ever appears after a probe passes. */}
      {status.connected && status.lastProbeAt && (
        <div
          style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.3rem' }}
          title={status.lastProbeAt}
        >
          Last checked {new Date(status.lastProbeAt).toLocaleString()}
        </div>
      )}

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
          <h2 style={{ margin: 0 }}>Connect {meta.name}</h2>
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
