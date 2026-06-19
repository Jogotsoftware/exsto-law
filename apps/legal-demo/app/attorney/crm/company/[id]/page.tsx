'use client'

// CRM › Company page — the account's settings (engagement + billing), its
// contacts, and its matters. Editing engagement/billing fires company.update
// through the core. Contacts and matters are the company's children (migration
// 0067: contact_of_company / matter_of_company).
import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

interface ContactRow {
  contactEntityId: string
  fullName: string
  email: string
  phone: string | null
  isMain: boolean
}
interface MatterRow {
  matterEntityId: string
  matterNumber: string
  serviceKey: string
  status: string
}
interface CompanyDetail {
  companyEntityId: string
  name: string
  engagementStatus: string
  billableRate: string | null
  billingType: string | null
  mainContactId: string | null
  contacts: ContactRow[]
  matters: MatterRow[]
}

type Engagement = 'prospect' | 'client' | 'inactive'
type BillingType = '' | 'hourly' | 'fixed'
const MONEY_RE = /^\d+(\.\d{1,2})?$/

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [company, setCompany] = useState<CompanyDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  const [engagement, setEngagement] = useState<Engagement>('prospect')
  const [billingType, setBillingType] = useState<BillingType>('')
  const [rate, setRate] = useState('')

  function load() {
    callAttorneyMcp<{ company: CompanyDetail | null }>({
      toolName: 'legal.company.get',
      input: { companyEntityId: id },
    })
      .then((r) => {
        if (!r.company) {
          setError('Company not found.')
          return
        }
        setCompany(r.company)
        setEngagement((r.company.engagementStatus as Engagement) || 'prospect')
        setBillingType((r.company.billingType as BillingType) || '')
        setRate(r.company.billableRate ?? '')
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }
  useEffect(load, [id])

  async function save() {
    if (billingType !== '' && rate.trim() && !MONEY_RE.test(rate.trim())) {
      setError('Enter the rate as an amount like 350 or 350.00.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const input: Record<string, unknown> = {
        company_entity_id: id,
        engagement_status: engagement,
      }
      if (billingType !== '') {
        input.billing_type = billingType
        if (rate.trim()) input.billable_rate = rate.trim()
      }
      await callAttorneyMcp({ toolName: 'legal.company.update', input })
      setEditing(false)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (error && !company) {
    return (
      <>
        <div className="alert alert-error">{error}</div>
        <Link href="/attorney/crm" className="back-link">
          ← Companies
        </Link>
      </>
    )
  }
  if (!company) {
    return (
      <div className="loading-block">
        <span className="spinner" /> Loading…
      </div>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <Link href="/attorney/crm" className="back-link">
          ← Companies
        </Link>
      </div>
      <div
        className="attorney-page-head"
        style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.4rem' }}
      >
        <h1 style={{ margin: 0 }}>{company.name || '(unnamed company)'}</h1>
        <span
          style={{
            fontSize: '0.8rem',
            padding: '0.1rem 0.5rem',
            borderRadius: '999px',
            background: 'var(--border)',
            color: 'var(--muted)',
          }}
        >
          {company.engagementStatus}
        </span>
        <div style={{ marginLeft: 'auto' }}>
          {!editing && <button onClick={() => setEditing(true)}>Edit</button>}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {editing ? (
        <section style={{ borderLeft: '3px solid var(--border)' }}>
          <h2 style={{ marginTop: 0 }}>Company settings</h2>
          <div className="form-grid">
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
            <button className="primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </section>
      ) : (
        <p style={{ color: 'var(--muted)' }}>
          {company.billingType
            ? `Billing: ${company.billingType}${company.billableRate ? ` · $${company.billableRate}` : ''}`
            : 'No billing set.'}
        </p>
      )}

      <section>
        <h2>Contacts ({company.contacts.length})</h2>
        {company.contacts.length === 0 ? (
          <p className="text-muted">No contacts linked to this company yet.</p>
        ) : (
          <div className="matter-list">
            {company.contacts.map((c) => (
              <div key={c.contactEntityId} className="matter-row">
                <div>
                  <div className="matter-row-title">
                    {c.fullName || '(unnamed)'}{' '}
                    {c.isMain && <span className="text-muted">· main</span>}
                  </div>
                  <div className="matter-row-sub">
                    {c.email}
                    {c.phone ? ` · ${c.phone}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2>Matters ({company.matters.length})</h2>
        {company.matters.length === 0 ? (
          <p className="text-muted">No matters for this company yet.</p>
        ) : (
          <div className="matter-list">
            {company.matters.map((m) => (
              <Link
                key={m.matterEntityId}
                href={`/attorney/matters/${m.matterEntityId}`}
                className="matter-row"
              >
                <div>
                  <div className="matter-row-title">{m.matterNumber}</div>
                  <div className="matter-row-sub">
                    {m.serviceKey} · {m.status}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
