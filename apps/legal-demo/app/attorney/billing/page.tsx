'use client'

// Billing (Session 4). Three tabs over the billing read/write MCP tools:
//   Unbilled — unbilled time + expense ledger entries grouped by client → matter,
//              select entries and generate an invoice.
//   Invoices — issued invoices with lines; send (activation-gated in v1).
//   Rates    — READ-ONLY mirror of the client billable rates the Clients/Services
//              screens (S2) persist; the editor is NOT reimplemented here.
import { Fragment, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Tabs } from '@/components/Tabs'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

// A select-all checkbox for a table/group header: checked when every row is
// selected, indeterminate when only some are. The attorney asked for one plain
// header checkbox instead of "Select all" text. React has no `indeterminate`
// prop, so it's set on the element through a callback ref.
function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
  title,
}: {
  checked: boolean
  indeterminate: boolean
  onChange: (checked: boolean) => void
  title: string
}) {
  return (
    <input
      type="checkbox"
      ref={(el) => {
        if (el) el.indeterminate = !checked && indeterminate
      }}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      title={title}
      aria-label={title}
    />
  )
}

// ── Shared types (mirror verticals/legal/src/queries/billing.ts) ───────────────
interface UnbilledEntry {
  kind: 'time' | 'expense' | 'service_fee' | 'document_fee'
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
  matterSummary: string | null
  contactEntityId: string | null
  contactName: string | null
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
function money(amount: string | null, currency = 'USD'): string {
  if (amount === null) return '—'
  return `${currency === 'USD' ? '$' : currency + ' '}${amount}`
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}
// Plain-language label for a billable kind — the screen shows this, not the code.
function kindLabel(kind: string): string {
  switch (kind) {
    case 'time':
      return 'Time'
    case 'expense':
      return 'Expense'
    case 'service_fee':
      return 'Service fee'
    case 'document_fee':
      return 'Document fee'
    default:
      return kind.replace(/_/g, ' ')
  }
}
function kindBadgeClass(kind: string): string {
  if (kind === 'time') return 'badge info'
  if (kind === 'service_fee' || kind === 'document_fee') return 'badge ok'
  return 'badge'
}
// A base64 PDF → object URL we can show in an <iframe> and offer as a download.
function base64ToBlobUrl(base64: string, type = 'application/pdf'): string {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type }))
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
  const [setupBusy, setSetupBusy] = useState<string | null>(null)

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

  // Every entry id under one client (across its matters) — drives "select all".
  const clientEntryIds = (c: UnbilledClient) =>
    c.matters.flatMap((m) => m.entries.map((e) => e.sourceEventId))
  function setClientSelection(c: UnbilledClient, value: boolean) {
    const ids = clientEntryIds(c)
    setSelected((s) => {
      const next = { ...s }
      for (const id of ids) next[id] = value
      return next
    })
  }
  function setMatterSelection(m: UnbilledMatter, value: boolean) {
    setSelected((s) => {
      const next = { ...s }
      for (const e of m.entries) next[e.sourceEventId] = value
      return next
    })
  }

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

  // Make an orphaned matter invoiceable in one click: create a client from the
  // matter's contact and attach both (the link intake now makes automatically;
  // this rescues matters opened before that). Reuses legal.client.create.
  async function setupBilling(m: UnbilledMatter) {
    if (!m.contactEntityId) return
    setSetupBusy(m.matterEntityId)
    setError(null)
    setNotice(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.client.create',
        input: {
          client_name: m.contactName || m.matterNumber,
          main_contact_id: m.contactEntityId,
          contact_ids: [m.contactEntityId],
          matter_ids: [m.matterEntityId],
        },
      })
      setNotice(
        `Set up billing for ${m.contactName || m.matterNumber} — ${m.matterNumber} is now invoiceable.`,
      )
      await refresh()
      onIssued()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSetupBusy(null)
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
            {(() => {
              const ids = clientEntryIds(c)
              const allSelected = ids.length > 0 && ids.every((id) => selected[id])
              const someSelected = ids.some((id) => selected[id])
              return (
                <SelectAllCheckbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={(v) => setClientSelection(c, v)}
                  title={`Select all unbilled entries for ${c.clientName}`}
                />
              )
            })()}
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
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '0.4rem',
                  marginBottom: '0.2rem',
                }}
              >
                {m.matterSummary ? (
                  <>
                    <span style={{ fontWeight: 600 }}>{m.matterSummary}</span>
                    <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>
                      {m.matterNumber}
                    </span>
                  </>
                ) : (
                  <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                    {m.matterNumber}
                  </span>
                )}
                <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                  · {money(m.total, currency)}
                </span>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '2rem' }}>
                      {(() => {
                        const allSelected =
                          m.entries.length > 0 && m.entries.every((e) => selected[e.sourceEventId])
                        const someSelected = m.entries.some((e) => selected[e.sourceEventId])
                        return (
                          <SelectAllCheckbox
                            checked={allSelected}
                            indeterminate={someSelected}
                            onChange={(v) => setMatterSelection(m, v)}
                            title="Select all entries in this matter"
                          />
                        )
                      })()}
                    </th>
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
                        <span className={kindBadgeClass(e.kind)}>{kindLabel(e.kind)}</span>
                      </td>
                      <td>{e.description}</td>
                      <td style={{ textAlign: 'right' }}>
                        {e.kind === 'time'
                          ? `${e.quantity}h`
                          : e.kind === 'service_fee' || e.kind === 'document_fee'
                            ? '—'
                            : e.quantity}
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
        <section key="__none__" style={{ marginBottom: '1.4rem', padding: '1rem', opacity: 0.9 }}>
          <h3 style={{ marginTop: 0 }}>{c.clientName}</h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 0 }}>
            These matters aren’t linked to a client yet, so they can’t be invoiced. Set up billing
            to create the client from the matter’s contact and make it invoiceable. Unbilled{' '}
            {money(c.total, currency)}.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Matter</th>
                <th>Contact</th>
                <th style={{ textAlign: 'right' }}>Unbilled</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {c.matters.map((m) => (
                <tr key={m.matterEntityId}>
                  <td>{m.matterNumber}</td>
                  <td>{m.contactName ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{money(m.total, currency)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {m.contactEntityId ? (
                      <button
                        className="primary"
                        disabled={setupBusy === m.matterEntityId}
                        onClick={() => setupBilling(m)}
                      >
                        {setupBusy === m.matterEntityId ? '…' : 'Set up billing'}
                      </button>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>no contact</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
  const [pdf, setPdf] = useState<{ url: string; filename: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [paying, setPaying] = useState<string | null>(null)
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

  // Revoke a previously-opened PDF blob URL so we don't leak object URLs.
  function clearPdf() {
    setPdf((p) => {
      if (p) URL.revokeObjectURL(p.url)
      return null
    })
  }

  async function open(id: string, invoiceNumber: string) {
    if (openId === id) {
      setOpenId(null)
      clearPdf()
      return
    }
    setOpenId(id)
    clearPdf()
    try {
      // "View" shows the REAL invoice — the same branded PDF the client receives.
      const r = await callAttorneyMcp<{
        pdf: { filename: string; contentType: string; base64: string } | null
      }>({ toolName: 'legal.invoice.pdf', input: { invoiceEntityId: id } })
      if (r.pdf) {
        setPdf({
          url: base64ToBlobUrl(r.pdf.base64),
          filename: r.pdf.filename || `${invoiceNumber}.pdf`,
        })
      } else {
        setError('Could not render this invoice.')
      }
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

  // Manual "Mark paid" — records a payment through the same core action a payment
  // processor will call later. v1 has no amount prompt: it records the full total.
  async function markPaid(inv: InvoiceSummary) {
    setPaying(inv.invoiceEntityId)
    setError(null)
    setNotice(null)
    try {
      await callAttorneyMcp<{ paid: boolean }>({
        toolName: 'legal.invoice.pay',
        input: { invoiceEntityId: inv.invoiceEntityId, method: 'manual' },
      })
      setNotice(`${inv.invoiceNumber} marked paid.`)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPaying(null)
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
                    <button
                      style={linkStyle}
                      onClick={() => open(inv.invoiceEntityId, inv.invoiceNumber)}
                    >
                      <strong>{inv.invoiceNumber}</strong>
                    </button>
                  </td>
                  <td>{inv.clientName}</td>
                  <td>
                    <span
                      className={`badge ${inv.status === 'paid' || inv.status === 'sent' ? 'ok' : 'info'}`}
                    >
                      {inv.status === 'paid' ? '✓ paid' : inv.status}
                    </span>
                  </td>
                  <td>{fmtDate(inv.issuedDate)}</td>
                  <td style={{ textAlign: 'right' }}>{inv.lineCount}</td>
                  <td style={{ textAlign: 'right' }}>{money(inv.total, inv.currency)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      style={{ ...linkStyle, marginRight: '0.7rem' }}
                      onClick={() => open(inv.invoiceEntityId, inv.invoiceNumber)}
                    >
                      {openId === inv.invoiceEntityId ? 'Hide' : 'View'}
                    </button>
                    {inv.status === 'paid' ? (
                      <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Paid</span>
                    ) : (
                      <>
                        <button
                          style={{ ...linkStyle, marginRight: '0.7rem' }}
                          disabled={paying === inv.invoiceEntityId}
                          onClick={() => markPaid(inv)}
                        >
                          {paying === inv.invoiceEntityId ? '…' : 'Mark paid'}
                        </button>
                        <button
                          className="primary"
                          disabled={busy === inv.invoiceEntityId}
                          onClick={() => send(inv)}
                        >
                          {busy === inv.invoiceEntityId ? '…' : 'Send'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
                {openId === inv.invoiceEntityId && (
                  <tr key={`${inv.invoiceEntityId}-detail`}>
                    <td
                      colSpan={7}
                      style={{ background: 'var(--surface-2, #f7f7fa)', padding: '0.8rem' }}
                    >
                      {pdf === null ? (
                        <div className="loading-block">
                          <span className="spinner" /> Rendering invoice…
                        </div>
                      ) : (
                        <div>
                          <div style={{ marginBottom: '0.5rem' }}>
                            <a href={pdf.url} download={pdf.filename} style={linkStyle}>
                              Download PDF
                            </a>
                          </div>
                          <iframe
                            title={`Invoice ${inv.invoiceNumber}`}
                            src={pdf.url}
                            style={{
                              width: '100%',
                              height: 560,
                              border: '1px solid var(--border)',
                            }}
                          />
                        </div>
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

// ── Rates tab ──────────────────────────────────────────────────────────────────
// Contract K rate management: the firm default hourly rate, per-client hourly
// rates, and per-service fixed fees — ALL editable here, all resolving to the one
// source of truth (rates.ts), so a rate set here shows everywhere (Clients,
// Services, invoices).
interface RateClientRow {
  clientEntityId: string
  name: string
  ownRate: string | null
  effectiveRate: string | null
  inheritsFirmDefault: boolean
}
interface RateServiceRow {
  serviceKey: string
  displayName: string
  fixedFee: string | null
  documentFees: Record<string, string>
}
interface RatesView {
  firmDefaultRate: string | null
  clients: RateClientRow[]
  services: RateServiceRow[]
}

function RatesTab() {
  const [view, setView] = useState<RatesView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [firmDraft, setFirmDraft] = useState('')
  const [clientDraft, setClientDraft] = useState<Record<string, string>>({})
  const [serviceDraft, setServiceDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const v = await callAttorneyMcp<RatesView>({ toolName: 'legal.rates.view' })
      setView(v)
      setFirmDraft(v.firmDefaultRate ?? '')
      setClientDraft({})
      setServiceDraft({})
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])

  // One save runner: marks the row busy, calls the tool, then re-pulls the view.
  async function run(key: string, call: () => Promise<unknown>, ok: string) {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      await call()
      setNotice(ok)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (error && view === null) return <div className="alert alert-error">{error}</div>
  if (view === null)
    return (
      <div className="loading-block">
        <span className="spinner" /> Loading…
      </div>
    )

  const firmDirty = firmDraft.trim() !== '' && firmDraft.trim() !== (view.firmDefaultRate ?? '')

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert">{notice}</div>}

      <div
        style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', marginBottom: '0.5rem' }}
      >
        <label style={{ flex: '0 0 auto' }}>
          <span>Firm default hourly rate (USD)</span>
          <input
            type="number"
            inputMode="decimal"
            value={firmDraft}
            onChange={(e) => setFirmDraft(e.target.value)}
            style={{ maxWidth: '12rem' }}
          />
        </label>
        <button
          className="primary"
          disabled={busy === 'firm' || !firmDirty}
          onClick={() =>
            run(
              'firm',
              () =>
                callAttorneyMcp({
                  toolName: 'legal.firm.set_default_rate',
                  input: { rate: firmDraft.trim() },
                }),
              'Firm default rate saved.',
            )
          }
        >
          {busy === 'firm' ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        The fallback hourly rate billed when a client has no explicit rate. Set per-client rates and
        per-service fixed fees below — every edit here is the single source of truth and applies
        everywhere.
      </p>

      <h3 style={{ marginBottom: '0.4rem' }}>Client hourly rates</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Client</th>
            <th style={{ textAlign: 'right' }}>Rate (USD/hr)</th>
            <th style={{ textAlign: 'right', width: '8rem' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {view.clients.length === 0 && (
            <tr>
              <td colSpan={3} style={{ color: 'var(--muted)' }}>
                No clients yet.
              </td>
            </tr>
          )}
          {view.clients.map((c) => {
            const current = c.ownRate ?? ''
            const val = clientDraft[c.clientEntityId] ?? current
            const dirty = val.trim() !== current && val.trim() !== ''
            return (
              <tr key={c.clientEntityId}>
                <td>
                  <strong>{c.name}</strong>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder={
                      c.inheritsFirmDefault ? `${view.firmDefaultRate ?? '—'} (firm default)` : ''
                    }
                    value={val}
                    onChange={(e) =>
                      setClientDraft((s) => ({ ...s, [c.clientEntityId]: e.target.value }))
                    }
                    style={{ width: '8rem', textAlign: 'right' }}
                  />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    disabled={busy === `c:${c.clientEntityId}` || !dirty}
                    onClick={() =>
                      run(
                        `c:${c.clientEntityId}`,
                        () =>
                          callAttorneyMcp({
                            toolName: 'legal.rates.set_client',
                            input: { clientEntityId: c.clientEntityId, rate: val.trim() },
                          }),
                        `Saved rate for ${c.name}.`,
                      )
                    }
                  >
                    {busy === `c:${c.clientEntityId}` ? '…' : 'Save'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h3 style={{ marginTop: '1.2rem', marginBottom: '0.4rem' }}>Service &amp; document fees</h3>
      <p style={{ color: 'var(--muted)', marginTop: 0, fontSize: '0.85rem' }}>
        A service’s fixed fee bills when the service is marked complete. Per-document fees (billed
        when a document is approved) are set on each service’s Billing tab and shown here.
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Service</th>
            <th style={{ textAlign: 'right' }}>Fixed fee (USD)</th>
            <th style={{ textAlign: 'right', width: '8rem' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {view.services.length === 0 && (
            <tr>
              <td colSpan={3} style={{ color: 'var(--muted)' }}>
                No services configured.
              </td>
            </tr>
          )}
          {view.services.map((s) => {
            const current = s.fixedFee ?? ''
            const val = serviceDraft[s.serviceKey] ?? current
            const dirty = val.trim() !== current && val.trim() !== ''
            return (
              <tr key={s.serviceKey}>
                <td>
                  <strong>{s.displayName}</strong>
                  <div style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '0.15rem' }}>
                    {Object.keys(s.documentFees).length > 0
                      ? `Document fees: ${Object.entries(s.documentFees)
                          .map(([k, v]) => `${k.replace(/_/g, ' ')} ${money(v)}`)
                          .join(', ')} · `
                      : ''}
                    <Link
                      href={`/attorney/services/${s.serviceKey}/billing`}
                      style={{ color: 'var(--accent, #1a3a6b)' }}
                    >
                      {Object.keys(s.documentFees).length > 0
                        ? 'edit document fees'
                        : 'set document fees →'}
                    </Link>
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="—"
                    value={val}
                    onChange={(e) =>
                      setServiceDraft((st) => ({ ...st, [s.serviceKey]: e.target.value }))
                    }
                    style={{ width: '8rem', textAlign: 'right' }}
                  />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    disabled={busy === `s:${s.serviceKey}` || !dirty}
                    onClick={() =>
                      run(
                        `s:${s.serviceKey}`,
                        () =>
                          callAttorneyMcp({
                            toolName: 'legal.rates.set_service',
                            input: { serviceKey: s.serviceKey, fixedFee: val.trim() },
                          }),
                        `Saved fee for ${s.displayName}.`,
                      )
                    }
                  >
                    {busy === `s:${s.serviceKey}` ? '…' : 'Save'}
                  </button>
                </td>
              </tr>
            )
          })}
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
