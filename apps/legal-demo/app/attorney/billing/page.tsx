'use client'

// Billing (Session 4). Three tabs over the billing read/write MCP tools:
//   Unbilled — unbilled time + expense ledger entries grouped by client → matter,
//              select entries and generate an invoice.
//   Invoices — issued invoices with lines; send (activation-gated in v1).
//   Rates    — READ-ONLY mirror of the client billable rates the Clients/Services
//              screens (S2) persist; the editor is NOT reimplemented here.
import { Fragment, useCallback, useEffect, useState } from 'react'
import { Tabs } from '@/components/Tabs'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

// ── Shared types (mirror verticals/legal/src/queries/billing.ts) ───────────────
interface UnbilledEntry {
  kind: 'time' | 'expense'
  sourceEventId: string
  date: string | null
  description: string
  durationMinutes: number | null
  quantity: string
  rate: string | null
  amount: string | null
}
interface UnbilledMatter {
  matterEntityId: string
  matterNumber: string
  entries: UnbilledEntry[]
  total: string
}
interface UnbilledClient {
  clientEntityId: string | null
  clientName: string
  billableRate: string | null
  billingType: string | null
  matters: UnbilledMatter[]
  total: string
}
interface InvoiceSummary {
  invoiceEntityId: string
  invoiceNumber: string
  status: string
  clientName: string
  total: string
  currency: string
  issuedDate: string | null
  lineCount: number
  createdAt: string
}
interface InvoiceLine {
  lineEntityId: string
  kind: string
  description: string
  quantity: string
  rate: string
  amount: string
  sourceEventId: string | null
  matterNumber: string | null
}
interface InvoiceDetail extends InvoiceSummary {
  clientEntityId: string | null
  matterEntityId: string | null
  dueDate: string | null
  notes: string | null
  lines: InvoiceLine[]
}
interface ClientSummary {
  clientEntityId: string
  name: string
  billableRate: string | null
  billingType: string | null
  matterCount: number
}

