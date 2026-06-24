'use client'

// Attorney "prepare for signature" screen (the DocuSign-style flow). Reached from
// the review page's "Send for signature" button. The form itself lives in the shared
// <PrepareSignature> component (also embedded in the signature-task window); this
// page just wraps it in page chrome and, on send, shows the signing-status link.
import { use, useState } from 'react'
import Link from 'next/link'
import { PrepareSignature, type SendResult } from '@/components/PrepareSignature'

export default function PrepareSignPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params)
  const [sent, setSent] = useState<SendResult | null>(null)

  return (
    <div className="page">
      <h1>{sent ? 'Sent for signature' : 'Prepare for signature'}</h1>
      <PrepareSignature
        documentVersionId={versionId}
        onSent={setSent}
        cancelHref={`/attorney/review/${versionId}`}
      />
      {sent && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Link href={`/attorney/sign/status/${sent.envelopeId}`}>
            <button className="primary">View signing status →</button>
          </Link>
        </div>
      )}
    </div>
  )
}
