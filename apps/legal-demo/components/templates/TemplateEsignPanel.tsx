'use client'

// ESIGN-UNIFY-1 ES-3 (§6.2, 15.20a) — the template editor's eSign panel. One
// shared component for every template-editing surface (the standalone library
// rail, the pop-up TemplateEditorModal, and — later — the service-builder
// wizard's document step, §6.3): "Signable" toggle; role rows (label, key,
// recipient-role select, bind select, order); a per-role "Insert block" button
// that inserts the role's canonical signature/name/date execution lines at the
// cursor as RULED LINES (SignatureLine nodes carrying the marker in data
// attributes — the attorney NEVER sees raw {{sign:…}} text, 15.16b; the
// save-bridge converts them back to markers, which stay the storage).
//
// Drift warnings (same orphan-report pattern as validateProposedTemplate):
// marker keys in the body with no role row, and needs_to_sign roles with no
// {{sign:key}} marker — computed live via the shared pure helper
// (computeMarkerRoleDrift, the SAME function the AI-proposal validator uses).
import { useMemo } from 'react'
import { computeMarkerRoleDrift, labelFor } from '@exsto/legal/esign'
import type { TemplateEsignConfig, TemplateEsignRole, EsignRecipientRole } from '@exsto/legal'
import { PlusIcon, SignatureIcon, XIcon } from '@/components/icons'

const RECIPIENT_ROLE_OPTIONS: { value: EsignRecipientRole; label: string }[] = [
  { value: 'needs_to_sign', label: 'Needs to sign' },
  { value: 'needs_to_view', label: 'Needs to view' },
  { value: 'receives_copy', label: 'Receives a copy' },
]

// The three resolvable binds the composer supports today (§6.4). contact_role:*
// binds are read/preserved (a role loaded with one keeps it) but not authored
// here — no contact-role relationship kind exists yet, so offering it would be
// a dead control.
const BIND_OPTIONS: { value: string; label: string }[] = [
  { value: 'matter_primary_contact', label: 'Matter’s client' },
  { value: 'attorney_of_record', label: 'Attorney of record' },
  { value: 'manual', label: 'Entered at send time' },
]

// A role key must be marker-grammar safe ({{sign:<key>}} — [A-Za-z0-9_-]).
function slugKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

// The HTML fragment "Insert block" places at the cursor: the role's canonical
// execution lines (buildExecutionBlock's per-signer shape — sign, name, date)
// as marker-carrying sig-line divs the SignatureLine node parses into ruled
// lines. `withHeading` adds the canonical "Accepted and Agreed:" opener when
// the body has no execution section yet.
export function roleBlockHtml(role: TemplateEsignRole, withHeading: boolean): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const line = (type: 'sign' | 'name' | 'date') =>
    `<div class="sig-line" data-sig-type="${type}" data-sig-key="${esc(role.key)}"><span class="sig-line-label">${esc(
      labelFor(type),
    )}</span></div>`
  const heading = withHeading ? '<p><strong>Accepted and Agreed:</strong></p>' : ''
  return `${heading}${line('sign')}${line('name')}${line('date')}`
}

