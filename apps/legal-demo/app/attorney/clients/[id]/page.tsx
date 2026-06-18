'use client'

// Client page (WP2.2). A client is the parent that groups its contacts and
// matters (migration 0020). Shows both, each clickable through, plus Contract-D
// Email / Schedule launchers aimed at the client's main contact.

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { ChevronLeftIcon } from '@/components/icons'
import { launchCompose, launchScheduler } from '@/lib/contractD'

interface ClientContactRow {
  contactEntityId: string
  fullName: string
  email: string
  phone: string | null
  isMain: boolean
}
interface ClientMatterRow {
  matterEntityId: string
  matterNumber: string
  serviceKey: string
  status: string
  createdAt: string
}
interface ClientDetail {
  clientEntityId: string
  name: string
  billableRate: string | null
  billingType: string | null
  mainContactId: string | null
  contactCount: number
  matterCount: number
  createdAt: string
  contacts: ClientContactRow[]
  matters: ClientMatterRow[]
}

function humanizeStatus(s: string): string {
  return s.replace(/_/g, ' ')
}

export default function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [client, setClient] = useState<ClientDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callAttorneyMcp<{ client: ClientDetail | null }>({
      toolName: 'legal.client.get',
      input: { clientEntityId: id },
    })
      .then((r) => (r.client ? setClient(r.client) : setNotFound(true)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [id])

  const mainContact = client?.contacts.find((c) => c.isMain) ?? client?.contacts[0] ?? null

  return (
    <main>
      <Link href="/attorney/contacts" className="back-link">
        <ChevronLeftIcon size={14} /> Contacts
      </Link>

      {error && <div className="alert alert-error">{error}</div>}
      {notFound ? (
        <p className="text-muted">Client not found.</p>
      ) : !client ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : (
        <>
          <div
            className="attorney-page-head"
            style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}
          >
            <h1 style={{ margin: 0 }}>{client.name || 'Client'}</h1>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
              <button
                onClick={() =>
                  launchCompose({
                    contactId: mainContact?.contactEntityId,
                    to: mainContact?.email,
                  })
                }
                disabled={!mainContact?.email}
                title={
                  mainContact?.email ? `Email ${mainContact.email}` : 'No contact email on file'
                }
              >
                Email
              </button>
              <button
                onClick={() => launchScheduler({ contactId: mainContact?.contactEntityId })}
                title="Schedule a meeting"
              >
                Schedule
              </button>
            </div>
          </div>

          <section>
            <div className="kv-grid">
              <div>
                <div className="kv-label">Billing</div>
                <div className="kv-value">
                  {client.billingType
                    ? `${client.billingType}${client.billableRate ? ` · $${client.billableRate}` : ''}`
                    : '—'}
                </div>
              </div>
              <div>
                <div className="kv-label">Contacts</div>
                <div className="kv-value">{client.contactCount}</div>
              </div>
              <div>
                <div className="kv-label">Matters</div>
                <div className="kv-value">{client.matterCount}</div>
              </div>
              <div>
                <div className="kv-label">Since</div>
                <div className="kv-value">{new Date(client.createdAt).toLocaleDateString()}</div>
              </div>
            </div>
          </section>

          <section>
            <h2>Contacts</h2>
            {client.contacts.length === 0 ? (
              <p className="text-muted">No contacts attached.</p>
            ) : (
              <div className="matter-list">
                {client.contacts.map((c) => (
                  <Link
                    key={c.contactEntityId}
                    href={`/attorney/contacts/${c.contactEntityId}`}
                    className="matter-row"
                  >
                    <div>
                      <div className="matter-row-title">
                        {c.fullName || c.email || '(no name)'}
                        {c.isMain && (
                          <span className="crm-pill" style={{ marginLeft: '0.5rem' }}>
                            Main
                          </span>
                        )}
                      </div>
                      <div className="matter-row-sub">
                        {c.email}
                        {c.phone && ` · ${c.phone}`}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2>Matters</h2>
            {client.matters.length === 0 ? (
              <p className="text-muted">No matters yet.</p>
            ) : (
              <div className="matter-list">
                {client.matters.map((m) => (
                  <Link
                    key={m.matterEntityId}
                    href={`/attorney/matters/${m.matterEntityId}`}
                    className="matter-row"
                  >
                    <div>
                      <div className="matter-row-title">{m.matterNumber}</div>
                      <div className="matter-row-sub">
                        {humanizeStatus(m.status)}
                        {m.serviceKey && ` · ${m.serviceKey.replace(/_/g, ' ')}`}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}
