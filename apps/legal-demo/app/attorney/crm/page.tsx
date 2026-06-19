'use client'

// CRM › Companies — the accounts. A company groups its contacts and matters
// (migration 0067). Creating one fires company.create through the core. Each row
// links to the company page. Engagement status (prospect/client/inactive) marks
// which companies are clients (the Clients tab is the client-engaged filter).
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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

type BillingType = '' | 'hourly' | 'fixed'
type Engagement = 'prospect' | 'client' | 'inactive'
const MONEY_RE = /^\d+(\.\d{1,2})?$/

export default function CompaniesPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<CompanySummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [engagement, setEngagement] = useState<Engagement>('prospect')
  const [billingType, setBillingType] = useState<BillingType>('')
  const [rate, setRate] = useState('')

  function load() {
    callAttorneyMcp<{ companies: CompanySummary[] }>({ toolName: 'legal.company.list' })
      .then((r) => setCompanies(r.companies))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }
  useEffect(load, [])

  async function create() {
    const companyName = name.trim()
    if (!companyName) {
      setError('A company name is required.')
      return
    }
    if (billingType !== '' && rate.trim() && !MONEY_RE.test(rate.trim())) {
      setError('Enter the rate as an amount like 350 or 350.00.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const input: Record<string, unknown> = {
        company_name: companyName,
        engagement_status: engagement,
      }
      if (billingType !== '') {
        input.billing_type = billingType
        if (rate.trim()) input.billable_rate = rate.trim()
      }
      const res = await callAttorneyMcp<{ effects?: Array<{ companyEntityId?: string }> }>({
        toolName: 'legal.company.create',
        input,
      })
      const newId = res.effects?.[0]?.companyEntityId
      if (newId) {
        router.push(`/attorney/crm/company/${newId}`)
        return
      }
      setCreating(false)
      setName('')
      setEngagement('prospect')
      setBillingType('')
      setRate('')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div
        className="attorney-page-head"
        style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}
      >
        <h1 style={{ margin: 0 }}>Companies</h1>
        {companies && <span style={{ color: 'var(--muted)' }}>{companies.length}</span>}
        <div style={{ marginLeft: 'auto' }}>
          {!creating && (
            <button className="primary" onClick={() => setCreating(true)}>
              New company
            </button>
          )}
        </div>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: '-0.3rem' }}>
        The account that groups a company&rsquo;s contacts and matters. Mark one as a client to see
        it under the Clients tab.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {creating && (
        <section style={{ borderLeft: '3px solid var(--border)' }}>
          <h2 style={{ marginTop: 0 }}>New company</h2>
          <div className="form-grid">
            <label>
              <span>Company name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme Holdings LLC"
                autoFocus
              />
            </label>
            <label>
              <span>Engagement</span>
              <select
                value={engagement}
                onChange={(e) => setEngagement(e.target.value as Engagement)}
              >
                <option value="prospect">Prospect</option>
                <option value="client">Client</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label>
              <span>Billing</span>
              <select
                value={billingType}
                onChange={(e) => setBillingType(e.target.value as BillingType)}
              >
                <option value="">Not set</option>
                <option value="hourly">Hourly</option>
                <option value="fixed">Fixed</option>
              </select>
            </label>
            {billingType !== '' && (
              <label>
                <span>{billingType === 'hourly' ? 'Hourly rate (USD)' : 'Fee (USD)'}</span>
                <input
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder="350.00"
                />
              </label>
            )}
          </div>
          <div style={{ marginTop: '0.9rem', display: 'flex', gap: '0.5rem' }}>
            <button className="primary" onClick={create} disabled={busy || !name.trim()}>
              {busy ? 'Creating…' : 'Create company'}
            </button>
            <button
              onClick={() => {
                setCreating(false)
                setError(null)
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {companies === null ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : companies.length === 0 ? (
        <p className="text-muted">No companies yet. Create one to start a CRM record.</p>
      ) : (
        <div className="matter-list">
          {companies.map((c) => (
            <Link
              key={c.companyEntityId}
              href={`/attorney/crm/company/${c.companyEntityId}`}
              className="matter-row"
            >
              <div>
                <div className="matter-row-title">{c.name || '(unnamed company)'}</div>
                <div className="matter-row-sub">
                  {c.engagementStatus}
                  {' · '}
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
