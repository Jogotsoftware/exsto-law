'use client'

// BUILDER-UX-2 WP-2 — the shared service-settings fields: the identity + client-copy +
// generation-mode + booking-mode inputs that the manual service page
// (app/attorney/services/[serviceKey]/page.tsx) and the wizard's ServiceEditorModal both
// render. Extracted so the two surfaces edit a service through ONE form, never a fork.
// The page composes these fields with its extra booking-schedule fieldset; the modal
// uses them alone (the wizard proposal has no booking-schedule).

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

  return (
    <>
      <div className="form-grid">
        <label>
          <span>Display name</span>
          <input
            value={value.displayName}
            onChange={(e) => update('displayName', e.target.value)}
            placeholder="e.g. Single-Member LLC Formation"
          />
        </label>
        <label>
          <span>Workflow route</span>
          <select
            value={value.route}
            onChange={(e) => update('route', e.target.value as ServiceRoute)}
          >
            <option value="manual">Manual — attorney drafts</option>
            <option value="auto">Attorney in the loop — auto-drafts on intake</option>
          </select>
        </label>
      </div>
      {/* Client-facing copy the booking tile shows — kept distinct from the internal
          description below. */}
      <label style={{ display: 'block', marginTop: 'var(--space-3)' }}>
        <span>Client-facing name</span>
        <input
          value={value.clientDisplayName}
          onChange={(e) => update('clientDisplayName', e.target.value)}
          placeholder="e.g. Last Will & Testament"
        />
        <small className="text-muted">
          What the client sees on the booking page (outcome, no jurisdiction/jargon).
        </small>
      </label>
      <label style={{ display: 'block', marginTop: 'var(--space-3)' }}>
        <span>Client-facing description</span>
        <textarea
          value={value.clientDescription}
          onChange={(e) => update('clientDescription', e.target.value)}
          rows={2}
          placeholder="e.g. Have an attorney review your NDA agreement."
        />
        <small className="text-muted">
          What the client sees — one plain sentence in second person.
        </small>
      </label>
      {/* WP-7 — the Spanish client copy, edited beside the English. Empty is safe:
          the Spanish intake falls back to the English copy above. */}
      <div className="form-grid" style={{ marginTop: 'var(--space-3)' }}>
        <label>
          <span>Client-facing name (Español)</span>
          <input
            value={value.clientDisplayNameEs}
            onChange={(e) => update('clientDisplayNameEs', e.target.value)}
            placeholder="e.g. Testamento"
          />
          <small className="text-muted">
            Shown when the client uses the intake in Spanish; empty falls back to English.
          </small>
        </label>
        <label>
          <span>Client-facing description (Español)</span>
          <textarea
            value={value.clientDescriptionEs}
            onChange={(e) => update('clientDescriptionEs', e.target.value)}
            rows={2}
            placeholder="e.g. Cuéntenos su situación y reciba su carta lista para enviar."
          />
        </label>
      </div>
      <label style={{ display: 'block', marginTop: 'var(--space-3)' }}>
        <span>Internal description</span>
        <textarea
          value={value.description}
          onChange={(e) => update('description', e.target.value)}
          rows={2}
          placeholder="Attorney-facing notes about this service (not shown to clients)."
        />
        <small className="text-muted">
          Attorney-facing; the booking page uses the client-facing copy above.
        </small>
      </label>

      <fieldset className="svc-fieldset">
        <legend>Document generation</legend>
        <label>
          <span>How documents are produced</span>
          <select
            value={value.generationMode}
            onChange={(e) => update('generationMode', e.target.value as ServiceGenerationMode)}
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
          {value.generationMode === 'ai_draft'
            ? 'AI draft uses the per-document instructions on the Prompt tab.'
            : 'Template merge fills the bodies on the Templates tab — no Prompt tab needed.'}
        </p>
      </fieldset>
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
