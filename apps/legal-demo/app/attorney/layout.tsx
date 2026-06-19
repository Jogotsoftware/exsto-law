import type { ReactNode } from 'react'
import { AttorneyTopNav } from '@/components/AttorneyTopNav'
import { AttorneyAuthGate } from '@/components/AttorneyAuthGate'
import { FeedbackChat } from '@/components/FeedbackChat'

export default function AttorneyLayout({ children }: { children: ReactNode }) {
  return (
    <AttorneyAuthGate>
      {/* Skip past the 11-item top nav straight to page content (keyboard/AT). */}
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <AttorneyTopNav />
      <div id="main" tabIndex={-1}>
        {children}
      </div>
      {/* Floating beta-feedback assistant — inside the gate, so attorneys only. */}
      <FeedbackChat />
    </AttorneyAuthGate>
  )
}
