'use client'

// Settings → Firm details (WP-G, + WP A1). Split out of the old settings
// monolith — same legal.settings.get / legal.settings.firm_profile.set tools,
// restyled to the comp's logo + kv-grid card. The logo itself isn't owned here:
// it's read from the invoice template config (the one place it's uploaded) so
// this card can surface it without duplicating the uploader — "Replace logo"
// links to Settings → Invoice template.
//
// WP A1 adds: lead attorney name (now editable — it used to come from the
// approving attorney's account only), home jurisdiction (the fallback rung
// resolveMatterJurisdiction reads when a matter has no override — a per-matter
// fact, editable on the matter's Overview page, always wins over this), and
// practice areas (a simple comma-separated list, shown as chips).
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { SettingsHeader, SettingsLoading, SettingsAlert } from '../shared'
import { US_STATE_OPTIONS } from '@/lib/usStates'

interface TenantSettings {
  firmName: string | null
  attorneyName: string | null
  firmEmail: string | null
  firmPhone: string | null
  firmAddress: string | null
  firmJurisdiction: string | null
  practiceAreas: string[] | null
  defaultHourlyRateUsd: number | null
  defaultLlcFlatFeeUsd: number | null
  updatedAt: string | null
}

// The practice-areas edit field is a single comma-separated text input (simplest
// control for a small free-text list); this turns it into a clean string[] for
// save, and back into a display string for the input's own value while editing.
function parsePracticeAreasInput(text: string): string[] {
  return [
    ...new Set(
      text
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ]
}

export default function FirmDetailsPage(): React.ReactElement {
  const [settings, setSettings] = useState<TenantSettings | null>(null)
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [editing, setEditing] = useState(false)
  // Free-text edit buffer for practice areas (comma-separated); parsed to
  // string[] only on save. Kept separate from `settings.practiceAreas` so the
  // input doesn't fight the user over trailing commas/spaces while typing.
  const [practiceAreasText, setPracticeAreasText] = useState('')

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
    // Read-only: the firm logo lives on the invoice template config, the one
    // place it's uploaded (Settings → Invoice template).
    callAttorneyMcp<{ template: { logoDataUrl: string | null } }>({
      toolName: 'legal.firm.get_invoice_template',
    })
      .then((r) => setLogoDataUrl(r.template.logoDataUrl))
      .catch(() => setLogoDataUrl(null))
  }, [refreshSettings])

  function updateField<K extends keyof TenantSettings>(key: K, value: TenantSettings[K]): void {
    setSettings((s) => (s ? { ...s, [key]: value } : s))
    setSaved(false)
  }

  async function save(): Promise<void> {
    if (!settings) return
    setBusy(true)
    setError(null)
    try {
      // P13 (+ WP A1) — firm identity persists as substrate config on the
      // firm_profile record (legal.settings.firm_profile.set); the old
      // legal.settings.update path never saved. Values reload via
      // legal.settings.get, which reads the profile first. Empty string ([] for
      // practice areas) clears a field. firmJurisdiction is validated server-side
      // (must normalize to a US state code or be empty) — an unrecognized value
      // surfaces as the caught error below, nothing is silently stored.
      await callAttorneyMcp({
        toolName: 'legal.settings.firm_profile.set',
        input: {
          firmName: settings.firmName ?? '',
          firmEmail: settings.firmEmail ?? '',
          firmPhone: settings.firmPhone ?? '',
          firmAddress: settings.firmAddress ?? '',
          attorneyName: settings.attorneyName ?? '',
          firmJurisdiction: settings.firmJurisdiction ?? '',
          practiceAreas: parsePracticeAreasInput(practiceAreasText),
        },
      })
      await refreshSettings()
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingsHeader title="Firm details" />
      {error && <SettingsAlert tone="error">{error}</SettingsAlert>}

      {!settings ? (
        <SettingsLoading />
      ) : (
        <div className="li-set-card">
          <div className="li-set-firm-head">
            <span className="li-set-firm-logo">
              {logoDataUrl ? (
                <img src={logoDataUrl} alt="" />
              ) : (
                <svg
                  width="34"
                  height="34"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#d8c084"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 3v18" />
                  <path d="M7 21h10" />
                  <path d="M4 7h16" />
                  <path d="M7 4.5 4 12a3 3 0 0 0 6 0L7 4.5Z" />
                  <path d="M17 4.5 14 12a3 3 0 0 0 6 0l-3-7.5Z" />
                  <circle cx="12" cy="3" r="1.3" fill="#d8c084" />
                </svg>
              )}
            </span>
            <div className="li-set-firm-head-text">
              <div className="li-set-firm-name">{settings.firmName ?? 'Your firm'}</div>
              <div className="li-set-firm-sub">
                Firm logo — shown on documents, invoices, and the client portal
              </div>
            </div>
            <Link href="/attorney/settings/invoice-template" className="li-set-btn">
              Replace logo
            </Link>
          </div>

          {saved && <SettingsAlert tone="success">Saved.</SettingsAlert>}

          {!editing && (
            <div
              className="li-set-actions-row"
              style={{ justifyContent: 'flex-end', marginTop: 0 }}
            >
              <button
                className="li-set-btn"
                onClick={() => {
                  setPracticeAreasText((settings.practiceAreas ?? []).join(', '))
                  setEditing(true)
                }}
              >
                Edit
              </button>
            </div>
          )}

          {editing ? (
            <>
              <div className="li-set-form-grid" style={{ marginTop: 16 }}>
                <label className="li-set-label">
                  <span>Firm name</span>
                  <input
                    className="li-set-input"
                    value={settings.firmName ?? ''}
                    onChange={(e) => updateField('firmName', e.target.value || null)}
                  />
                </label>
                <label className="li-set-label">
                  <span>Firm email</span>
                  <input
                    className="li-set-input"
                    type="email"
                    value={settings.firmEmail ?? ''}
                    onChange={(e) => updateField('firmEmail', e.target.value || null)}
                  />
                </label>
                <label className="li-set-label">
                  <span>Firm phone</span>
                  <input
                    className="li-set-input"
                    type="tel"
                    value={settings.firmPhone ?? ''}
                    onChange={(e) => updateField('firmPhone', e.target.value || null)}
                  />
                </label>
                <label className="li-set-label">
                  <span>Lead attorney</span>
                  <input
                    className="li-set-input"
                    value={settings.attorneyName ?? ''}
                    onChange={(e) => updateField('attorneyName', e.target.value || null)}
                  />
                </label>
                <label className="li-set-label">
                  <span>Home jurisdiction</span>
                  <select
                    className="li-set-select"
                    value={settings.firmJurisdiction ?? ''}
                    onChange={(e) => updateField('firmJurisdiction', e.target.value || null)}
                  >
                    <option value="">Not set</option>
                    {US_STATE_OPTIONS.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="li-set-label">
                  <span>Practice areas</span>
                  <input
                    className="li-set-input"
                    placeholder="e.g. business law, estate planning"
                    value={practiceAreasText}
                    onChange={(e) => {
                      setPracticeAreasText(e.target.value)
                      setSaved(false)
                    }}
                  />
                </label>
              </div>
              <label className="li-set-label">
                <span>Firm address</span>
                <textarea
                  className="li-set-textarea"
                  value={settings.firmAddress ?? ''}
                  onChange={(e) => updateField('firmAddress', e.target.value || null)}
                  rows={2}
                />
              </label>
              <p className="li-set-hint">
                These fields fill the firm identity on generated documents and letterheads. The home
                jurisdiction is the firm-wide fallback — each matter carries its own governing law
                (from intake, editable on the matter page), which always wins. Practice areas are
                comma-separated.
              </p>
              <div className="li-set-actions-row">
                <button
                  className="li-set-btn"
                  onClick={() => {
                    setEditing(false)
                    setError(null)
                    refreshSettings()
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button className="li-set-btn li-set-btn-primary" onClick={save} disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          ) : (
            <div className="li-set-kv-grid" style={{ marginTop: 16 }}>
              <div>
                <div className="li-set-kv-label">Firm name</div>
                <div className="li-set-kv-value">{settings.firmName ?? '—'}</div>
              </div>
              <div>
                <div className="li-set-kv-label">Lead attorney</div>
                <div className="li-set-kv-value">{settings.attorneyName ?? '—'}</div>
              </div>
              <div>
                <div className="li-set-kv-label">Firm email</div>
                <div className="li-set-kv-value">{settings.firmEmail ?? '—'}</div>
              </div>
              <div>
                <div className="li-set-kv-label">Firm phone</div>
                <div className="li-set-kv-value">{settings.firmPhone ?? '—'}</div>
              </div>
              <div>
                <div className="li-set-kv-label">Home jurisdiction</div>
                <div className="li-set-kv-value">
                  {settings.firmJurisdiction
                    ? (US_STATE_OPTIONS.find((s) => s.code === settings.firmJurisdiction)?.name ??
                      settings.firmJurisdiction)
                    : 'Not set'}
                </div>
              </div>
              <div>
                <div className="li-set-kv-label">Practice areas</div>
                <div className="li-set-kv-value">
                  {settings.practiceAreas?.length ? (
                    <span className="li-set-pareas">
                      {settings.practiceAreas.map((a) => (
                        <span key={a} className="li-set-parea-chip">
                          {a}
                        </span>
                      ))}
                    </span>
                  ) : (
                    '—'
                  )}
                </div>
              </div>
              <div className="li-set-kv-full">
                <div className="li-set-kv-label">Firm address</div>
                <div className="li-set-kv-value">{settings.firmAddress ?? '—'}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