export function TemplateEsignPanel({
  body,
  config,
  onChange,
  onInsertBlock,
}: {
  // The current template body MARKDOWN (for live marker↔role drift).
  body: string
  config: TemplateEsignConfig
  onChange: (next: TemplateEsignConfig) => void
  // Insert the role's execution block at the editor cursor (host wires this to
  // TemplateEditorHandle.insertHtml with roleBlockHtml above).
  onInsertBlock: (role: TemplateEsignRole) => void
}) {
  const drift = useMemo(
    () => (config.signable ? computeMarkerRoleDrift(body, config.roles) : null),
    [body, config],
  )

  function patchRole(i: number, patch: Partial<TemplateEsignRole>) {
    const roles = config.roles.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
    onChange({ ...config, roles })
  }

  function addRole(key?: string) {
    const base = key ?? `signer_${config.roles.length + 1}`
    let candidate = slugKey(base) || `signer_${config.roles.length + 1}`
    while (config.roles.some((r) => r.key === candidate)) candidate = `${candidate}_2`
    const role: TemplateEsignRole = {
      key: candidate,
      label: key ? candidate.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '',
      recipientRole: 'needs_to_sign',
      bind: config.roles.length === 0 ? 'matter_primary_contact' : 'manual',
      order: config.roles.length + 1,
    }
    onChange({ ...config, signable: true, roles: [...config.roles, role] })
  }

  function removeRole(i: number) {
    onChange({ ...config, roles: config.roles.filter((_, idx) => idx !== i) })
  }

  return (
    <section className="li-tplsign">
      <div className="li-tplsign-head">
        <SignatureIcon size={15} />
        <span className="li-tplsign-title">eSign</span>
        <label className="li-tplsign-toggle">
          <input
            type="checkbox"
            checked={config.signable}
            onChange={(e) => onChange({ ...config, signable: e.target.checked })}
            aria-label="This document gets signed"
          />
          Signable
        </label>
      </div>

      {config.signable && (
        <>
          <p className="li-tplsign-hint">
            Who signs the finished document, and how each signer is resolved when it goes out.
            Insert a role’s signature block where it belongs in the document.
          </p>

          {config.roles.map((role, i) => (
            <div key={i} className="li-tplsign-role">
              <div className="li-tplsign-role-row">
                <input
                  type="text"
                  className="li-tplsign-role-label"
                  value={role.label}
                  placeholder="Role label, e.g. Client"
                  aria-label={`Role ${i + 1} label`}
                  onChange={(e) => {
                    const label = e.target.value
                    // Keep the marker key following the label while the key is
                    // still label-derived (untouched by hand) — one field to
                    // think about in the common case, editable when it matters.
                    const derived = slugKey(label)
                    const keyFollows = role.key === slugKey(role.label) || !role.label
                    patchRole(i, {
                      label,
                      ...(keyFollows && derived ? { key: derived } : {}),
                    })
                  }}
                />
                <button
                  type="button"
                  className="li-tplsign-role-remove"
                  aria-label={`Remove role ${role.label || role.key}`}
                  onClick={() => removeRole(i)}
                >
                  <XIcon size={13} />
                </button>
              </div>
              <div className="li-tplsign-role-row li-tplsign-role-row--meta">
                <label className="li-tplsign-field">
                  <span>Marker key</span>
                  <input
                    type="text"
                    value={role.key}
                    aria-label={`Role ${i + 1} marker key`}
                    onChange={(e) => patchRole(i, { key: slugKey(e.target.value) })}
                  />
                </label>
                <label className="li-tplsign-field">
                  <span>Signing order</span>
                  <input
                    type="number"
                    min={1}
                    value={role.order}
                    aria-label={`Role ${i + 1} signing order`}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      patchRole(i, { order: Number.isFinite(n) && n >= 1 ? n : 1 })
                    }}
                  />
                </label>
              </div>
              <div className="li-tplsign-role-row li-tplsign-role-row--meta">
                <label className="li-tplsign-field">
                  <span>Role</span>
                  <select
                    value={role.recipientRole}
                    aria-label={`Role ${i + 1} recipient role`}
                    onChange={(e) =>
                      patchRole(i, { recipientRole: e.target.value as EsignRecipientRole })
                    }
                  >
                    {RECIPIENT_ROLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="li-tplsign-field">
                  <span>Resolves to</span>
                  <select
                    value={role.bind}
                    aria-label={`Role ${i + 1} recipient binding`}
                    onChange={(e) => patchRole(i, { bind: e.target.value })}
                  >
                    {BIND_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                    {/* Preserve a loaded contact_role:* bind (read-only option). */}
                    {role.bind.startsWith('contact_role:') && (
                      <option value={role.bind}>Contact role: {role.bind.slice(13)}</option>
                    )}
                  </select>
                </label>
              </div>
              <button
                type="button"
                className="li-tplsign-insert"
                disabled={!role.key}
                title="Insert this role’s signature, name, and date lines at the cursor"
                onClick={() => onInsertBlock(role)}
              >
                <SignatureIcon size={13} />
                Insert signature block
              </button>
            </div>
          ))}

          <button type="button" className="li-tplsign-add" onClick={() => addRole()}>
            <PlusIcon size={14} />
            Add signer role
          </button>

          {drift && drift.markerKeysWithoutRole.length > 0 && (
            <div className="li-tplsign-warn" role="alert">
              Signature markers in the document with no role:{' '}
              {drift.markerKeysWithoutRole.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="li-tplsign-warn-chip"
                  title={`Add a role for “${k}”`}
                  onClick={() => addRole(k)}
                >
                  {k}
                </button>
              ))}
              <span className="li-tplsign-warn-hint">— click one to add it as a role.</span>
            </div>
          )}
          {drift && drift.rolesWithoutSignMarker.length > 0 && (
            <div className="li-tplsign-warn" role="alert">
              No signature line in the document for:{' '}
              <strong>{drift.rolesWithoutSignMarker.join(', ')}</strong> — use “Insert signature
              block” to place one.
            </div>
          )}
        </>
      )}
    </section>
  )
}
