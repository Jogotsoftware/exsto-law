'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { readSession } from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (readSession()) {
      router.replace('/attorney')
      return
    }
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const err = params.get('error')
      if (err === 'not_allowed')
        setError('That Google account is not authorized to access Pacheco Law.')
      else if (err) setError(decodeURIComponent(err))
    }
  }, [router])

  function signIn() {
    window.location.href = '/api/auth/google/init?mode=signin&return_to=/attorney'
  }

  return (
    <main>
      <div style={{ maxWidth: 420, margin: '4rem auto 0' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Pacheco Law</h1>
          <p style={{ color: 'var(--muted)' }}>Sign in to your dashboard</p>
        </div>
        <div className="login-card">
          {error && <div className="alert alert-error">{error}</div>}
          <button className="primary google-signin" onClick={signIn} style={{ width: '100%' }}>
            <GoogleIcon />
            Sign in with Google
          </button>
          <p
            style={{
              color: 'var(--muted)',
              fontSize: '0.85rem',
              marginTop: '1rem',
              textAlign: 'center',
              marginBottom: 0,
            }}
          >
            Only authorized firm accounts can sign in.
          </p>
        </div>
        <div
          style={{
            textAlign: 'center',
            marginTop: '1.5rem',
            fontSize: '0.9rem',
            color: 'var(--muted)',
          }}
        >
          Prospective client? <Link href="/book">Book a consultation →</Link>
        </div>
      </div>
    </main>
  )
}

function GoogleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      style={{ marginRight: '0.5rem', verticalAlign: '-3px' }}
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  )
}
