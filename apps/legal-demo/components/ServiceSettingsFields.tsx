'use client'

// BUILDER-UX-2 WP-2 — the shared service-settings fields: the identity + client-copy +
// generation-mode + booking-mode inputs that the manual service page
// (app/attorney/services/[serviceKey]/page.tsx) and the wizard's ServiceEditorModal both
// render. Extracted so the two surfaces edit a service through ONE form, never a fork.
// The page composes these fields with its extra booking-schedule fieldset; the modal
// uses them alone (the wizard proposal has no booking-schedule).
//
// WP-D (Legal Instruments): route + generationMode are now the comp's segmented pill
// toggles (li-svc-pilltoggle) instead of <select>s — restyle only, same value/onChange
// contract, so both host surfaces (the routed Settings tab and the wizard modal) pick
// up the comp look at once. The English/Spanish client-copy fields are switched by a
// small pill toggle (component-local UI state — both languages still live in `value`).
import { useState } from 'react'

export type ServiceRoute = 'auto' | 'manual'
export type ServiceGenerationMode = 'template_merge' | 'ai_draft'

export interface ServiceSettingsValue {
  displayName: string
  route: ServiceRoute
  clientDisplayName: string
  clientDescription: string
  // BUILDER-UX-2 WP-7 — the Spanish client copy (transitions.client_copy_i18n.es).
  // Generated automatically by the wizard, editable here always; empty = the
  // Spanish intake falls back to English.
  clientDisplayNameEs: string
  clientDescriptionEs: string
  description: string
  generationMode: ServiceGenerationMode
  appointmentRequired: boolean
}

