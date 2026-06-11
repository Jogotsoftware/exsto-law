'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { clearSession, readSession, type DemoSession } from '@/lib/auth'
import { SearchBar } from '@/components/SearchBar'

export function AttorneyHeader() {
  const router = useRouter()
  const pathname = usePathname()
  const [session, setSession] = useState<DemoSession | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.body.classList.remove('surface-client')
    setSession(readSession())
  }, [])

  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(e: MouseEvent) {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  function handleSignOut() {
    clearSession()
    router.push('/')
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')
  const isHomeActive = pathname === '/attorney'

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="nav-menu-wrap" ref={menuWrapRef}>
          <button
            type="button"
            className="nav-toggle"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
          {menuOpen && (
            <div className="nav-menu" role="menu">
              <Link href="/attorney" className={isHomeActive ? 'active' : ''} role="menuitem">
                Home
              </Link>
              <Link
                href="/attorney/matters"
                className={isActive('/attorney/matters') ? 'active' : ''}
                role="menuitem"
              >
                Matters
              </Link>
              <Link
                href="/attorney/review"
                className={isActive('/attorney/review') ? 'active' : ''}
                role="menuitem"
              >
                Review
              </Link>
              <Link
                href="/attorney/calendar"
                className={isActive('/attorney/calendar') ? 'active' : ''}
                role="menuitem"
              >
                Calendar
              </Link>
              <Link
                href="/attorney/mail"
                className={isActive('/attorney/mail') ? 'active' : ''}
                role="menuitem"
              >
                Mail
              </Link>
              <Link
                href="/attorney/contacts"
                className={isActive('/attorney/contacts') ? 'active' : ''}
                role="menuitem"
              >
                Contacts
              </Link>
              <Link
                href="/attorney/templates"
                className={isActive('/attorney/templates') ? 'active' : ''}
                role="menuitem"
              >
                Templates
              </Link>
              <Link
                href="/attorney/services"
                className={isActive('/attorney/services') ? 'active' : ''}
                role="menuitem"
              >
                Services
              </Link>
              <Link
                href="/attorney/settings"
                className={isActive('/attorney/settings') ? 'active' : ''}
                role="menuitem"
              >
                Settings
              </Link>
            </div>
          )}
        </div>
        <div className="app-brand">
          <Link href="/attorney" style={{ color: 'inherit' }}>
            <strong>Pacheco Law</strong>
          </Link>
        </div>
        <SearchBar />
        {session && (
          <div className="signed-in-as">
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
