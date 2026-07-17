'use client'

// Settings → Integrations (WP-G). Split out of the old settings monolith —
// same MCP tools, same connect flows, restyled to the comp's favicon-tile
// provider cards. Google and Granola are per-attorney OAuth connects; the
// rest are API-key based; DocuSign plus four research-tool tiles
// (LexisNexis / Westlaw / PACER / Fastcase) are coming soon.
import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { formatDateTime } from '@/lib/datetime'
import { fetchSession } from '@/lib/auth'
import { SettingsHeader, SettingsLoading, SettingsAlert } from '../shared'

type Provider = 'google_calendar' | 'anthropic' | 'openai' | 'perplexity' | 'granola' | 'docusign'

// google_calendar AND granola are OAuth providers (connect via a browser flow),
// docusign is coming-soon — the rest are api-key.
type ApiKeyProvider = Exclude<Provider, 'google_calendar' | 'docusign' | 'granola'>

interface IntegrationStatus {
  provider: Provider
  authKind: 'api_key' | 'oauth' | 'coming_soon'
  connected: boolean
  comingSoon?: boolean
  // Honest-capability note (e.g. key stored but no feature consumes it yet).
  note?: string
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

const PROVIDER_META: Record<Provider, { name: string; domain: string }> = {
  google_calendar: { name: 'Google (Calendar & Email)', domain: 'google.com' },
  anthropic: { name: 'Anthropic Claude', domain: 'anthropic.com' },
  openai: { name: 'OpenAI', domain: 'openai.com' },
  perplexity: { name: 'Perplexity', domain: 'perplexity.ai' },
  granola: { name: 'Granola', domain: 'granola.ai' },
  docusign: { name: 'DocuSign', domain: 'docusign.com' },
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

// Static "coming soon" legal-research tools the comp shows alongside the real
// connectable integrations. No backing provider exists for these yet, so
// they're disabled tiles rather than a stubbed connect flow.
const COMING_SOON_TILES: { name: string; domain: string; note: string }[] = [
  {
    name: 'LexisNexis',
    domain: 'lexisnexis.com',
    note: "Case law, statutes & Shepard's citations.",
  },
  { name: 'Westlaw', domain: 'thomsonreuters.com', note: 'Legal research & KeyCite validation.' },
  { name: 'PACER', domain: 'pacer.uscourts.gov', note: 'Federal court records & docket access.' },
  { name: 'Fastcase', domain: 'fastcase.com', note: 'Legal research library.' },
]

function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?sz=64&domain=${domain}`
}

export default function IntegrationsPage(): React.ReactElement {
  const [integrations, setIntegrations] = useState<IntegrationStatus[] | null>(null)
  const [google, setGoogle] = useState<GoogleStatus | null>(null)
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

  useEffect(() => {
    refreshIntegrations()
    refreshGoogle()
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const err = params.get('google_error')
      if (err) setError(err)
    }
  }, [refreshIntegrations, refreshGoogle])

  async function connectGoogle(): Promise<void> {
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
      return_to: '/attorney/settings/integrations',
    })
    window.location.href = `/api/auth/google/init?${params.toString()}`
  }

  async function disconnectGoogle(): Promise<void> {
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
  async function connectGranola(): Promise<void> {
    const session = await fetchSession()
    if (!session) {
      setError('Sign in first, then connect Granola.')
      return
    }
    setBusy('connect_granola')
    window.location.href = `/api/auth/granola/init?return_to=/attorney/settings/integrations`
  }

  async function disconnectGranola(): Promise<void> {
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

  async function handleDisconnect(provider: ApiKeyProvider): Promise<void> {
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
    <>
      <SettingsHeader title="Integrations" />
      {error && <SettingsAlert tone="error">{error}</SettingsAlert>}
      {integrations === null ? (
        <SettingsLoading />
      ) : (
        <div className="li-set-integ-list">
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
          {COMING_SOON_TILES.map((t) => (
            <ComingSoonCard key={t.name} name={t.name} domain={t.domain} note={t.note} />
          ))}
        </div>
      )}

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
}): React.ReactElement {
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
    <div className={`li-set-integ-row${status.comingSoon ? ' is-coming' : ''}`}>
      <span className="li-set-integ-logo">
        <img src={faviconUrl(meta.domain)} alt="" width={26} height={26} />
      </span>
      <div className="li-set-integ-main">
        <div className="li-set-integ-name">{meta.name}</div>
        <div className="li-set-integ-meta">
          <Status status={status} />
          {status.note && <span className="li-set-integ-sep">· {status.note}</span>}
          {status.connected && status.lastProbeAt && (
            <span className="li-set-integ-sep" title={status.lastProbeAt}>
              · Last checked {formatDateTime(status.lastProbeAt)}
            </span>
          )}
        </div>

        {/* Google scope detail — silent when all scopes are granted; only the
            missing capability is surfaced, with a reconnect hint. */}
        {isGoogle && status.connected && google?.connected && missingGoogleScopes.length > 0 && (
          <div className="li-set-integ-warn">
            {missingGoogleScopes.join(', ')} not granted — reconnect to enable.
          </div>
        )}

        {status.lastVerifyError && (
          <div className="li-set-integ-error">{status.lastVerifyError}</div>
        )}
      </div>

      <div className="li-set-integ-actions">
        {status.comingSoon && (
          <button className="li-set-btn" disabled>
            Coming soon
          </button>
        )}
        {isGoogle &&
          !status.comingSoon &&
          (status.connected ? (
            <button
              className="li-set-btn li-set-btn-danger"
              onClick={onDisconnectGoogle}
              disabled={busy === 'disconnect_google'}
            >
              {busy === 'disconnect_google' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : (
            <button
              className="li-set-btn li-set-btn-primary"
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
              className="li-set-btn li-set-btn-danger"
              onClick={onDisconnectGranola}
              disabled={busy === 'disconnect_granola'}
            >
              {busy === 'disconnect_granola' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : (
            <button
              className="li-set-btn li-set-btn-primary"
              onClick={onConnectGranola}
              disabled={busy === 'connect_granola'}
            >
              {busy === 'connect_granola' ? 'Redirecting…' : 'Connect Granola'}
            </button>
          ))}
        {status.authKind === 'api_key' &&
          (status.connected ? (
            <>
              <button className="li-set-btn" onClick={onConnectKey}>
                Replace key
              </button>
              <button
                className="li-set-btn li-set-btn-danger"
                onClick={onDisconnectKey}
                disabled={busy === `disconnect_${status.provider}`}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button className="li-set-btn li-set-btn-primary" onClick={onConnectKey}>
              Connect
            </button>
          ))}
      </div>
    </div>
  )
}

function Status({ status }: { status: IntegrationStatus }): React.ReactElement {
  if (status.comingSoon)
    return (
      <span className="li-set-integ-pill coming">
        <span className="li-set-dot" />
        Coming soon
      </span>
    )
  if (!status.connected)
    return (
      <span className="li-set-integ-pill off">
        <span className="li-set-dot" />
        Not connected
      </span>
    )
  const label = status.accountEmail
    ? `Connected as ${status.accountEmail}`
    : status.lastFour
      ? `Connected · …${status.lastFour}`
      : 'Connected'
  return (
    <span className="li-set-integ-pill on">
      <span className="li-set-dot" />
      {label}
    </span>
  )
}

function ComingSoonCard({
  name,
  domain,
  note,
}: {
  name: string
  domain: string
  note: string
}): React.ReactElement {
  return (
    <div className="li-set-integ-row is-coming">
      <span className="li-set-integ-logo">
        <img src={faviconUrl(domain)} alt="" width={26} height={26} />
      </span>
      <div className="li-set-integ-main">
        <div className="li-set-integ-name">{name}</div>
        <div className="li-set-integ-meta">
          <span className="li-set-integ-pill coming">
            <span className="li-set-dot" />
            Coming soon
          </span>
          <span className="li-set-integ-sep">· {note}</span>
        </div>
      </div>
      <div className="li-set-integ-actions">
        <button className="li-set-btn" disabled>
          Coming soon
        </button>
      </div>
    </div>
  )
}

function ConnectKeyModal({
  provider,
  onClose,
  onDone,
}: {
  provider: ApiKeyProvider
  onClose: () => void
  onDone: () => void
}): React.ReactElement {
  const meta = PROVIDER_META[provider]
  const keyHelpUrl = API_KEY_HELP[provider]
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
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
            <X size={18} aria-hidden />
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
          <button className="li-set-btn li-set-btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Verifying…' : 'Test & save'}
          </button>
        </div>
      </div>
    </div>
  )
}