function money(amount: string | null, currency = 'USD'): string {
  if (amount === null) return '—'
  return `${currency === 'USD' ? '$' : currency + ' '}${amount}`
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

// ── Unbilled tab ───────────────────────────────────────────────────────────────
function UnbilledTab({ onIssued }: { onIssued: () => void }) {
  const [clients, setClients] = useState<UnbilledClient[] | null>(null)
  const [currency, setCurrency] = useState('USD')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [rateOverrides, setRateOverrides] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const r = await callAttorneyMcp<{ clients: UnbilledClient[]; currency: string }>({
        toolName: 'legal.billing.unbilled',
      })
      setClients(r.clients)
      setCurrency(r.currency)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])

  const toggle = (id: string) => setSelected((s) => ({ ...s, [id]: !s[id] }))

  async function generate(c: UnbilledClient) {
    const lines = c.matters
      .flatMap((m) => m.entries)
      .filter((e) => selected[e.sourceEventId])
      .map((e) => ({
        sourceEventId: e.sourceEventId,
        kind: e.kind,
        rateOverride:
          e.kind === 'time' && !e.rate ? (rateOverrides[e.sourceEventId] ?? null) : null,
      }))
    if (lines.length === 0) {
      setError('Select at least one entry for this client.')
      return
    }
    setBusy(c.clientEntityId ?? '__none__')
    setError(null)
    setNotice(null)
    try {
      const res = await callAttorneyMcp<{
        invoiceNumber: string
        total: string
        lineCount: number
      }>({
        toolName: 'legal.invoice.issue',
        input: { clientEntityId: c.clientEntityId, currency, lines },
      })
      setNotice(
        `Issued ${res.invoiceNumber} — ${money(res.total, currency)} (${res.lineCount} lines).`,
      )
      setSelected({})
      setRateOverrides({})
      await refresh()
      onIssued()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (error && clients === null) return <div className="alert alert-error">{error}</div>
  if (clients === null)
    return (
      <div className="loading-block">
        <span className="spinner" /> Loading…
      </div>
    )

  const billable = clients.filter((c) => c.clientEntityId)
  const orphans = clients.filter((c) => !c.clientEntityId)

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert">{notice}</div>}
      {clients.length === 0 && (
        <div className="loading-block">
          Nothing unbilled — every time/expense entry is invoiced.
        </div>
      )}

      {billable.map((c) => (
        <section key={c.clientEntityId} style={{ marginBottom: '1.4rem', padding: '1rem' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem' }}
          >
            <h3 style={{ margin: 0 }}>{c.clientName}</h3>
            <span className="badge info">
              {c.billableRate ? `${money(c.billableRate, currency)}/hr` : 'no rate set'}
              {c.billingType ? ` · ${c.billingType}` : ''}
            </span>
            <strong style={{ marginLeft: 'auto' }}>Unbilled {money(c.total, currency)}</strong>
            <button
              className="primary"
              disabled={busy === c.clientEntityId}
              onClick={() => generate(c)}
            >
              {busy === c.clientEntityId ? '…' : 'Generate invoice'}
            </button>
          </div>
          {c.matters.map((m) => (
            <div key={m.matterEntityId} style={{ marginBottom: '0.8rem' }}>
              <div style={{ color: 'var(--muted)', fontSize: '0.82rem', marginBottom: '0.2rem' }}>
                {m.matterNumber} · {money(m.total, currency)}
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '2rem' }}></th>
                    <th>Date</th>
                    <th>Kind</th>
                    <th>Description</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th style={{ textAlign: 'right' }}>Rate</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {m.entries.map((e) => (
                    <tr key={e.sourceEventId}>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!selected[e.sourceEventId]}
                          onChange={() => toggle(e.sourceEventId)}
                          aria-label="select entry"
                        />
                      </td>
                      <td>{fmtDate(e.date)}</td>
                      <td>
                        <span className={`badge ${e.kind === 'time' ? 'info' : ''}`}>{e.kind}</span>
                      </td>
                      <td>{e.description}</td>
                      <td style={{ textAlign: 'right' }}>
                        {e.kind === 'time' ? `${e.quantity}h` : e.quantity}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {e.rate ? (
                          money(e.rate, currency)
                        ) : e.kind === 'time' ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="rate"
                            value={rateOverrides[e.sourceEventId] ?? ''}
                            onChange={(ev) =>
                              setRateOverrides((s) => ({
                                ...s,
                                [e.sourceEventId]: ev.target.value,
                              }))
                            }
                            style={{ width: '5rem', textAlign: 'right' }}
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>{money(e.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      ))}

      {orphans.map((c) => (
        <section key="__none__" style={{ marginBottom: '1.4rem', padding: '1rem', opacity: 0.85 }}>
          <h3 style={{ marginTop: 0 }}>{c.clientName}</h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
            These matters aren’t linked to a client yet, so they can’t be invoiced. Attach the
            matter to a client (Clients screen) first. Unbilled {money(c.total, currency)}.
          </p>
        </section>
      ))}
    </div>
  )
}

// ── Invoices tab ─────────────────────────────────────────────────────────────
function InvoicesTab({ reloadKey }: { reloadKey: number }) {
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<InvoiceDetail | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const linkStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: 'var(--accent, #1a3a6b)',
    cursor: 'pointer',
    padding: 0,
    font: 'inherit',
  }

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const r = await callAttorneyMcp<{ invoices: InvoiceSummary[] }>({
        toolName: 'legal.invoice.list',
      })
      setInvoices(r.invoices)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh, reloadKey])

  async function open(id: string) {
    if (openId === id) {
      setOpenId(null)
      setDetail(null)
      return
    }
    setOpenId(id)
    setDetail(null)
    try {
      const r = await callAttorneyMcp<{ invoice: InvoiceDetail | null }>({
        toolName: 'legal.invoice.get',
        input: { invoiceEntityId: id },
      })
      setDetail(r.invoice)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function send(inv: InvoiceSummary) {
    setBusy(inv.invoiceEntityId)
    setError(null)
    setNotice(null)
    try {
      const r = await callAttorneyMcp<{
        delivered: boolean
        to: string
      }>({
        toolName: 'legal.invoice.send',
        input: {
          invoiceEntityId: inv.invoiceEntityId,
          // The "Pay now" link in the email lands on this app's portal.
          payUrlBase: typeof window !== 'undefined' ? window.location.origin : '',
        },
      })
      setNotice(`${inv.invoiceNumber} emailed to ${r.to} with a Pay-now link.`)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (error && invoices === null) return <div className="alert alert-error">{error}</div>
  if (invoices === null)
    return (
      <div className="loading-block">
        <span className="spinner" /> Loading…
      </div>
    )

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert">{notice}</div>}
      {invoices.length === 0 ? (
        <div className="loading-block">No invoices yet. Generate one from the Unbilled tab.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Client</th>
              <th>Status</th>
              <th>Issued</th>
              <th style={{ textAlign: 'right' }}>Lines</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <Fragment key={inv.invoiceEntityId}>
                <tr>
                  <td>
                    <button style={linkStyle} onClick={() => open(inv.invoiceEntityId)}>
                      <strong>{inv.invoiceNumber}</strong>
                    </button>
                  </td>
                  <td>{inv.clientName}</td>
                  <td>
                    <span className={`badge ${inv.status === 'sent' ? 'ok' : 'info'}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td>{fmtDate(inv.issuedDate)}</td>
                  <td style={{ textAlign: 'right' }}>{inv.lineCount}</td>
                  <td style={{ textAlign: 'right' }}>{money(inv.total, inv.currency)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      style={{ ...linkStyle, marginRight: '0.7rem' }}
                      onClick={() => open(inv.invoiceEntityId)}
                    >
                      {openId === inv.invoiceEntityId ? 'Hide' : 'View'}
                    </button>
                    <button
                      className="primary"
                      disabled={busy === inv.invoiceEntityId}
                      onClick={() => send(inv)}
                    >
                      {busy === inv.invoiceEntityId ? '…' : 'Send'}
                    </button>
                  </td>
                </tr>
                {openId === inv.invoiceEntityId && (
                  <tr key={`${inv.invoiceEntityId}-detail`}>
                    <td colSpan={7} style={{ background: 'var(--surface-2, #f7f7fa)' }}>
                      {detail === null ? (
                        <div className="loading-block">
                          <span className="spinner" /> Loading lines…
                        </div>
                      ) : (
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Kind</th>
                              <th>Matter</th>
                              <th>Description</th>
                              <th style={{ textAlign: 'right' }}>Qty</th>
                              <th style={{ textAlign: 'right' }}>Rate</th>
                              <th style={{ textAlign: 'right' }}>Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.lines.map((l) => (
                              <tr key={l.lineEntityId}>
                                <td>
                                  <span className={`badge ${l.kind === 'time' ? 'info' : ''}`}>
                                    {l.kind}
                                  </span>
                                </td>
                                <td>{l.matterNumber ?? '—'}</td>
                                <td>{l.description}</td>
                                <td style={{ textAlign: 'right' }}>{l.quantity}</td>
                                <td style={{ textAlign: 'right' }}>
                                  {money(l.rate, detail.currency)}
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  {money(l.amount, detail.currency)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Rates tab (read-only mirror) ───────────────────────────────────────────────
function RatesTab() {
  const [clients, setClients] = useState<ClientSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const r = await callAttorneyMcp<{ clients: ClientSummary[] }>({
          toolName: 'legal.client.list',
        })
        setClients(r.clients)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [])

  if (error) return <div className="alert alert-error">{error}</div>
  if (clients === null)
    return (
      <div className="loading-block">
        <span className="spinner" /> Loading…
      </div>
    )

  return (
    <div>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Read-only mirror of the client billable rates set on the Clients screen. Per-service pricing
        is configured under Services. Time entries roll up at the client’s rate (override per line
        when issuing).
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Client</th>
            <th>Billing type</th>
            <th style={{ textAlign: 'right' }}>Billable rate</th>
            <th style={{ textAlign: 'right' }}>Matters</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.clientEntityId}>
              <td>
                <strong>{c.name}</strong>
              </td>
              <td>{c.billingType ?? '—'}</td>
              <td style={{ textAlign: 'right' }}>
                {c.billableRate ? `${money(c.billableRate)}/hr` : '—'}
              </td>
              <td style={{ textAlign: 'right' }}>{c.matterCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function BillingPage() {
  // Bump to re-pull the Invoices tab after issuing from the Unbilled tab.
  const [reloadKey, setReloadKey] = useState(0)

  return (
    <main>
      <div className="attorney-page-head">
        <h1 style={{ margin: 0 }}>Billing</h1>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: '-0.4rem' }}>
        Roll unbilled time and expenses up into invoices, then send them. No payments or trust/IOLTA
        accounting in this version.
      </p>
      <Tabs
        tabs={[
          {
            key: 'unbilled',
            label: 'Unbilled',
            content: <UnbilledTab onIssued={() => setReloadKey((k) => k + 1)} />,
          },
          { key: 'invoices', label: 'Invoices', content: <InvoicesTab reloadKey={reloadKey} /> },
          { key: 'rates', label: 'Rates', content: <RatesTab /> },
        ]}
      />
    </main>
  )
}
