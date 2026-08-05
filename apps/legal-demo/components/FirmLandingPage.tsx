import Link from 'next/link'
import { ArrowRightIcon, LockIcon } from '@/components/icons'

// HOST-TENANCY-1 — the v0 landing page a visitor sees at {slug}.{base}/. Kept
// deliberately generic (firm name + stock line, no per-firm copy) because Phase 6
// makes the content attorney-editable; this shell only has to be on-brand and
// point at the three real destinations. Server-renderable on purpose: no state,
// no fetches — the firm name is resolved by the page that renders it — and it
// reuses the booking funnel's bk-* classes so the public surfaces read as one.
export function FirmLandingPage({ firmName }: { firmName: string }): React.JSX.Element {
  return (
    <main className="bk-shell">
      <div className="bk-aurora" aria-hidden />
      <div className="bk-frame">
        <section className="bk-card">
          <div className="bk-stage">
            <div className="bk-stage-head">
              <h1 className="bk-h1">{firmName}</h1>
              <p className="bk-sub">Legal services, handled properly.</p>
            </div>
            <div className="bk-actions">
              <Link href="/book" className="bk-btn bk-btn-primary bk-btn-wide">
                Book a consultation
                <ArrowRightIcon size={18} />
              </Link>
            </div>
            <div className="bk-service-grid">
              {/* bk-service-card is styled for <button>; as an anchor it only
                  needs the underline suppressed — not worth a new CSS class. */}
              <Link
                href="/portal/login"
                className="bk-service-card"
                style={{ textDecoration: 'none' }}
              >
                <span className="bk-service-icon">
                  <LockIcon size={20} />
                </span>
                <span className="bk-service-text">
                  <span className="bk-service-title">Client portal</span>
                  <span className="bk-service-desc">
                    Already a client? View your matter, documents, and messages.
                  </span>
                </span>
                <span className="bk-chooser-cta" aria-hidden>
                  <ArrowRightIcon size={16} />
                </span>
              </Link>
            </div>
            <p className="bk-chooser-foot">
              <Link href="/login" className="bk-linklike">
                Attorney sign in
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
