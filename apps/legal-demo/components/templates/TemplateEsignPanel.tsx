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
// ESIGN-FIELDS-1 — each role also carries merge-field IDENTITY bindings: drag a
// {{token}} from the Merge-fields tab onto a role's Name / Email / Title slot
// and that signer's identity is pulled from the document's collected field at
// send time (esignPrefill.ts), OVERRIDING the coarse bind. This is what makes an
// extra signer (a second LLC member, an NDA counterparty) — whose email lives in
// an intake answer, not the CRM — send-ready. A signable role that can't be
// reached (a `manual` bind with no email field) is flagged with a one-click
// "capture it on intake" fix.
//
// Drift warnings (same orphan-report pattern as validateProposedTemplate):
// marker keys in the body with no role row, and needs_to_sign roles with no
// {{sign:key}} marker — computed live via the shared pure helper
// (computeMarkerRoleDrift, the SAME function the AI-proposal validator uses).
import { useMemo, useState } from 'react'
import { computeMarkerRoleDrift, computeSignerEmailGaps, labelFor } from '@exsto/legal/esign'
import type {
  TemplateEsignConfig,
  TemplateEsignRole,
  TemplateEsignRoleFields,
  EsignRecipientRole,
  EsignRoleBindKind,
} from '@exsto/legal'
import { readDroppedToken, dragHasToken } from '@/lib/mergeFieldDnd'
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

// One identity slot (Name / Email / Title) that binds by drag-and-drop. A bound
// slot shows the token chip with a clear button; an empty slot is a dropzone
// that highlights when a merge-field token is dragged over it.
function FieldSlot({
  label,
  token,
  onBind,
  onClear,
}: {
  label: string
  token: string | undefined
  onBind: (token: string) => void
  onClear: () => void
}) {
  const [over, setOver] = useState(false)
  return (
    <div
      className={`li-tplsign-slot${over ? ' is-over' : ''}${token ? ' is-bound' : ''}`}
      onDragOver={(e) => {
        if (dragHasToken(e)) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const t = readDroppedToken(e)
        if (t) onBind(t)
      }}
    >
      <span className="li-tplsign-slot-label">{label}</span>
      {token ? (
        <span className="li-tplsign-slot-chip">
          {`{{${token}}}`}
          <button
            type="button"
            aria-label={`Clear the ${label.toLowerCase()} field`}
            onClick={onClear}
          >
            <XIcon size={11} />
          </button>
        </span>
      ) : (
        <span className="li-tplsign-slot-empty">Drop a field</span>
      )}
    </div>
  )
}

export function TemplateEsignPanel({
  body,
  config,
  onChange,
  onInsertBlock,
  onCaptureEmailOnIntake,
}: {
  // The current template body MARKDOWN (for live marker↔role drift).
  body: string
  config: TemplateEsignConfig
  onChange: (next: TemplateEsignConfig) => void
  // Insert the role's execution block at the editor cursor (host wires this to
  // TemplateEditorHandle.insertHtml with roleBlockHtml above).
  onInsertBlock: (role: TemplateEsignRole) => void
  // ESIGN-FIELDS-1 one-click fix: create a merge field for this role's email,
  // add it to the document (so intake collects it), and return the token so the
  // panel binds the role's email slot to it. Host-level (touches the variables
  // map + the editor).
  onCaptureEmailOnIntake?: (role: TemplateEsignRole) => string | void
}) {
  const drift = useMemo(
    () => (config.signable ? computeMarkerRoleDrift(body, config.roles) : null),
    [body, config],
  )
  // Signable roles that have no way to reach the signer (manual bind, no email
  // field). The shared helper is the same one a server-side validator can use.
  const emailGaps = useMemo(
    () => (config.signable ? computeSignerEmailGaps(config.roles) : []),
    [config],
  )
  const gapKeys = useMemo(() => new Set(emailGaps.map((g) => g.key)), [emailGaps])

  function patchRole(i: number, patch: Partial<TemplateEsignRole>) {
    const roles = config.roles.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
    onChange({ ...config, roles })
  }

  // Merge one identity-field binding, stripping empties so an all-clear role
  // stores `fields: undefined` (a bind-only role, unchanged from before).
  function patchRoleFields(i: number, patch: Partial<TemplateEsignRoleFields>) {
    const current = config.roles[i]?.fields ?? {}
    const merged = { ...current, ...patch }
    const clean: TemplateEsignRoleFields = {}
    if (merged.name) clean.name = merged.name
    if (merged.email) clean.email = merged.email
    if (merged.title) clean.title = merged.title
    patchRole(i, { fields: Object.keys(clean).length ? clean : undefined })
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
        <span className="li-tplsign-title">Signers</span>
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
            Who signs the finished document, in what order, and where each signer’s name and email
            come from. Drag a field from <strong>Merge fields</strong> onto a signer to pull their
            identity from the document — e.g. the client’s info onto the client, your info onto the
            countersigner, an extra member’s onto a second signer.
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
                    onChange={(e) => patchRole(i, { bind: e.target.value as EsignRoleBindKind })}
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

              {/* ESIGN-FIELDS-1 — identity from merge fields (drag targets). */}
              <div className="li-tplsign-slots" aria-label={`Signer ${i + 1} identity fields`}>
                <FieldSlot
                  label="Name"
                  token={role.fields?.name}
                  onBind={(t) => patchRoleFields(i, { name: t })}
                  onClear={() => patchRoleFields(i, { name: undefined })}
                />
                <FieldSlot
                  label="Email"
                  token={role.fields?.email}
                  onBind={(t) => patchRoleFields(i, { email: t })}
                  onClear={() => patchRoleFields(i, { email: undefined })}
                />
                <FieldSlot
                  label="Title"
                  token={role.fields?.title}
                  onBind={(t) => patchRoleFields(i, { title: t })}
                  onClear={() => patchRoleFields(i, { title: undefined })}
                />
              </div>

              {gapKeys.has(role.key) && (
                <div className="li-tplsign-role-gap" role="alert">
                  No email source — this signer can’t be reached.
                  {onCaptureEmailOnIntake ? (
                    <button
                      type="button"
                      className="li-tplsign-role-gap-fix"
                      onClick={() => {
                        const token = onCaptureEmailOnIntake(role)
                        if (typeof token === 'string' && token) {
                          patchRoleFields(i, { email: token })
                        }
                      }}
                    >
                      Capture it on intake
                    </button>
                  ) : (
                    <span> Drop an email field above, or bind to a contact.</span>
                  )}
                </div>
              )}

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
