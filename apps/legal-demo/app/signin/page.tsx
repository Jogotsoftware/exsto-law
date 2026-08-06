'use client'

// AUTH-HANDOFF-1 — the NEUTRAL sign-in door, the marketing site's target
// (instruments.legal → app.instruments.legal/signin). It doesn't know or ask
// which firm you belong to: clients authenticate with email+password and the
// bridge routes them — same-host mint when their firm has no subdomain, or a
// single-use handoff hop to {their-firm}.instruments.legal (the inline panel's
// bridge already follows that navigation). Attorneys take the Google leg, whose
// callback does the same slug-aware hop. ?error= is how a failed handoff
// exchange (expired/replayed token, wrong host) lands back here.

import { useEffect, useState } from 'react'
import { PortalSignInInline } from '@/components/PortalSignInInline'
import { Wavefield } from '@/components/Wavefield'

const ERROR_COPY: Record<string, string> = {
  signin_expired: 'That sign-in link expired — please sign in again.',
  wrong_host: 'That sign-in link was for a different site — please sign in again.',
  account_unavailable: 'This account is not available. Contact your firm.',
}

export default function NeutralSignInPage() {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get('error')
    if (err) setError(ERROR_COPY[err] ?? decodeURIComponent(err))
  }, [])

  return (
    <div className="bk-shell">
      <Wavefield
        brand="#7BAFD4"
        brandDeep="#5A97C4"
        className="bk-waves"
        idSuffix="bk-signin"
        variant="intake"
      />
      <main className="bk-stage" style={{ maxWidth: 460, margin: '0 auto' }}>
        <div className="bk-card" style={{ padding: 'var(--space-6)' }}>
          <h1 className="bk-h1" style={{ fontSize: '1.6rem' }}>
            Sign in
          </h1>
          <p className="bk-sub">Client portal access — we&apos;ll take you to your firm.</p>
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
          <PortalSignInInline
            continuePath="/portal"
            onSignedIn={() => {
              // Same-host mint (firm without a subdomain): the cookie is set
              // here — enter the portal directly.
              window.location.assign('/portal')
            }}
          />
          <div
            style={{
              marginTop: 'var(--space-5)',
              paddingTop: 'var(--space-4)',
              borderTop: '1px solid var(--border, rgba(255,255,255,0.12))',
              textAlign: 'center',
            }}
          >
            <a
              href="/api/auth/google/init?mode=signin&return_to=/attorney"
              className="bk-btn-ghost"
            >
              Attorney? Sign in with Google
            </a>
          </div>
        </div>
      </main>
    </div>
  )
}
