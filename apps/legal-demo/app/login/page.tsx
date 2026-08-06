'use client'

// HOST-TENANCY-1 — the attorney Google sign-in, host-independent: on a firm
// subdomain the root is the firm's landing page, but an attorney standing
// there still needs a way in, and on legacy/canonical hosts the root page
// renders this same component so / behaves exactly as it always has.
//
// COMP-RESTYLE-1 — rebuilt to the approved "Pacheco Sign In" comp: the quiet
// gold wavefield on a cream radial, the Legal Instruments wordmark as page
// chrome, and one 420px white card on a blue glow holding the FIRM's logo
// (tenant setting, resolved via legal.public.firm_branding when this host
// belongs to a firm — the product tile when not), "Welcome back, Counselor."
// in Poppins, the single Google button, and the authorized-accounts note.
// Styling lives in login.module.css; globals.css is untouched.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Poppins } from 'next/font/google'
import { fetchSession } from '@/lib/auth'
import { callClientMcp } from '@/lib/mcpClient'
import { Wavefield } from '@/components/Wavefield'
import styles from './login.module.css'

// The comp's pl-blue pair — the glow/wave blues are fixed product accents on
// this PRODUCT page (it exists on every host), so they never tint per-firm.
const WAVE_BRAND = '#4B9CD3'
const WAVE_BRAND_DEEP = '#2E6DA4'

// The comp's headline face — one weight, scoped to this route so global
// typography (Public Sans / EB Garamond) is untouched.
const poppins = Poppins({ subsets: ['latin'], weight: '500', display: 'swap' })

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [firmLogo, setFirmLogo] = useState<{ src: string; alt: string } | null>(null)

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
    // The in-card lockup is the FIRM's uploaded logo when this request
    // resolves to a firm (subdomain / ?firm=). No resolvable firm (the
    // canonical host) or no uploaded logo → the product tile fallback.
    callClientMcp<{ firmName: string | null; logoDataUrl: string | null }>({
      toolName: 'legal.public.firm_branding',
    })
      .then((b) => {
        if (!cancelled && b.logoDataUrl) setFirmLogo({ src: b.logoDataUrl, alt: b.firmName ?? '' })
      })
      .catch(() => {})
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
        variant="signin"
      />
      <div className={styles.masthead}>
        <a href="https://instruments.legal" className={styles.wordmarkLink}>
          <img
            src="/brand/wordmark-navy-bluegold.svg"
            alt="Legal Instruments"
            className={styles.wordmark}
          />
        </a>
      </div>
      <div className={styles.cardWrap}>
        <div className={styles.glow} aria-hidden />
        <div className={styles.card}>
          <div className={styles.inner}>
            <div className={styles.lockup}>
              {firmLogo ? (
                <img src={firmLogo.src} alt={firmLogo.alt} className={styles.firmLogo} />
              ) : (
                <img src="/brand/li-tile-navy-bluegold.svg" alt="" className={styles.tile} />
              )}
            </div>
            <h1 className={`${styles.title} ${poppins.className}`}>Welcome back, Counselor.</h1>
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
        </div>
      </div>
    </main>
  )
}

// The comp's 21px Google "G".
function GoogleIcon() {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 48 48"
      className={styles.googleIcon}
      aria-hidden="true"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}
