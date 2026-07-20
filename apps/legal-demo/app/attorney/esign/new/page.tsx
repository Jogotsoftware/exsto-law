'use client'

// 0170 — "New envelope" from any PDF (DocuSign-style). Reached from the eSign
// surface header. The three-step wizard lives in <NewEnvelopeWizard>; this page
// wraps it in the eSign chrome. Drafted documents keep their own prepare flow
// (Review → Send for signature).
import { NewEnvelopeWizard } from '@/components/NewEnvelopeWizard'

export default function NewEnvelopePage() {
  return (
    <div className="li-esign li-esign-prepare">
      <div className="li-esign-head">
        <div>
          <h1 className="li-esign-title">New envelope</h1>
          <p className="li-esign-sub">
            Upload a PDF, add recipients (new ones are saved to Contacts), attach it to a matter or
            contact if you like, and send.
          </p>
        </div>
      </div>
      <div className="li-esign-wiz-card">
        <NewEnvelopeWizard />
      </div>
    </div>
  )
}
