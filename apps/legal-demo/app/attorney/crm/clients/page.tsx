'use client'

// CRM › Clients — companies engaged as clients (engagement_status = 'client').
// This is a filtered view over companies; make a company a client by setting its
// engagement on the company page. Each row links to the company page.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

interface CompanySummary {
  companyEntityId: string
  name: string
  engagementStatus: string
  billableRate: string | null
  billingType: string | null
  contactCount: number
  matterCount: number
}

export default function ClientsPage() {
  const [clients, setClients] = useState<CompanySummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callAttorneyMcp<{ companies: CompanySummary[] }>({
      toolName: 'legal.company.list',
      input: { onlyClients: true },
    })
      .then((r) => setClients(r.companies))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <>
      <div
        className="attorney-page-head"
        style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}
      >
        <h1 style={{ margin: 0 }}>Clients</h1>
        {clients && <span style={{ color: 'var(--muted)' }}>{clients.length}</span>}
        <div style={{ marginLeft: 'auto' }}>
          <Link href="/attorney/crm" className="back-link">
            All companies
          </Link>
        </div>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: '-0.3rem' }}>
        Companies you&rsquo;re engaged with as clients. Set a company&rsquo;s engagement to
        &ldquo;client&rdquo; on its page to add it here.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {clients === null ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : clients.length === 0 ? (
        <p className="text-muted">
          No clients yet. Create a company under the Companies tab and set its engagement to
          &ldquo;client&rdquo;.
        </p>
      ) : (
        <div className="matter-list">
          {clients.map((c) => (
            <Link
              key={c.companyEntityId}
              href={`/attorney/crm/company/${c.companyEntityId}`}
              className="matter-row"
            >
              <div>
                <div className="matter-row-title">{c.name || '(unnamed company)'}</div>
                <div className="matter-row-sub">
                  {c.contactCount} contact{c.contactCount === 1 ? '' : 's'} · {c.matterCount} matter
                  {c.matterCount === 1 ? '' : 's'}
                  {c.billingType &&
                    ` · ${c.billingType}${c.billableRate ? ` $${c.billableRate}` : ''}`}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
