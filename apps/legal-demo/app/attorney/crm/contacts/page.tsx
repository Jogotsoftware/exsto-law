'use client'

// Contacts CRM (WP2.2). Everyone who's reached the firm, in four views derived
// from their matter status — Active / Prospective / Prior / All. A contact's
// standing is a fact about their matters, not a manually-managed stage.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

type CrmBucket = 'active' | 'prospective' | 'prior'
type Tab = 'all' | CrmBucket

interface Contact {
  contactEntityId: string
  fullName: string
  email: string
  phone: string | null
  companyName: string | null
  attributionSource: string | null
  matterCount: number
  crmBucket: CrmBucket
  firstSeenAt: string
  lastActivityAt: string
}

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'all', label: 'All', hint: 'Everyone who has reached the firm' },
  { key: 'active', label: 'Active', hint: 'At least one open matter' },
  { key: 'prospective', label: 'Prospective', hint: 'A lead — no matter yet' },
  { key: 'prior', label: 'Prior', hint: 'Past clients — every matter closed' },
]

const BUCKET_LABEL: Record<CrmBucket, string> = {
  active: 'Active',
  prospective: 'Prospective',
  prior: 'Prior',
}
const BUCKET_COLOR: Record<CrmBucket, string> = {
  active: '#16a34a',
  prospective: '#3b82f6',
  prior: '#6b7280',
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const d = Math.round((Date.now() - t) / 86_400_000)
  if (d <= 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d}d ago`
  return `${Math.round(d / 30)}mo ago`
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<Tab>('all')

  useEffect(() => {
    callAttorneyMcp<{ contacts: Contact[] }>({ toolName: 'legal.contact.list' })
      .then((r) => setContacts(r.contacts))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: 0, active: 0, prospective: 0, prior: 0 }
    for (const x of contacts ?? []) {
      c.all += 1
      c[x.crmBucket] += 1
    }
    return c
  }, [contacts])

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (contacts ?? []).filter((c) => {
      if (tab !== 'all' && c.crmBucket !== tab) return false
      if (!t) return true
      return [c.fullName, c.email, c.companyName ?? '', c.phone ?? ''].some((s) =>
        s.toLowerCase().includes(t),
      )
    })
  }, [contacts, q, tab])

  return (
    <>
      <div
        className="attorney-page-head"
        style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}
      >
        <h1 style={{ margin: 0 }}>Contacts</h1>
        {contacts && <span style={{ color: 'var(--muted)' }}>{contacts.length}</span>}
      </div>
      <p style={{ color: 'var(--muted)', marginTop: '-0.3rem' }}>
        Everyone who&rsquo;s reached the firm, by standing (derived from their matters).
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="crm-tabs" role="tablist">
        {TABS.map((tEntry) => (
          <button
            key={tEntry.key}
            role="tab"
            aria-selected={tab === tEntry.key}
            className={`crm-tab ${tab === tEntry.key ? 'active' : ''}`}
            title={tEntry.hint}
            onClick={() => setTab(tEntry.key)}
          >
            {tEntry.label}
            <span className="crm-tab-count">{counts[tEntry.key]}</span>
          </button>
        ))}
      </div>

      <input
        type="search"
        placeholder="Search name, email, company, phone…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%', maxWidth: 440, margin: '0.9rem 0 1.1rem' }}
      />

      {contacts === null ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : visible.length === 0 ? (
        <p className="text-muted">
          No contacts{q ? ' match your search' : tab === 'all' ? ' yet' : ` in ${tab}`}.
        </p>
      ) : (
        <div className="matter-list">
          {visible.map((c) => (
            <Link
              key={c.contactEntityId}
              href={`/attorney/crm/contacts/${c.contactEntityId}`}
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
              <span
                className="crm-pill"
                style={{ color: BUCKET_COLOR[c.crmBucket], borderColor: BUCKET_COLOR[c.crmBucket] }}
              >
                {BUCKET_LABEL[c.crmBucket]}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
