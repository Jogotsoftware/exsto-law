'use client'

// Contacts CRM. Everyone who's reached the firm; standing (Active / Prospective /
// Prior) is derived from their matter statuses, not manually managed.
//
// li-wp-j: restyled to the comp's CRM list — the old four-way tab strip
// (All/Active/Prospective/Prior) is replaced by the status filter embedded in
// the STATUS column's own header (WIRING.md ADAPT item), matching the Clients
// tab's table exactly. VERIFIED during this WP: there is no legal.contact.create
// tool — contacts only ever arrive via intake (booking, questionnaire, matter
// open), never a manual attorney-authored record — so unlike Clients, there is
// no "New contact" button here (a button with no backing flow is a dead
// control). See WIRING.md §WP-J for the reclassification.

import { useEffect, useMemo, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { SearchIcon } from '@/components/icons'
import { CrmListTable, type CrmColumn } from '@/components/CrmListTable'
import { CRM_STATUS_META, crmInitials, formatCrmDate, type CrmBucket } from '@/lib/crmStatus'

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

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<CrmBucket | ''>('')

  useEffect(() => {
    callAttorneyMcp<{ contacts: Contact[] }>({ toolName: 'legal.contact.list' })
      .then((r) => setContacts(r.contacts))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (contacts ?? []).filter((c) => {
      if (statusFilter && c.crmBucket !== statusFilter) return false
      if (!q) return true
      return [c.fullName, c.email, c.companyName ?? '', c.phone ?? ''].some((s) =>
        s.toLowerCase().includes(q),
      )
    })
  }, [contacts, query, statusFilter])

  const columns: CrmColumn<Contact>[] = [
    {
      key: 'name',
      label: 'Contact',
      width: '1.6fr',
      sortValue: (c) => c.fullName || c.email,
      render: (c) => (
        <span className="li-crm-cell-name">
          <span className="li-crm-avatar">{crmInitials(c.fullName || c.email || '?')}</span>
          <span className="li-crm-cell-text">{c.fullName || c.email || '(no name)'}</span>
        </span>
      ),
    },
    {
      key: 'company',
      label: 'Company',
      width: '1.3fr',
      sortValue: (c) => c.companyName ?? '',
      render: (c) => <span className="li-crm-cell-text">{c.companyName || '—'}</span>,
    },
    {
      key: 'email',
      label: 'Email',
      width: '1.6fr',
      sortValue: (c) => c.email,
      render: (c) => <span className="li-crm-cell-text">{c.email || '—'}</span>,
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
      label: 'Last activity',
      width: '1fr',
      sortValue: (c) => c.lastActivityAt,
      render: (c) => formatCrmDate(c.lastActivityAt),
    },
  ]

  return (
    <>
      <div className="li-crm-list-head">
        <h1 className="li-crm-list-title">
          Contacts
          {contacts && <span className="li-crm-list-count">{contacts.length}</span>}
        </h1>
      </div>

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
        {contacts && <span className="li-crm-shown">{visible.length} shown</span>}
      </div>

      {contacts === null && !error ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      ) : (
        <CrmListTable
          rows={visible}
          columns={columns}
          getRowKey={(c) => c.contactEntityId}
          getHref={(c) => `/attorney/crm/contacts/${c.contactEntityId}`}
          statusColumnKey="status"
          statusValue={statusFilter}
          onStatusChange={setStatusFilter}
          emptyLabel={contacts && contacts.length === 0 ? 'No contacts yet.' : 'No matches.'}
        />
      )}
    </>
  )
}
