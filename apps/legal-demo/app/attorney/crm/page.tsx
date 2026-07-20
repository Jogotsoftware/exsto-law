'use client'

// CRM › Clients — the firm's accounts (a client is the billing parent that
// groups contacts and matters). This is the CRM home; the Contacts tab is its
// sibling. Creating one fires legal.client.create through the core (the first
// place an attorney can add a CRM record by hand — contacts otherwise only
// arrive via intake). Each row links to the client page.
//
// li-wp-j: restyled to the comp's CRM list (header + search + grid table with
// the status filter embedded in its own column header). "New client" opens a
// comp-toned Modal instead of an inline form section (the create flow itself —
// legal.client.create — is unchanged, still real, still wired).
//
// WP B3 (founder-approved, comp parity): the comp's Clients list shows a
// WEBSITE column (docs/design/legal-instruments/legal-instruments.dc.html
// crmCols, S.crmTab === 'clients' branch) where this table previously showed
// Billing — a documented deviation, now reversed. Billing is unchanged on the
// client detail page (stat card) and in the "New client" create flow below;
// only this list column swaps.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { Modal } from '@/components/Modal'
import { PlusIcon, SearchIcon } from '@/components/icons'
import { CrmListTable, type CrmColumn } from '@/components/CrmListTable'
import { CRM_STATUS_META, crmInitials, formatCrmDate, type CrmBucket } from '@/lib/crmStatus'

interface ClientSummary {
  clientEntityId: string
  name: string | null
  billableRate: string | null
  billingType: string | null
  website: string | null
  mainContactId: string | null
  mainContactName: string | null
  contactCount: number
  matterCount: number
  crmBucket: CrmBucket
  lastActivityAt: string
  createdAt: string
}

type BillingType = '' | 'hourly' | 'fixed'
const MONEY_RE = /^\d+(\.\d{1,2})?$/

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<CrmBucket | ''>('')

  function load(): void {
    callAttorneyMcp<{ clients: ClientSummary[] }>({ toolName: 'legal.client.list' })
      .then((r) => setClients(r.clients))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }

  useEffect(load, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (clients ?? []).filter((c) => {
      if (statusFilter && c.crmBucket !== statusFilter) return false
      if (!q) return true
      return [c.name ?? '', c.mainContactName ?? ''].some((s) => s.toLowerCase().includes(q))
    })
  }, [clients, query, statusFilter])

  const columns: CrmColumn<ClientSummary>[] = [
    {
      key: 'name',
      label: 'Company',
      width: '1.6fr',
      sortValue: (c) => c.name ?? '',
      render: (c) => (
        <span className="li-crm-cell-name">
          <span className="li-crm-avatar">{crmInitials(c.name || '?')}</span>
          <span className="li-crm-cell-text">{c.name || '(unnamed client)'}</span>
        </span>
      ),
    },
    {
      key: 'contact',
      label: 'Contact',
      width: '1.3fr',
      sortValue: (c) => c.mainContactName ?? '',
      render: (c) => <span className="li-crm-cell-text">{c.mainContactName || '—'}</span>,
    },
    {
      key: 'website',
      label: 'Website',
      width: '1.4fr',
      sortValue: (c) => c.website ?? '',
      render: (c) => <span className="li-crm-cell-text">{c.website || '—'}</span>,
    },
    {
      key: 'matters',
      label: 'Matters',
      width: '.8fr',
      sortValue: (c) => c.matterCount,
      render: (c) => `${c.matterCount} matter${c.matterCount === 1 ? '' : 's'}`,
    },
    {
      key: 'status',
      label: 'Status',
      width: '.9fr',
      render: (c) => {
        const meta = CRM_STATUS_META[c.crmBucket]
        return (
          <span className="li-crm-status" style={{ background: meta.bg, color: meta.fg }}>
            <span className="li-crm-status-dot" style={{ background: meta.fg }} />
            {meta.label}
          </span>
        )
      },
    },
    {
      key: 'last',
      label: 'Last Activity',
      width: '1fr',
      sortValue: (c) => c.lastActivityAt,
      render: (c) => formatCrmDate(c.lastActivityAt),
    },
  ]

  return (
    <>
      <div className="li-crm-list-head">
        <h1 className="li-crm-list-title">
          Clients
          {clients && <span className="li-crm-list-count">{clients.length}</span>}
        </h1>
        <button type="button" className="li-crm-list-newbtn" onClick={() => setShowNew(true)}>
          <PlusIcon size={16} />
          New Client
        </button>
      </div>

      {showNew && <NewClientModal onClose={() => setShowNew(false)} onCreated={load} />}

      {error && <div className="alert alert-error">{error}</div>}

      <div className="li-crm-toolbar">
        <div className="li-crm-search">
          <SearchIcon size={16} />
          <input
            type="search"
            placeholder="Search name, email, company"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {clients && <span className="li-crm-shown">{visible.length} shown</span>}
      </div>

      {clients === null && !error ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      ) : (
        <CrmListTable
          rows={visible}
          columns={columns}
          getRowKey={(c) => c.clientEntityId}
          getHref={(c) => `/attorney/crm/${c.clientEntityId}`}
          statusColumnKey="status"
          statusValue={statusFilter}
          onStatusChange={setStatusFilter}
          emptyLabel={
            clients && clients.length === 0
              ? 'No clients yet. Create one to start a CRM record.'
              : 'No matches.'
          }
        />
      )}
    </>
  )
}

// Manual client create (legal.client.create) — the only place an attorney adds a
// CRM record by hand; every other client/contact arrives via intake. Kept as a
// Modal (not yet the comp's fully bespoke chrome — WP-M restyles the shared
// Modal primitive itself) rather than the old inline form section.
function NewClientModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [billingType, setBillingType] = useState<BillingType>('')
  const [rate, setRate] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const canSubmit = name.trim() !== ''

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || busy) return
    if (billingType !== '' && rate.trim() && !MONEY_RE.test(rate.trim())) {
      setErr('Enter the rate as an amount like 350 or 350.00.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const input: Record<string, unknown> = { client_name: name.trim() }
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
      onCreated()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New Client"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            form="new-client-form"
            className="primary"
            disabled={!canSubmit || busy}
          >
            {busy ? 'Creating…' : 'Create client'}
          </button>
        </>
      }
    >
      <form
        id="new-client-form"
        onSubmit={submit}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
      >
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
        {err && <div className="alert alert-error">{err}</div>}
      </form>
    </Modal>
  )
}
