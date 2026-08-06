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
// BRANDING-SECTION-1 — branding is now its OWN section, above firm identity,
// with everything visible and no Edit click. The color wheel used to be buried
// inside the identity form's edit mode, so a founder looking for "where do I set
// my color" found nothing (his words: "i dont see anywhere in firm settings to
// select the color from color wheel"). The Branding card owns two colors
// (primary + secondary, migration 0204) and two logo slots (the firm mark and an
// optional header-bar variant) and saves on its own, independent of the identity
// fields below. Uploaded artwork renders BARE everywhere — the product used to
// paint a plate behind reversed logos and no longer does.
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
import { ScaleIcon } from '@/components/icons'
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
  secondaryColor: string | null
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

// BRANDING-SECTION-1 — one logo slot's control: bare preview, upload/replace,
// remove. `dark` previews the mark on the console bar's dark strip (the only
// place the header logo appears) so the attorney judges it where it will live.
// Nothing is painted BEHIND the artwork on light previews: the preview is
// honest about how the mark actually renders.
function LogoSlotField({
  title,
  sub,
  dataUrl,
  tone,
  dark = false,
  pending,
  onPick,
  onClear,
}: {
  title: string
  sub: string
  dataUrl: string | null
  tone: 'light' | 'dark' | null
  dark?: boolean
  pending: boolean
  onPick: (file: File | null) => void
  onClear: () => void
}): React.ReactElement {
  return (
    <div className="li-set-logoslot">
      <div className="li-set-logoslot-head">
        <span className="li-set-logoslot-title">{title}</span>
        {pending && <span className="li-set-logoslot-pending">Unsaved</span>}
      </div>
      <div className={`li-set-logoslot-preview${dark ? ' on-dark' : ''}`}>
        {dataUrl ? (
          <img src={dataUrl} alt="" />
        ) : (
          <span className="li-set-logoslot-empty">
            <ScaleIcon size={22} />
            No logo
          </span>
        )}
      </div>
      <p className="li-set-logoslot-sub">{sub}</p>
      <div className="li-set-logoslot-actions">
        <label className="li-set-btn li-set-filebtn">
          {dataUrl ? 'Replace' : 'Upload'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(e) => {
              onPick(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
        </label>
        {dataUrl && (
          <button type="button" className="li-set-btn li-set-btn-sm" onClick={onClear}>
            Remove
          </button>
        )}
        {tone === 'light' && !dark && <span className="li-set-logoslot-tone">light artwork</span>}
      </div>
    </div>
  )
}

// One logo slot's editable state. `draft === undefined` means untouched this
// session, so Save omits the field entirely and a branding save never rewrites
// artwork the attorney did not touch; `null` is an explicit clear.
interface LogoSlot {
  draft: string | null | undefined
  tone: 'light' | 'dark' | null
}
const UNTOUCHED: LogoSlot = { draft: undefined, tone: null }

export default function FirmDetailsPage(): React.ReactElement {
  const [settings, setSettings] = useState<TenantSettings | null>(null)
  // The SAVED branding (shared store — also what the header bar is rendering).
  const branding = useFirmBranding()
  // BRANDING-SECTION-1 — two logo slots: the firm mark and the console header
  // variant. Same draft semantics for both.
  const [logo, setLogo] = useState<LogoSlot>(UNTOUCHED)
  const [headerLogo, setHeaderLogo] = useState<LogoSlot>(UNTOUCHED)
  const logoDataUrl = logo.draft === undefined ? branding.logoDataUrl : logo.draft
  const headerLogoDataUrl =
    headerLogo.draft === undefined ? branding.headerLogoDataUrl : headerLogo.draft
  // Colors are edited live on this card (not through the identity form), so the
  // draft lives here and the store is patched optimistically as the wheel moves.
  const [colorDraft, setColorDraft] = useState<{
    headerColor: string | null
    secondaryColor: string | null
  } | null>(null)
  const headerColor = colorDraft ? colorDraft.headerColor : branding.headerColor
  const secondaryColor = colorDraft ? colorDraft.secondaryColor : branding.secondaryColor
  // BRANDING-SECTION-1 — the advisory hints measure the artwork that is
  // actually on screen rather than trusting the stored tone. A stored row can
  // be stale (a logo replaced outside this editor leaves the old measurement
  // behind — the pilot firm's row says 'light' for artwork that measures dark),
  // and wrong advice is worse than none. The stored fact is still written on
  // upload; it just isn't what this hint reads.
  const [liveTone, setLiveTone] = useState<{
    logo: 'light' | 'dark' | null
    header: 'light' | 'dark' | null
  }>({ logo: null, header: null })
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [logoT, headerT] = await Promise.all([
        logoDataUrl ? measureLogoTone(logoDataUrl) : Promise.resolve(null),
        headerLogoDataUrl ? measureLogoTone(headerLogoDataUrl) : Promise.resolve(null),
      ])
      if (!cancelled) setLiveTone({ logo: logoT, header: headerT })
    })()
    return () => {
      cancelled = true
    }
  }, [logoDataUrl, headerLogoDataUrl])

  const brandingDirty =
    logo.draft !== undefined || headerLogo.draft !== undefined || colorDraft !== null
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [brandSaved, setBrandSaved] = useState(false)
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
  // so Save can't post something the action layer will bounce. Shared by both
  // logo slots — one validation path, so the header slot can never be laxer.
  async function onLogoFile(file: File | null, setSlot: (next: LogoSlot) => void): Promise<void> {
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
    // Measure the artwork once, here. BRANDING-SECTION-1: the answer no longer
    // paints anything — it only powers the "this mark is light" hint below.
    setSlot({ draft: dataUrl, tone: await measureLogoTone(dataUrl) })
    setBrandSaved(false)
  }

  // BRANDING-SECTION-1 — branding saves on its own, so an attorney can change a
  // color without opening (or re-submitting) the firm-identity form.
  async function saveBranding(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.settings.firm_profile.set',
        input: {
          // Untouched ⇒ omitted, so this save only writes what changed.
          ...(colorDraft
            ? {
                headerColor: colorDraft.headerColor ?? '',
                secondaryColor: colorDraft.secondaryColor ?? '',
              }
            : {}),
          ...(logo.draft !== undefined
            ? { logoDataUrl: logo.draft ?? '', logoTone: logo.tone ?? '' }
            : {}),
          ...(headerLogo.draft !== undefined
            ? {
                logoSecondaryDataUrl: headerLogo.draft ?? '',
                logoSecondaryTone: headerLogo.tone ?? '',
              }
            : {}),
        },
      })
      await refreshSettings()
      // Repaint the console header/rail (and every other branding consumer)
      // from the authoritative value — no reload needed.
      await refreshFirmBranding()
      setLogo(UNTOUCHED)
      setHeaderLogo(UNTOUCHED)
      setColorDraft(null)
      setBrandSaved(true)
      setTimeout(() => setBrandSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function cancelBranding(): void {
    setLogo(UNTOUCHED)
    setHeaderLogo(UNTOUCHED)
    setColorDraft(null)
    setError(null)
    // Undo the optimistic tint from the wheels.
    void refreshFirmBranding()
  }

  // Both wheels edit one draft object: the store patch must always carry the
  // pair, or an optimistic paint of one color would drop the other.
  function updateColor(patch: {
    headerColor?: string | null
    secondaryColor?: string | null
  }): void {
    const next = { headerColor, secondaryColor, ...patch }
    setColorDraft(next)
    setFirmBrandingLocal(next)
    setBrandSaved(false)
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
          tagline: settings.tagline ?? '',
          about: settings.about ?? '',
          // BRANDING-SECTION-1 — colors and logos are NOT written here. They
          // have their own section and their own save above, so submitting the
          // identity form can never clobber artwork or a color mid-edit.
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
      <SettingsHeader title="Firm Details" />
      {error && <SettingsAlert tone="error">{error}</SettingsAlert>}

      {!settings ? (
        <SettingsLoading />
      ) : (
        <>
          {/* ── Branding ──────────────────────────────────────────────────────
            BRANDING-SECTION-1 — its own section, everything visible, its own
            save. No Edit click stands between the attorney and their colors. */}
          <div className="li-set-card li-set-branding">
            <div className="li-set-section-heading" style={{ marginTop: 0 }}>
              Branding
            </div>
            <p className="li-set-hint" style={{ marginTop: 0 }}>
              Your marks and colors, used across your console, your client portal, your booking
              page, your public page and your invoices. Generated legal documents stay visually
              neutral by design.
            </p>

            <div className="li-set-brandgrid">
              <LogoSlotField
                title="Firm logo"
                sub="Your main mark — client portal, booking page, public page, invoices."
                dataUrl={logoDataUrl}
                tone={liveTone.logo}
                pending={logo.draft !== undefined}
                onPick={(f) => onLogoFile(f, setLogo)}
                onClear={() => {
                  setLogo({ draft: null, tone: null })
                  setBrandSaved(false)
                }}
              />
              <LogoSlotField
                title="Header logo"
                sub="Optional. Shown only on your console top bar — use a variant made for a dark strip. Falls back to your firm logo."
                dataUrl={headerLogoDataUrl}
                tone={liveTone.header}
                dark
                pending={headerLogo.draft !== undefined}
                onPick={(f) => onLogoFile(f, setHeaderLogo)}
                onClear={() => {
                  setHeaderLogo({ draft: null, tone: null })
                  setBrandSaved(false)
                }}
              />
            </div>

            <div className="li-set-brandgrid">
              <label className="li-set-label">
                <span>Brand color</span>
                <ColorWheelField
                  value={headerColor}
                  onChange={(hex) => updateColor({ headerColor: hex })}
                  defaultHex="#1b2a4a"
                  label="Brand color"
                />
              </label>
              <label className="li-set-label">
                <span>Secondary color</span>
                <ColorWheelField
                  value={secondaryColor}
                  onChange={(hex) => updateColor({ secondaryColor: hex })}
                  defaultHex="#14213d"
                  label="Secondary color"
                />
              </label>
            </div>

            <p className="li-set-hint">
              The brand color fills your console top bar, your client portal header and the booking
              page. The secondary color is the deeper companion tone next to it — your console
              sidebar, the darker accents on your public page and booking funnel. Leave the
              secondary unset and it is derived automatically by deepening your brand color.
            </p>
            {liveTone.logo === 'light' && (
              <p className="li-set-hint">
                Your firm logo is light artwork, so it can disappear on the white pages it appears
                on — invoices, your public page, the booking page. If it does, upload a dark version
                as your firm logo and keep this one as your header logo.
              </p>
            )}
            {liveTone.logo === 'dark' && !headerLogoDataUrl && (
              <p className="li-set-hint">
                Your firm logo is dark artwork, so it can be hard to see on your console top bar,
                which is dark. Upload a light version as your header logo above and the bar will use
                it — everywhere else keeps this one.
              </p>
            )}

            {brandSaved && <SettingsAlert tone="success">Branding saved.</SettingsAlert>}
            {brandingDirty && (
              <div className="li-set-actions-row">
                <button className="li-set-btn" onClick={cancelBranding} disabled={busy}>
                  Cancel
                </button>
                <button
                  className="li-set-btn li-set-btn-primary"
                  onClick={saveBranding}
                  disabled={busy}
                >
                  {busy ? 'Saving…' : 'Save branding'}
                </button>
              </div>
            )}
          </div>

          <div className="li-set-card">
            <div className="li-set-section-heading" style={{ marginTop: 0 }}>
              Firm details
            </div>
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
                  These fields fill the firm identity where templates merge them. Your logos and
                  colors live in the Branding section above. The home jurisdiction is the firm-wide
                  fallback — each matter carries its own governing law (from intake, editable on the
                  matter page), which always wins. Type a practice area and press Enter to add it as
                  a pill.
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
        </>
      )}
    </>
  )
}
