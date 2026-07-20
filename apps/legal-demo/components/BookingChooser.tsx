'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { BookTopbar } from '@/components/BookTopbar'
import { PortalSignInInline } from '@/components/PortalSignInInline'
import { ArrowRightIcon, LockIcon, UserIcon } from '@/components/icons'
import { useI18n } from '@/lib/i18n'

// A1.1 — the ONE on-brand first screen for both booking surfaces (/book and
// /book/[slug]): a two-path fork between "I already work with you" (portal
// sign-in, in place, lands on /portal — a returning client wants THEIR
// portal, not another consultation) and "I'm new" (continues into whichever
// flow the caller renders next — the wizard's service picker or the front
// door's slot picker). The stepper/progress rail only appears once the
// second path is chosen (the plan's "stepper appears only after choosing").
export function BookingChooser({
  firmName,
  onContinueAsNewClient,
}: {
  firmName: string | null
  onContinueAsNewClient: () => void
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [showSignIn, setShowSignIn] = useState(false)

  return (
    <main className="bk-shell">
      <div className="bk-aurora" aria-hidden />
      <div className="bk-frame">
        <BookTopbar firmName={firmName} />
        <section className="bk-card">
          <div className="bk-stage">
            <div className="bk-stage-head">
              <h1 className="bk-h1">{t('chooser.title', undefined, 'Welcome')}</h1>
              <p className="bk-sub">
                {t('chooser.subtitle', undefined, 'How would you like to continue?')}
              </p>
            </div>

            {!showSignIn ? (
              <>
                <div className="bk-service-grid">
                  <button
                    type="button"
                    className="bk-service-card"
                    onClick={() => setShowSignIn(true)}
                  >
                    <span className="bk-service-icon">
                      <LockIcon size={20} />
                    </span>
                    <span className="bk-service-text">
                      <span className="bk-service-title">
                        {t('chooser.signin_title', undefined, 'Sign In To Your Client Portal')}
                      </span>
                      <span className="bk-service-desc">
                        {t(
                          'chooser.signin_desc',
                          undefined,
                          'Already a client? View your matter, documents, and messages.',
                        )}
                      </span>
                    </span>
                  </button>
                  <button type="button" className="bk-service-card" onClick={onContinueAsNewClient}>
                    <span className="bk-service-icon">
                      <UserIcon size={20} />
                    </span>
                    <span className="bk-service-text">
                      <span className="bk-service-title">
                        {t('chooser.new_title', undefined, 'Continue As New Client')}
                      </span>
                      <span className="bk-service-desc">
                        {t(
                          'chooser.new_desc',
                          undefined,
                          'Tell us what you need and grab a time that works for you.',
                        )}
                      </span>
                    </span>
                    <span className="bk-chooser-cta" aria-hidden>
                      <ArrowRightIcon size={16} />
                    </span>
                  </button>
                </div>
                <p className="bk-chooser-foot">
                  <a href="/portal/login" className="bk-linklike">
                    {t('chooser.firm_login', undefined, 'Firm login')}
                  </a>
                </p>
              </>
            ) : (
              <>
                <PortalSignInInline
                  continuePath="/portal"
                  onSignedIn={async () => {
                    router.push('/portal')
                  }}
                />
                <div className="bk-actions">
                  <button
                    type="button"
                    className="bk-btn bk-btn-ghost"
                    onClick={() => setShowSignIn(false)}
                  >
                    {t('common.back')}
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
