'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fetchAdminSession } from '@/lib/mcpAdmin'

// Platform admin-console sign-in (ADR 0046). A separate boundary from the firm
// sign-in (/): admin identity resolves to a platform_admin via Google OAuth
// mode=admin, minting the distinct exsto_admin_session cookie.
export default function AdminLoginPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchAdminSession().then((session) => {
      if (cancelled) return
      if (session) {
        router.replace('/admin/tenants')
        return
      }
      if (typeof window !== 'undefined') {
        const err = new URLSearchParams(window.location.search).get('error')
        if (err) setError(decodeURIComponent(err))
      }
    })
    return () => {
      cancelled = true
    }
  }, [router])

  function signIn() {
    window.location.href = '/admin/api/auth/google/init?return_to=/admin/tenants'
  }

  return (
    <main>
      <div style={{ maxWidth: 420, margin: '4rem auto 0' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: 'var(--space-2)' }}>Exsto Platform</h1>
          <p style={{ color: 'var(--muted)' }}>Admin console</p>
        </div>
        <div className="login-card">
          {error && <div className="alert alert-error">{error}</div>}
          <button className="primary google-signin" onClick={signIn} style={{ width: '100%' }}>
            Sign in with Google
          </button>
          <p
            style={{
              color: 'var(--muted)',
              fontSize: '0.85rem',
              marginTop: 'var(--space-4)',
              textAlign: 'center',
              marginBottom: 0,
            }}
          >
            Platform administrators only.
          </p>
        </div>
      </div>
    </main>
  )
}
