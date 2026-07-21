'use client'

// ESIGN-UNIFY-1 ES-2 (§4) — the signer switcher (top bar): which signer new
// placements belong to. Every signer's boxes stay visible; the active signer's
// are full-opacity, others dimmed (the canvas applies that — this is just the
// selector). Color dot per signer from the li-esign2 palette.
import { ChevronDownIcon } from '@/components/icons'

export interface SwitcherSigner {
  signerKey: string
  name: string
  /** 1-based li-esign2 tone index. */
  toneIndex: number
}

export function SignerSwitcher({
  signers,
  activeKey,
  onChange,
}: {
  signers: SwitcherSigner[]
  activeKey: string | null
  onChange: (signerKey: string) => void
}) {
  const active = signers.find((s) => s.signerKey === activeKey) ?? signers[0]
  return (
    <label className={`li-esp-switcher${active ? ` li-esign2-tone-${active.toneIndex}` : ''}`}>
      <span className="li-esign2-signer-dot" aria-hidden="true" />
      <span className="li-esp-switcher-label">Placing fields for</span>
      <select
        value={active?.signerKey ?? ''}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Signer to place fields for"
        disabled={signers.length === 0}
      >
        {signers.map((s) => (
          <option key={s.signerKey} value={s.signerKey}>
            {s.name}
          </option>
        ))}
      </select>
      <ChevronDownIcon size={14} aria-hidden="true" />
    </label>
  )
}
