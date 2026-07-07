'use client'

// CRM › Client page (WP2.2). A client is the parent that groups its contacts and
// matters (migration 0020). Shows both, each clickable through, plus Contract-D
// Email / Schedule launchers aimed at the client's main contact. Lives under the
// CRM layout (Clients · Contacts tabs); contacts link into the Contacts tab.

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { BackButton } from '@/components/BackButton'
import { PageHead } from '@/components/PageHead'
import { launchCompose, launchScheduler } from '@/lib/contractD'

type BillingType = '' | 'hourly' | 'fixed'
const MONEY_RE = /^\d+(\.\d{1,2})?$/

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
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<{
    name: string
    billingType: BillingType
    rate: string
    mainContactId: string
  }>({ name: '', billingType: '', rate: '', mainContactId: '' })

  const load = useCallback(() => {
    callAttorneyMcp<{ client: ClientDetail | null }>({
      toolName: 'legal.client.get',
      input: { clientEntityId: id },
    })
      .then((r) => (r.client ? setClient(r.client) : setNotFound(true)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [id])

  useEffect(load, [load])

  const mainContact = client?.contacts.find((c) => c.isMain) ?? client?.contacts[0] ?? null

  function beginEdit() {
    if (!client) return
    setForm({
      name: client.name ?? '',
      billingType: (client.billingType as BillingType) ?? '',
      rate: client.billableRate ?? '',
      mainContactId: client.mainContactId ?? '',
    })
    setError(null)
    setEditing(true)
  }

  async function save() {
    if (!client) return
    if (!form.name.trim()) {
      setError('A client name is required.')
      return
    }
    if (form.billingType !== '' && form.rate.trim() && !MONEY_RE.test(form.rate.trim())) {
      setError('Enter the rate as an amount like 350 or 350.00.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const input: Record<string, unknown> = {
        client_entity_id: client.clientEntityId,
        client_name: form.name.trim(),
      }
      if (form.billingType !== '') {
        input.billing_type = form.billingType
        if (form.rate.trim()) input.billable_rate = form.rate.trim()
      }
      if (form.mainContactId) input.main_contact_id = form.mainContactId
      await callAttorneyMcp({ toolName: 'legal.client.update', input })
      setEditing(false)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <BackButton fallback="/attorney/crm" />

      {error && <div className="alert alert-error">{error}</div>}
      {notFound ? (
        <p className="text-muted">Client not found.</p>
      ) : !client ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : (
        <>
          <PageHead
            title={client.name || 'Client'}
            actions={
              <>
                {!editing && <button onClick={beginEdit}>Edit</button>}
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
              </>
            }
          />

          {editing && (
            <section style={{ borderLeft: '3px solid var(--border)' }}>
              <h2>Edit client</h2>
              <div className="form-grid">
                <label>
                  <span>Client name</span>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </label>
                <label>
                  <span>Billing</span>
                  <select
                    value={form.billingType}
                    onChange={(e) =>
                      setForm({ ...form, billingType: e.target.value as BillingType })
                    }
                  >
                    <option value="">Not set</option>
                    <option value="hourly">Hourly</option>
                    <option value="fixed">Fixed</option>
                  </select>
                </label>
                {form.billingType !== '' && (
                  <label>
                    <span>{form.billingType === 'hourly' ? 'Hourly rate (USD)' : 'Fee (USD)'}</span>
                    <input
                      inputMode="decimal"
                      value={form.rate}
                      onChange={(e) => setForm({ ...form, rate: e.target.value })}
                      placeholder="350.00"
                    />
                  </label>
                )}
                {client.contacts.length > 0 && (
                  <label>
                    <span>Main contact</span>
                    <select
                      value={form.mainContactId}
                      onChange={(e) => setForm({ ...form, mainContactId: e.target.value })}
                    >
                      <option value="">—</option>
                      {client.contacts.map((c) => (
                        <option key={c.contactEntityId} value={c.contactEntityId}>
                          {c.fullName || c.email || '(no name)'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' }}>
                <button className="primary" onClick={save} disabled={busy || !form.name.trim()}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => {
                    setEditing(false)
                    setError(null)
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </section>
          )}

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
                    href={`/attorney/crm/contacts/${c.contactEntityId}`}
                    className="matter-row"
                  >
                    <div>
                      <div className="matter-row-title">
                        {c.fullName || c.email || '(no name)'}
                        {c.isMain && (
                          <span className="crm-pill" style={{ marginLeft: 'var(--space-2)' }}>
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