export function ServiceSettingsFields({
  value,
  onChange,
}: {
  value: ServiceSettingsValue
  onChange: (next: ServiceSettingsValue) => void
}): React.ReactElement {
  const update = <K extends keyof ServiceSettingsValue>(key: K, v: ServiceSettingsValue[K]) =>
    onChange({ ...value, [key]: v })
  // Component-local — which language's client-copy inputs are showing. Both
  // languages still live in `value`; this only decides what's on screen.
  const [lang, setLang] = useState<'en' | 'es'>('en')

  return (
    <>
      <label className="li-svc-field">
        <span>Display name</span>
        <input
          value={value.displayName}
          onChange={(e) => update('displayName', e.target.value)}
          placeholder="e.g. Single-Member LLC Formation"
        />
      </label>

      <div style={{ marginTop: 'var(--space-3)' }}>
        <span
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 600,
            color: '#48546e',
            marginBottom: 6,
          }}
        >
          Workflow route
        </span>
        <div className="li-svc-pilltoggle">
          <button
            type="button"
            className={`li-svc-pilltoggle-opt${value.route === 'auto' ? ' on' : ''}`}
            aria-pressed={value.route === 'auto'}
            onClick={() => update('route', 'auto')}
            title="Attorney in the loop — auto-drafts on intake"
          >
            Automatic
          </button>
          <button
            type="button"
            className={`li-svc-pilltoggle-opt${value.route === 'manual' ? ' on' : ''}`}
            aria-pressed={value.route === 'manual'}
            onClick={() => update('route', 'manual')}
            title="Manual — attorney drafts"
          >
            Manual
          </button>
        </div>
      </div>

      {/* Client-facing copy the booking tile shows — kept distinct from the internal
          description below. A small EN/ES pill picks which language is on screen;
          both are always saved together. */}
      <div style={{ marginTop: 'var(--space-4)' }}>
        <div className="li-svc-pilltoggle li-svc-pilltoggle--sm">
          <button
            type="button"
            className={`li-svc-pilltoggle-opt${lang === 'en' ? ' on blue' : ''}`}
            aria-pressed={lang === 'en'}
            onClick={() => setLang('en')}
          >
            English
          </button>
          <button
            type="button"
            className={`li-svc-pilltoggle-opt${lang === 'es' ? ' on blue' : ''}`}
            aria-pressed={lang === 'es'}
            onClick={() => setLang('es')}
          >
            Español
          </button>
        </div>
        {lang === 'en' ? (
          <>
            <label className="li-svc-field">
              <span>Client-facing name</span>
              <input
                value={value.clientDisplayName}
                onChange={(e) => update('clientDisplayName', e.target.value)}
                placeholder="e.g. Last Will & Testament"
              />
              <small className="li-svc-small">
                What the client sees on the booking page (outcome, no jurisdiction/jargon).
              </small>
            </label>
            <label className="li-svc-field" style={{ marginTop: 'var(--space-3)' }}>
              <span>Client-facing description</span>
              <textarea
                value={value.clientDescription}
                onChange={(e) => update('clientDescription', e.target.value)}
                rows={2}
                placeholder="e.g. Have an attorney review your NDA agreement."
              />
              <small className="li-svc-small">
                What the client sees — one plain sentence in second person.
              </small>
            </label>
          </>
        ) : (
          <>
            <label className="li-svc-field">
              <span>Client-facing name (Español)</span>
              <input
                value={value.clientDisplayNameEs}
                onChange={(e) => update('clientDisplayNameEs', e.target.value)}
                placeholder="e.g. Testamento"
              />
              <small className="li-svc-small">
                Shown when the client uses the intake in Spanish; empty falls back to English.
              </small>
            </label>
            <label className="li-svc-field" style={{ marginTop: 'var(--space-3)' }}>
              <span>Client-facing description (Español)</span>
              <textarea
                value={value.clientDescriptionEs}
                onChange={(e) => update('clientDescriptionEs', e.target.value)}
                rows={2}
                placeholder="e.g. Cuéntenos su situación y reciba su carta lista para enviar."
              />
            </label>
          </>
        )}
      </div>

      <label className="li-svc-field" style={{ marginTop: 'var(--space-4)' }}>
        <span>Internal description</span>
        <textarea
          value={value.description}
          onChange={(e) => update('description', e.target.value)}
          rows={2}
          placeholder="Attorney-facing notes about this service (not shown to clients)."
        />
        <small className="li-svc-small">
          Attorney-facing; the booking page uses the client-facing copy above.
        </small>
      </label>

      <div style={{ marginTop: 'var(--space-1)' }}>
        <span
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 600,
            color: '#48546e',
            marginBottom: 6,
          }}
        >
          Document generation
        </span>
        <div className="li-svc-pilltoggle">
          <button
            type="button"
            className={`li-svc-pilltoggle-opt${value.generationMode === 'template_merge' ? ' on blue' : ''}`}
            aria-pressed={value.generationMode === 'template_merge'}
            onClick={() => update('generationMode', 'template_merge')}
            title="Fill the template from the answers (no AI)"
          >
            Template merge
          </button>
          <button
            type="button"
            className={`li-svc-pilltoggle-opt${value.generationMode === 'ai_draft' ? ' on blue' : ''}`}
            aria-pressed={value.generationMode === 'ai_draft'}
            onClick={() => update('generationMode', 'ai_draft')}
            title="The assistant writes the document"
          >
            AI draft
          </button>
        </div>
        <small className="li-svc-small">
          {value.generationMode === 'ai_draft'
            ? 'AI draft uses the per-document instructions on the Prompt tab.'
            : 'Template merge fills the bodies on the Templates tab — no Prompt tab needed.'}
        </small>
      </div>
    </>
  )
}

// The booking-MODE checkbox (appointment_required) — the one booking field the wizard
// proposal carries, shared so the modal renders it too. The page's full booking-schedule
// fieldset (invite, duration, online-booking toggle) stays page-only.
export function AppointmentRequiredField({
  value,
  onChange,
}: {
  value: boolean
  onChange: (next: boolean) => void
}): React.ReactElement {
  return (
    <label className="svc-check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>Clients schedule a consultation when they book this service</span>
    </label>
  )
}
