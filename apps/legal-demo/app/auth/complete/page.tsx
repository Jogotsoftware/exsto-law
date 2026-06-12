'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { safeInternalPath } from '@/lib/safeRedirect'

// This page now only handles the CALENDAR/MAIL connect bounce. Sign-in no longer
// passes through here: the callback route sets the httpOnly session cookie and
// redirects straight to the `continue` path, so there is no client session to
// write. Any arrival here just confirms and bounces to the validated path.
export default function AuthCompletePage() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    setEmail(params.get('email') ?? '')
    // Directly reachable with an arbitrary ?continue= — re-validate here too
    // (defense in depth) so router.replace can't be steered off-site.
    router.replace(safeInternalPath(params.get('continue')))
  }, [router])

  return (
    <main>
      <div className="loading-block" style={{ marginTop: '4rem' }}>
        <span className="spinner" /> Finishing up{email ? ` for ${email}` : ''}…
      </div>
    </main>
  )
}
