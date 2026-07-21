'use client'

// ESIGN-UNIFY-1 ES-2 (§4) — per-field properties panel (docks under the palette
// when a box is selected): Required toggle, Label (the caption the signer
// sees), signer re-assign, Delete.
import type { FieldPlacement } from '@exsto/legal/esign'
import { TrashIcon } from '@/components/icons'
import { placementGlyph } from './fieldMeta'
import type { SwitcherSigner } from './SignerSwitcher'

export function FieldProps({
  placement,
  signers,
  onChange,
  onDelete,
}: {
  placement: FieldPlacement
  signers: SwitcherSigner[]
  onChange: (
    id: string,
    patch: Partial<Pick<FieldPlacement, 'required' | 'label' | 'signerKey'>>,
  ) => void
  onDelete: (id: string) => void
}) {
  const glyph = placementGlyph(placement.type)
  return (
    <div className="li-esp-props">
      <div className="li-esp-props-head">
        <span className="li-esp-props-ico" aria-hidden="true">
          {glyph.icon}
        </span>
        {glyph.label} field
      </div>
      <label className="li-esp-props-row li-esp-props-check">
        <input
          type="checkbox"
          checked={placement.required}
          onChange={(e) => onChange(placement.id, { required: e.target.checked })}
        />
        Required
      </label>
      <label className="li-esp-props-row">
        <span className="li-esp-props-k">Label</span>
        <input
          className="li-esp-props-in"
          value={placement.label ?? ''}
          placeholder={glyph.label}
          onChange={(e) => onChange(placement.id, { label: e.target.value || undefined })}
          aria-label="Field label"
        />
      </label>
      <label className="li-esp-props-row">
        <span className="li-esp-props-k">Signer</span>
        <select
          className="li-esp-props-in"
          value={placement.signerKey}
          onChange={(e) => onChange(placement.id, { signerKey: e.target.value })}
          aria-label="Assigned signer"
        >
          {signers.map((s) => (
            <option key={s.signerKey} value={s.signerKey}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {placement.type === 'date' && (
        <p className="li-esp-props-hint">
          Auto-fills with the actual date this signer signs — nobody types it.
        </p>
      )}
      {placement.source === 'anchor' && (
        <p className="li-esp-props-hint">Pre-placed from the document template — adjust freely.</p>
      )}
      <button type="button" className="li-esp-props-delete" onClick={() => onDelete(placement.id)}>
        <TrashIcon size={13} />
        Delete field
      </button>
    </div>
  )
}
