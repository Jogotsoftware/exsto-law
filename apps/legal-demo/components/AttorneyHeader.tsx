'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { clearSession, readSession, type DemoSession } from '@/lib/auth'
import { SearchBar } from '@/components/SearchBar'

export function AttorneyHeader() {
  const router = useRouter()
  const [session, setSession] = useState<DemoSession | null>(null)

  useEffect(() => {
    document.body.classList.remove('surface-client')
    setSession(readSession())
  }, [])

  function handleSignOut() {
    clearSession()
    router.push('/')
  }

  // Navigation lives in the left sidebar (WP8 UI standard); the header keeps
  // search + session only.
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <SearchBar />
        {session && (
          <div className="signed-in-as" style={{ marginLeft: 'auto' }}>
            <span className="signed-in-dot" />
            <strong>{session.displayName}</strong>
            <button
              onClick={handleSignOut}
              style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem', marginLeft: '0.5rem' }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
