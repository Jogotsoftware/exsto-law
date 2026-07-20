'use client'

// Attorney signing-status view. The table lives in the shared <EnvelopeStatusView>
// component (also embedded in the signature-task window); this page wraps it.
import { use } from 'react'
import { EnvelopeStatusView } from '@/components/EnvelopeStatusView'

export default function SignStatusPage({ params }: { params: Promise<{ envelopeId: string }> }) {
  const { envelopeId } = use(params)
  return (
    <div className="page">
      <h1>Signing Status</h1>
      <EnvelopeStatusView envelopeId={envelopeId} />
    </div>
  )
}
