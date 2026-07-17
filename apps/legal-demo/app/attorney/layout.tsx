import type { ReactNode } from 'react'
import { AttorneyRail } from '@/components/AttorneyRail'
import { AttorneyTopBar } from '@/components/AttorneyTopBar'
import { AttorneyAuthGate } from '@/components/AttorneyAuthGate'
import { FeedbackChat } from '@/components/FeedbackChat'

export default function AttorneyLayout({ children }: { children: ReactNode }) {
  return (
    <AttorneyAuthGate>
      {/* Skip past the rail + top bar straight to page content (keyboard/AT). */}
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="li-shell">
        <AttorneyRail />
        <div className="li-main-col">
          <AttorneyTopBar />
          <main id="main" className="li-main" tabIndex={-1}>
            <div className="li-main-inner">{children}</div>
          </main>
        </div>
      </div>
      {/* Floating beta-feedback assistant — inside the gate, so attorneys only. */}
      <FeedbackChat />
    </AttorneyAuthGate>
  )
}
