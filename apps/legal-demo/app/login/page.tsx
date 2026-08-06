'use client'

// HOST-TENANCY-1 — the attorney Google sign-in, moved verbatim from app/page.tsx
// so it has a host-independent address: on a firm subdomain the root is the
// firm's landing page, but an attorney standing there still needs a way in, and
// on legacy/canonical hosts the root page renders this same component so /
// behaves exactly as it always has.
//
// LOGIN-RESTYLE-1 — the surface (not the behaviour) now matches the Legal
// Instruments marketing sign-in at instruments.legal, so the door into the
// product looks like the site the attorney arrived from. Styling lives in
// login.module.css; globals.css is untouched.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { EB_Garamond } from 'next/font/google'
import { fetchSession } from '@/lib/auth'
import { Wavefield } from '@/components/Wavefield'
import styles from './login.module.css'

// FIRM-LANDING-3 follow-up: the sign-in sits in the same comp shell as the
// firm landing (cream radial + wavefield + halo) so the door matches the
// front door. The waves use the landing's default blue — this is the PRODUCT's
// sign-in (it exists on every host), so it never tints to a firm's color.
const WAVE_BRAND = '#4B9CD3'
const WAVE_BRAND_DEEP = '#35719A'

// The app's global serif (app/layout.tsx) loads EB Garamond 500/600/700 — the
// marketing sign-in's "Sign in" is the lighter 400 face. Loading that one weight
// here keeps it scoped to this route instead of changing global typography.
const garamondDisplay = EB_Garamond({ subsets: ['latin'], weight: '400', display: 'swap' })

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Already signed in (valid httpOnly cookie / dev shim)? Skip the login page.
    fetchSession().then((session) => {
      if (cancelled) return
      if (session) {
        router.replace('/attorney')
        return
      }
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        const err = params.get('error')
        if (err === 'not_allowed')
          setError('That Google account is not authorized to access this workspace.')
        else if (err) setError(decodeURIComponent(err))
      }
    })
    return () => {
      cancelled = true
    }
  }, [router])

  function signIn() {
    window.location.href = '/api/auth/google/init?mode=signin&return_to=/attorney'
  }

  return (
    <main className={styles.page}>
      <Wavefield
        brand={WAVE_BRAND}
        brandDeep={WAVE_BRAND_DEEP}
        className={styles.waves}
        idSuffix="login"
      />
      <div className={styles.halo} aria-hidden />
      <div className={styles.masthead}>
        <a href="https://instruments.legal" className={styles.wordmarkLink}>
          <img
            src="/brand/wordmark-navy-bluegold.svg"
            alt="Legal Instruments"
            className={styles.wordmark}
          />
        </a>
      </div>
      <div className={styles.card}>
        <div className={styles.hairline} />
        <div className={styles.brand}>
          <img src="/brand/li-tile-navy-bluegold.svg" alt="" width={52} className={styles.tile} />
          <h1 className={`${styles.title} ${garamondDisplay.className}`}>Sign in</h1>
        </div>
        {error && (
          <div className={styles.alert} role="alert">
            {error}
          </div>
        )}
        <button type="button" className={styles.google} onClick={signIn}>
          <GoogleIcon />
          Continue with Google
        </button>
        <p className={styles.note}>Only authorized firm accounts can sign in.</p>
      </div>
      <div className={styles.footer}>
        Prospective client?{' '}
        <Link href="/book" className={styles.footerLink}>
          Book a consultation →
        </Link>
      </div>
    </main>
  )
}

function GoogleIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 48 48"
      className={styles.googleIcon}
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2.1 5-4.4 6.5v5.4h7.1c4.2-3.8 6.6-9.5 6.6-15.9z"
      />
      <path
        fill="#34A853"
        d="M24 46c6 0 11-2 14.5-5.4l-7.1-5.4c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.6-3.9-12.3-9.1H4.5v5.7C8.1 41.2 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.7 28.2c-.4-1.3-.7-2.7-.7-4.2s.3-2.9.7-4.2v-5.7H4.5C2.9 17.3 2 20.5 2 24s.9 6.7 2.5 9.9l7.2-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.4c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 3.9 30 2 24 2 15.4 2 8.1 6.8 4.5 14.1l7.2 5.7C13.4 14.3 18.3 10.4 24 10.4z"
      />
    </svg>
  )
}
