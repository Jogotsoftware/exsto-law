'use client'

// Settings → Firm details (WP-G, + WP A1). Split out of the old settings
// monolith — same legal.settings.get / legal.settings.firm_profile.set tools,
// restyled to the comp's logo + kv-grid card.
//
// FIRM-BRANDING-1 — this page now OWNS the firm's visual identity. The logo used
// to live on the invoice template config and "Replace logo" sent the attorney to
// Settings → Invoice template to change it, which is backwards: the logo is a
// firm fact the invoice consumes. It is uploaded here (firm_logo on the
// firm_profile singleton, migration 0202, saved through the same
// legal.settings.firm_profile.set action as every other field on this card),
// next to the brand color, and everything else — console header, client portal,
// booking funnel, public landing page, signing pages, invoice PDF — reads it.
//
// WP A1 adds: lead attorney name (now editable — it used to come from the
// approving attorney's account only), home jurisdiction (the fallback rung
// resolveMatterJurisdiction reads when a matter has no override — a per-matter
// fact, editable on the matter's Overview page, always wins over this), and
// practice areas.
// ITEM-12 WP-2 — the practice-areas comma-separated text input is now a
// TagInput pill editor (components/TagInput.tsx), the same Enter-to-add
// control as Settings → Assistant's three instruction cards. It edits
// `settings.practiceAreas` directly (same in-place pattern as firmName/
// firmEmail/etc. below via updateField) rather than through a separate
// comma-parsed text buffer — save() already sent a plain string[] here, so
// swapping the control is a drop-in change.
import { useCallback, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { refreshFirmBranding, setFirmBrandingLocal, useFirmBranding } from '@/lib/firmBranding'
import { measureLogoTone } from '@/lib/brandColor'
import { TagInput } from '@/components/TagInput'
import { ColorWheelField } from '@/components/ColorWheelField'
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
  headerColor: string | null
  // FIRM-LANDING-2 — public landing page copy (tagline + about paragraph).
  tagline: string | null
  about: string | null
  defaultHourlyRateUsd: number | null
  defaultLlcFlatFeeUsd: number | null
  updatedAt: string | null
}

// The uploader's client-side ceiling. The action layer enforces its own cap
// (handlers/firmProfile.ts) — this one exists so a too-large file is refused
// before it is base64'd and posted, with a message that names the limit.
const MAX_LOGO_BYTES = 500_000

