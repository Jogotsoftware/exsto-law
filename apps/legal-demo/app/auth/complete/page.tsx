'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { safeInternalPath } from '@/lib/safeRedirect'

// This page now only handles the CALENDAR/MAIL connect bounce. Sign-in no longer
// passes through here: the callback route sets the httpOnly session cookie and
// redirects straight to the `continue` path, so there is no client session to
// write. Calendar mode just confirms the connection and bounces back.
export default function AuthCompletePage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const email = params.get('email') ?? ''
    // This page is directly reachable with an arbitrary ?continue= — re-validate
    // here too (defense in depth) so router.replace can't be steered off-site.
    const cont = safeInternalPath(params.get('continue'))
    const calendarConnected = params.get('calendar_connected') === '1'
    setEmail(email)

    if (calendarConnected) {
      router.replace(cont)
      return
    }

    // Any other arrival here is unexpected (signin sets the cookie + redirects
    // directly). Don't strand the user — bounce to the validated continue path.
    router.replace(cont)
  }, [router])

  if (error) {
    return (
      <main>
        <div style={{ maxWidth: 460, margin: '4rem auto 0' }}>
          <div className="login-card">
            <div className="alert alert-error">{error}</div>
            <Link href="/">
              <button style={{ width: '100%' }}>Try a different account</button>
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main>
      <div className="loading-block" style={{ marginTop: '4rem' }}>
        <span className="spinner" /> Finishing up{email ? ` for ${email}` : ''}…
      </div>
    </main>
  )
}
