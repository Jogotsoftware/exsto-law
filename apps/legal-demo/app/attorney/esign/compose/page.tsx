'use client'

// ESIGN-UNIFY-1 (ES-1) — the unified EsignComposer, full-page. ADDITIVE route:
// the old flows (/attorney/esign/new → NewEnvelopeWizard, PrepareSignature)
// stay live and untouched until the ES-5 cutover flips every entry point here
// and deletes them (design §8/§11).
import { EsignComposer } from '@/components/esign/EsignComposer'

export default function EsignComposePage() {
  return (
    <div className="li-esign li-esign-prepare">
      <div className="li-esign-head">
        <div>
          <h1 className="li-esign-title">eSign</h1>
          <p className="li-esign-sub">
            Upload a PDF, add recipients with roles, and send — signers get a secure signing link,
            viewers a read-only link, copy recipients the executed document.
          </p>
        </div>
      </div>
      <div className="li-esign-wiz-card">
        <EsignComposer source={{ kind: 'upload' }} />
      </div>
    </div>
  )
}
