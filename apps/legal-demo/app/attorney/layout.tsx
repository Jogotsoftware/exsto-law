import type { ReactNode } from 'react'
import { AttorneyRail } from '@/components/AttorneyRail'
import { AttorneyShell } from '@/components/AttorneyShell'
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
      {/* UIWALK-2: AttorneyShell renders the .li-shell div and stamps the firm
          brand-color CSS vars on it (topbar + rail tint from one source). */}
      <AttorneyShell>
        <AttorneyRail />
        <div className="li-main-col">
          {/* UIWALK-1: the top bar lives INSIDE the scroll region so it slides
              away with the page on scroll (it was pinned above it before). */}
          <div className="li-scrollcol">
            <AttorneyTopBar />
            <main id="main" className="li-main" tabIndex={-1}>
              <div className="li-main-inner">{children}</div>
            </main>
          </div>
        </div>
      </AttorneyShell>
      {/* Floating beta-feedback assistant — inside the gate, so attorneys only. */}
      <FeedbackChat />
    </AttorneyAuthGate>
  )
}
