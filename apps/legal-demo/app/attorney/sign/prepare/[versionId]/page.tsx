'use client'

// Attorney "prepare for signature" screen (the DocuSign-style flow). Reached from
// the review page's "Send for signature" button. The four-step wizard itself lives
// in the shared <PrepareSignature> component (also embedded in the signature-task
// window); this page wraps it in the eSign chrome. The component shows its own
// "Envelope sent" confirmation with a link to the new envelope, so this page needs
// no post-send block.
import { use } from 'react'
import { PrepareSignature } from '@/components/PrepareSignature'

export default function PrepareSignPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params)

  return (
    <div className="li-esign li-esign-prepare">
      <div className="li-esign-head">
        <div>
          <h1 className="li-esign-title">Send for signature</h1>
          <p className="li-esign-sub">
            Confirm the document, add signers, place fields, and send the envelope.
          </p>
        </div>
      </div>
      <div className="li-esign-wiz-card">
        <PrepareSignature
          documentVersionId={versionId}
          cancelHref={`/attorney/review/${versionId}`}
        />
      </div>
    </div>
  )
}
