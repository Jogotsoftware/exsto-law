'use client'

// BUILDER-UX-2 WP-2 — the billing editor pop-up: a real controlled fee-model form
// (cost type, amount, estimated hours, per-document fees), opened DIRECTLY in edit mode
// and seeded from the in-memory proposal or a persisted cost. No View/Edit toggle, no
// JSON textarea. Save/Cancel at the top. The shared CostForm is the one editing surface
// for a service's fee model; the host decides what Save persists.
import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { EditorActionRow } from '@/components/EditorActionRow'
import { AiRegenerateRail } from '@/components/AiRegenerateRail'
import { BillingView } from '@/components/configEditors'

export type CostType = 'hourly' | 'fixed'

export interface CostValue {
  costType: CostType
  amount: string
  hours: number | null
  documentFees?: Record<string, string>
}

// The controlled fee-model form — reusable in the pop-up and anywhere else a service
// cost is edited. Amounts are plain decimal strings ("500.00"); the money contract is
// validated at the write path (validateProposedCost), so this form just captures.
export function CostForm({
  value,
  onChange,
}: {
  value: CostValue
  onChange: (next: CostValue) => void
}): React.ReactElement {
  const docFees = value.documentFees ?? {}
  const patch = (p: Partial<CostValue>) => onChange({ ...value, ...p })
  const setDocFee = (kind: string, amt: string) =>
    patch({ documentFees: { ...docFees, [kind]: amt } })
  const removeDocFee = (kind: string) => {
    const next = { ...docFees }
    delete next[kind]
    patch({ documentFees: next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="text-muted text-sm">How is this billed?</span>
        <select
          className="input"
          value={value.costType}
          onChange={(e) => patch({ costType: e.target.value as CostType })}
        >
          <option value="fixed">Flat fee</option>
          <option value="hourly">Hourly</option>
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="text-muted text-sm">
          {value.costType === 'hourly' ? 'Hourly rate ($)' : 'Flat fee ($)'}
        </span>
        <input
          className="input"
          inputMode="decimal"
          value={value.amount}
          onChange={(e) => patch({ amount: e.target.value })}
          placeholder="0.00"
        />
      </label>

      {value.costType === 'hourly' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="text-muted text-sm">Estimated hours (optional)</span>
          <input
            className="input"
            inputMode="numeric"
            value={value.hours ?? ''}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10)
              patch({ hours: Number.isFinite(n) ? n : null })
            }}
            placeholder="e.g. 6"
          />
        </label>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="text-muted text-sm">Per-document fees (optional)</span>
        {Object.entries(docFees).map(([kind, amt]) => (
          <div key={kind} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ flex: 1 }}>{kind.replace(/_/g, ' ')}</span>
            <input
              className="input"
              style={{ width: 120 }}
              inputMode="decimal"
              value={amt}
              onChange={(e) => setDocFee(kind, e.target.value)}
              placeholder="0.00"
            />
            <button type="button" className="button" onClick={() => removeDocFee(kind)}>
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CostEditorModal({
  title,
  initialValue,
  regenerateTargetId,
  onSave,
  onClose,
}: {
  title: string
  initialValue: CostValue
  // Enables the "Edit with AI" rail ("proposal:<key>" for wizard proposals, the
  // serviceKey once saved). The worker revises the passed cost JSON.
  regenerateTargetId?: string
  onSave: (value: CostValue) => Promise<void> | void
  onClose: () => void
}): React.ReactElement {
  const [value, setValue] = useState<CostValue>(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await onSave(value)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose} size="wide">
      <EditorActionRow
        busy={busy}
        error={error}
        onCancel={onClose}
        onSave={save}
        ai={
          regenerateTargetId ? (
            <AiRegenerateRail
              artifactKind="billing"
              targetId={regenerateTargetId}
              current={() => JSON.stringify(value, null, 2)}
              renderProposal={(proposed) => <BillingView content={proposed} />}
              onUse={(proposed) => {
                const next = JSON.parse(proposed) as Partial<CostValue>
                if (!next || (next.costType !== 'fixed' && next.costType !== 'hourly'))
                  throw new Error('The AI proposal is not a billing config.')
                setValue((v) => ({ ...v, ...next }))
              }}
            />
          ) : undefined
        }
      />
      <CostForm value={value} onChange={setValue} />
    </Modal>
  )
}
