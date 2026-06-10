'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { setSession } from '@/lib/auth'

export default function AuthCompletePage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const email = params.get('email') ?? ''
    const actorId = params.get('actor_id') ?? ''
    const tenantId = params.get('tenant_id') ?? ''
    const displayName = params.get('display_name') ?? email
    const cont = params.get('continue') ?? '/attorney'
    const calendarConnected = params.get('calendar_connected') === '1'
    setEmail(email)

    // Calendar connect flow doesn't change the session — just bounce back.
    if (calendarConnected) {
      router.replace(cont)
      return
    }

    if (!email || !actorId || !tenantId) {
      setError('Sign-in did not return a valid session. Try again.')
      return
    }

    setSession({
      email,
      displayName,
      actorId,
      tenantId,
      signedInAt: new Date().toISOString(),
    })
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
        <span className="spinner" /> Signing you in{email ? ` as ${email}` : ''}…
      </div>
    </main>
  )
}
