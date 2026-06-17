'use client'

// Contacts CRM (replaces the old Import tab). Everyone who's reached the firm,
// grouped by pipeline stage (derived from their matters), searchable. Each row
// opens the contact detail. Stage groups follow the lead pipeline:
// Prospect → Consulted → Engaged → Active → Closed.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

type LeadStage = 'prospect' | 'consulted' | 'engaged' | 'active' | 'closed'

interface Contact {
  contactEntityId: string
  fullName: string
  email: string
  phone: string | null
  companyName: string | null
  attributionSource: string | null
  matterCount: number
  leadStage: LeadStage
  firstSeenAt: string
  lastActivityAt: string
}

const STAGES: { key: LeadStage; label: string; color: string }[] = [
  { key: 'prospect', label: 'Prospect', color: '#94a3b8' },
  { key: 'consulted', label: 'Consulted', color: '#3b82f6' },
  { key: 'engaged', label: 'Engaged', color: '#8b5cf6' },
  { key: 'active', label: 'Active', color: '#16a34a' },
  { key: 'closed', label: 'Closed', color: '#6b7280' },
]

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const d = Math.round((Date.now() - t) / 86_400_000)
  if (d <= 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d}d ago`
  const mo = Math.round(d / 30)
  return `${mo}mo ago`
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    callAttorneyMcp<{ contacts: Contact[] }>({ toolName: 'legal.contact.list' })
      .then((r) => setContacts(r.contacts))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return contacts ?? []
    return (contacts ?? []).filter((c) =>
      [c.fullName, c.email, c.companyName ?? '', c.phone ?? ''].some((s) =>
        s.toLowerCase().includes(t),
      ),
    )
  }, [contacts, q])

  const byStage = useMemo(() => {
    const m: Record<LeadStage, Contact[]> = {
      prospect: [],
      consulted: [],
      engaged: [],
      active: [],
      closed: [],
    }
    for (const c of filtered) m[c.leadStage].push(c)
    return m
  }, [filtered])

  return (
    <main>
      <div
        className="attorney-page-head"
        style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}
      >
        <h1 style={{ margin: 0 }}>Contacts</h1>
        {contacts && <span style={{ color: 'var(--muted)' }}>{contacts.length}</span>}
      </div>
      <p style={{ color: 'var(--muted)', marginTop: '-0.3rem' }}>
        Everyone who&rsquo;s reached the firm, by pipeline stage (derived from their matters).
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <input
        type="search"
        placeholder="Search name, email, company, phone…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%', maxWidth: 440, marginBottom: '1.1rem' }}
      />

      {contacts === null ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-muted">No contacts{q ? ' match your search' : ' yet'}.</p>
      ) : (
        STAGES.map((stage) => {
          const rows = byStage[stage.key]
          if (rows.length === 0) return null
          return (
            <section key={stage.key}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '0.45rem',
                }}
              >
                <span
                  style={{ width: 10, height: 10, borderRadius: '50%', background: stage.color }}
                />
                <strong>{stage.label}</strong>
                <span style={{ color: 'var(--muted)' }}>{rows.length}</span>
              </div>
              <div className="matter-list">
                {rows.map((c) => (
                  <Link
                    key={c.contactEntityId}
                    href={`/attorney/contacts/${c.contactEntityId}`}
                    className="matter-row"
                  >
                    <div>
                      <div className="matter-row-title">{c.fullName || c.email || '(no name)'}</div>
                      <div className="matter-row-sub">
                        {c.companyName && `${c.companyName} · `}
                        {c.email}
                        {c.matterCount > 0 &&
                          ` · ${c.matterCount} matter${c.matterCount === 1 ? '' : 's'}`}
                        {c.lastActivityAt && ` · ${timeAgo(c.lastActivityAt)}`}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )
        })
      )}
    </main>
  )
}
