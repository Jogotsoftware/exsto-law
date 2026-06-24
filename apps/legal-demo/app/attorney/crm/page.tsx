'use client'

// CRM › Clients — the firm's accounts (a client is the billing parent that
// groups contacts and matters). This is the CRM home; the Contacts tab is its
// sibling. Creating one fires legal.client.create through the core (the first
// place an attorney can add a CRM record by hand — contacts otherwise only
// arrive via intake). Each row links to the client page.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PageHead } from '@/components/PageHead'

interface ClientSummary {
  clientEntityId: string
  name: string | null
  billableRate: string | null
  billingType: string | null
  mainContactId: string | null
  contactCount: number
  matterCount: number
  createdAt: string
}

type BillingType = '' | 'hourly' | 'fixed'

const MONEY_RE = /^\d+(\.\d{1,2})?$/

export default function ClientsPage() {
  const router = useRouter()
  const [clients, setClients] = useState<ClientSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)

  // New-client form.
  const [name, setName] = useState('')
  const [billingType, setBillingType] = useState<BillingType>('')
  const [rate, setRate] = useState('')

  function load() {
    callAttorneyMcp<{ clients: ClientSummary[] }>({ toolName: 'legal.client.list' })
      .then((r) => setClients(r.clients))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }

  useEffect(load, [])

  async function create() {
    const clientName = name.trim()
    if (!clientName) {
      setError('A client name is required.')
      return
    }
    if (billingType !== '' && rate.trim() && !MONEY_RE.test(rate.trim())) {
      setError('Enter the rate as an amount like 350 or 350.00.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const input: Record<string, unknown> = { client_name: clientName }
      if (billingType !== '') {
        input.billing_type = billingType
        if (rate.trim()) input.billable_rate = rate.trim()
      }
      const res = await callAttorneyMcp<{ effects?: Array<{ clientEntityId?: string }> }>({
        toolName: 'legal.client.create',
        input,
      })
      const newId = res.effects?.[0]?.clientEntityId
      if (newId) {
        router.push(`/attorney/crm/${newId}`)
        return
      }
      // Fall back to refreshing the list if the id wasn't returned.
      setCreating(false)
      setName('')
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
    <main>
      <PageHead
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            Clients
            {clients && <span style={{ color: 'var(--muted)' }}>{clients.length}</span>}
          </span>
        }
        description="The billing parent that groups a client’s contacts and matters."
        actions={
          !creating && (
            <button className="primary" onClick={() => setCreating(true)}>
              New client
            </button>
          )
        }
      />

      {error && <div className="alert alert-error">{error}</div>}

      {creating && (
        <section>
          <h2>New client</h2>
          <div className="form-grid">
            <label>
              <span>Client name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme Holdings LLC"
                autoFocus
              />
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
          <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' }}>
            <button className="primary" onClick={create} disabled={busy || !name.trim()}>
              {busy ? 'Creating…' : 'Create client'}
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

      {clients === null ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : clients.length === 0 ? (
        <p className="text-muted">No clients yet. Create one to start a CRM record.</p>
      ) : (
        <div className="matter-list">
          {clients.map((c) => (
            <Link
              key={c.clientEntityId}
              href={`/attorney/crm/${c.clientEntityId}`}
              className="matter-row"
            >
              <div>
                <div className="matter-row-title">{c.name || '(unnamed client)'}</div>
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
    </main>
  )
}