export default function FirmDetailsPage(): React.ReactElement {
  const [settings, setSettings] = useState<TenantSettings | null>(null)
  // The SAVED logo (shared store — also what the header bar is rendering).
  const branding = useFirmBranding()
  const savedLogo = branding.logoDataUrl
  // The logo as edited on this card; `undefined` = untouched this session.
  const [logoDraft, setLogoDraft] = useState<string | null | undefined>(undefined)
  const [logoToneDraft, setLogoToneDraft] = useState<'light' | 'dark' | null>(null)
  const logoDataUrl = logoDraft === undefined ? savedLogo : logoDraft
  const logoTone = logoDraft === undefined ? branding.logoTone : logoToneDraft
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [editing, setEditing] = useState(false)

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
  }, [refreshSettings])

  // Read the chosen file as a data URL. Rejected sizes/types never reach state,
  // so Save can't post something the action layer will bounce.
  async function onLogoFile(file: File | null): Promise<void> {
    if (!file) return
    if (file.size > MAX_LOGO_BYTES) {
      setError(`That logo is ${Math.round(file.size / 1000)} KB — use an image under 500 KB.`)
      return
    }
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      setError('Use a PNG, JPG, GIF or WEBP image.')
      return
    }
    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    })
    if (!dataUrl) {
      setError('That file could not be read.')
      return
    }
    setError(null)
    setLogoDraft(dataUrl)
    // Measure the artwork once, here, so every surface (including the
    // server-rendered invoice PDF) knows whether it needs a dark or a light
    // backdrop instead of guessing. See measureLogoTone.
    setLogoToneDraft(await measureLogoTone(dataUrl))
    setSaved(false)
  }

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
          practiceAreas: settings.practiceAreas ?? [],
          headerColor: settings.headerColor ?? '',
          tagline: settings.tagline ?? '',
          about: settings.about ?? '',
          // Untouched this session ⇒ omit, so a save of the text fields never
          // rewrites the logo; '' clears it.
          ...(logoDraft !== undefined
            ? { logoDataUrl: logoDraft ?? '', logoTone: logoToneDraft ?? '' }
            : {}),
        },
      })
      await refreshSettings()
      // Repaint the console header/rail (and every other branding consumer)
      // from the authoritative value — no reload needed.
      await refreshFirmBranding()
      setLogoDraft(undefined)
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
      <SettingsHeader title="Firm Details" />
      {error && <SettingsAlert tone="error">{error}</SettingsAlert>}

      {!settings ? (
        <SettingsLoading />
      ) : (
        <div className="li-set-card">
          <div className="li-set-firm-head">
            <span
              className={`li-set-firm-logo${logoDataUrl ? ' has-logo' : ''}${
                logoDataUrl && logoTone === 'dark' ? ' on-light' : ''
              }`}
            >
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
                Firm logo — shown on your console header, your client portal, your booking page and
                your invoices
              </div>
            </div>
            <div className="li-set-firm-head-actions">
              {/* A label wrapping a visually-hidden file input: the native
                  control is unstyleable and looked out of place next to every
                  other button on this page. */}
              <label className="li-set-btn li-set-filebtn">
                {logoDataUrl ? 'Replace logo' : 'Upload logo'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={(e) => {
                    onLogoFile(e.target.files?.[0] ?? null)
                    e.target.value = ''
                  }}
                />
              </label>
              {logoDataUrl && (
                <button
                  type="button"
                  className="li-set-btn li-set-btn-sm"
                  onClick={() => {
                    setLogoDraft(null)
                    setSaved(false)
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          {logoDraft !== undefined && (
            <SettingsAlert tone="info">
              {logoDraft
                ? 'New logo selected — press Save to apply it everywhere.'
                : 'Logo will be removed — press Save to apply.'}
            </SettingsAlert>
          )}
          {logoDraft !== undefined && !editing && (
            <div className="li-set-actions-row" style={{ justifyContent: 'flex-end' }}>
              <button
                className="li-set-btn"
                onClick={() => {
                  setLogoDraft(undefined)
                  setError(null)
                }}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="li-set-btn li-set-btn-primary" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}

          {saved && <SettingsAlert tone="success">Saved.</SettingsAlert>}

          {!editing && (
            <div
              className="li-set-actions-row"
              style={{ justifyContent: 'flex-end', marginTop: 0 }}
            >
              <button className="li-set-btn" onClick={() => setEditing(true)}>
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
                  <TagInput
                    values={settings.practiceAreas ?? []}
                    onChange={(next) => updateField('practiceAreas', next)}
                    placeholder="e.g. business law, estate planning. Press Enter to add."
                  />
                </label>
                <label className="li-set-label">
                  <span>Brand color</span>
                  <ColorWheelField
                    value={settings.headerColor}
                    onChange={(hex) => {
                      updateField('headerColor', hex)
                      // Paint the console header as the wheel moves; Save makes
                      // it authoritative (refreshFirmBranding), Cancel re-reads.
                      setFirmBrandingLocal({ headerColor: hex })
                    }}
                    defaultHex="#1b2a4a"
                    label="Brand color"
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
              {/* FIRM-LANDING-2 — the public landing page's copy. Saved through
                  the same legal.settings.firm_profile.set action as the fields
                  above; empty clears (generic hero line / hidden about section). */}
              <div className="li-set-section-heading">Public page</div>
              <label className="li-set-label">
                <span>Tagline</span>
                <input
                  className="li-set-input"
                  value={settings.tagline ?? ''}
                  onChange={(e) => updateField('tagline', e.target.value || null)}
                  maxLength={160}
                  placeholder="One line under your firm name on your public page"
                />
              </label>
              <label className="li-set-label">
                <span>About the firm</span>
                <textarea
                  className="li-set-textarea"
                  value={settings.about ?? ''}
                  onChange={(e) => updateField('about', e.target.value || null)}
                  rows={4}
                  maxLength={4000}
                  placeholder="A short public paragraph about your firm. Leave empty to hide the section."
                />
              </label>
              <p className="li-set-hint">
                Your public page (your firm&rsquo;s own web address) shows your firm name, the
                tagline, this about paragraph, your bookable services, and whichever of the firm
                phone / email / address above are filled in — leave a contact field empty and it
                stays off the public page.
              </p>
              <p className="li-set-hint">
                These fields fill the firm identity where templates merge them. The brand color
                tints your console header and sidebar, the client portal header, and the booking
                page — generated legal documents stay neutral by design. The home jurisdiction is
                the firm-wide fallback — each matter carries its own governing law (from intake,
                editable on the matter page), which always wins. Type a practice area and press
                Enter to add it as a pill.
              </p>
              <div className="li-set-actions-row">
                <button
                  className="li-set-btn"
                  onClick={() => {
                    setEditing(false)
                    setError(null)
                    setLogoDraft(undefined)
                    refreshSettings()
                    // Undo the optimistic header tint from the color wheel.
                    void refreshFirmBranding()
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
              <div>
                <div className="li-set-kv-label">Brand color</div>
                <div className="li-set-kv-value">
                  {settings.headerColor ? (
                    <span className="li-set-colorswatch">
                      <span style={{ background: settings.headerColor }} />
                      {settings.headerColor}
                    </span>
                  ) : (
                    'Default navy'
                  )}
                </div>
              </div>
              <div>
                <div className="li-set-kv-label">Public page tagline</div>
                <div className="li-set-kv-value">{settings.tagline ?? '—'}</div>
              </div>
              <div className="li-set-kv-full">
                <div className="li-set-kv-label">Public page about</div>
                <div className="li-set-kv-value" style={{ whiteSpace: 'pre-line' }}>
                  {settings.about ?? '—'}
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
