'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { adminLogout, fetchAdminSession } from '@/lib/mcpAdmin'

const LINKS: Array<{ href: string; label: string }> = [
  { href: '/admin/tenants', label: 'Tenants' },
  { href: '/admin/modules', label: 'Modules' },
  { href: '/admin/sandbox', label: 'Sandbox' },
  { href: '/admin/access', label: 'Access' },
  { href: '/admin/audit', label: 'Audit' },
]

export function AdminTopNav() {
  const pathname = usePathname()
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    fetchAdminSession().then((s) => setEmail(s?.email ?? null))
  }, [])

  async function signOut() {
    await adminLogout()
    window.location.href = '/admin'
  }

  return (
    <nav
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-3) var(--space-5)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      <strong style={{ marginRight: 'var(--space-4)' }}>Exsto Platform</strong>
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname?.startsWith(l.href + '/')
        return (
          <Link
            key={l.href}
            href={l.href}
            style={{
              textDecoration: 'none',
              fontWeight: active ? 700 : 400,
              color: active ? 'var(--accent)' : 'inherit',
            }}
          >
            {l.label}
          </Link>
        )
      })}
      <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: '0.85rem' }}>
        {email ?? ''}
      </span>
      <button onClick={signOut} style={{ fontSize: '0.85rem' }}>
        Sign out
      </button>
    </nav>
  )
}
