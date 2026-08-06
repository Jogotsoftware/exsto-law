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
        {/* RAIL-FOLLOWUPS-1: the top bar is now a FULL-WIDTH band at the head of
            the shell — a sibling above the rail, not a child of .li-main-col.
            The rail (transparent when collapsed since RAIL-WEBSITE-STYLE-1) used
            to leave a light 58x64 notch to the bar's left; spanning the bar
            across the whole viewport removes it, and the rail now starts
            BENEATH the bar inside .li-shell-body.
            Tradeoff, deliberate: this reverses UIWALK-1's "the bar slides away
            with the page on scroll". A bar that spans over the rail cannot
            scroll away without taking the rail with it, so it is pinned again. */}
        <AttorneyTopBar />
        <div className="li-shell-body">
          <AttorneyRail />
          <div className="li-main-col">
            <div className="li-scrollcol">
              <main id="main" className="li-main" tabIndex={-1}>
                <div className="li-main-inner">{children}</div>
              </main>
            </div>
          </div>
        </div>
      </AttorneyShell>
      {/* Floating beta-feedback assistant — inside the gate, so attorneys only. */}
      <FeedbackChat />
    </AttorneyAuthGate>
  )
}
