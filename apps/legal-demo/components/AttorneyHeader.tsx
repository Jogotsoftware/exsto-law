'use client'

import { useEffect, useState } from 'react'
import { fetchSession, clearDevSession, type DemoSession } from '@/lib/auth'
import { SearchBar } from '@/components/SearchBar'

export function AttorneyHeader() {
  const [session, setSession] = useState<DemoSession | null>(null)

  useEffect(() => {
    document.body.classList.remove('surface-client')
    let cancelled = false
    fetchSession().then((s) => {
      if (!cancelled) setSession(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function handleSignOut() {
    // Clear the dev shim (no-op in prod) and navigate to the server logout
    // route, which clears the httpOnly cookie and redirects to '/'. We use a
    // full navigation (not router.push) so the Set-Cookie response applies.
    clearDevSession()
    window.location.href = '/api/auth/logout'
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
