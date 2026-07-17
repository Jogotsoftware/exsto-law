'use client'

// Billing (Session 4; WP-F restyled to legal-instruments.dc.html's BILLING
// section — chrome only, no behavior changes). Three tabs over the billing
// read/write MCP tools:
//   Unbilled — unbilled time + expense ledger entries grouped by client → matter,
//              select entries and generate an invoice.
//   Invoices — issued invoices with lines; send (activation-gated in v1).
//   Rates    — READ-ONLY mirror of the client billable rates the Clients/Services
//              screens (S2) persist; the editor is NOT reimplemented here.
import { Fragment, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { formatDate } from '@/lib/datetime'
import { CheckIcon } from '@/components/icons'

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
}): React.ReactElement {
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
// A client-reported Zelle/crypto payment (legal.billing.payment_reports).
interface PaymentReport {
  eventId: string
  invoiceEntityId: string
  invoiceNumber: string
  invoiceStatus: string
  method: 'zelle' | 'crypto'
  reference: string
  payerName: string | null
  note: string | null
  wallet: { label: string; currency: string } | null
  screenshotKey: string | null
  reportedAt: string
  status: 'open' | 'resolved' | 'dismissed'
  dismissedReason: string | null
}

// Block-explorer link for a crypto report, so verification is one click. Only
// offered when the reference actually looks like a transaction hash.
function explorerUrl(report: PaymentReport): string | null {
  if (report.method !== 'crypto') return null
  const ref = report.reference.trim()
  const cur = (report.wallet?.currency ?? '').toUpperCase()
  if (/^[0-9a-f]{64}$/i.test(ref) && cur === 'BTC') return `https://mempool.space/tx/${ref}`
  if (/^(0x)?[0-9a-f]{64}$/i.test(ref) && ['ETH', 'USDC', 'USDT'].includes(cur)) {
    return `https://etherscan.io/tx/${ref.startsWith('0x') ? ref : `0x${ref}`}`
  }
  return null
}

function money(amount: string | null, currency = 'USD'): string {
  if (amount === null) return '—'
  return `${currency === 'USD' ? '$' : currency + ' '}${amount}`
}
function fmtDate(iso: string | null): string {
  return formatDate(iso)
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
// Comp kind-chip colors: Time blue, Expense gray, Service/Document fee green.
function kindChipClass(kind: string): string {
  if (kind === 'time') return 'li-bill-chip li-bill-chip--sm li-bill-chip--blue'
  if (kind === 'service_fee' || kind === 'document_fee')
    return 'li-bill-chip li-bill-chip--sm li-bill-chip--green'
  return 'li-bill-chip li-bill-chip--sm li-bill-chip--gray'
}
// Comp status-chip colors: paid/sent green, everything else blue.
function statusChipClass(status: string): string {
  return status === 'paid' || status === 'sent'
    ? 'li-bill-chip li-bill-chip--sm li-bill-chip--green'
    : 'li-bill-chip li-bill-chip--sm li-bill-chip--blue'
}
// A base64 PDF → object URL we can show in an <iframe> and offer as a download.
function base64ToBlobUrl(base64: string, type = 'application/pdf'): string {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type }))
}

// ── Unbilled tab ───────────────────────────────────────────────────────────────
function UnbilledTab({ onIssued }: { onIssued: () => void }): React.ReactElement {
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
      <div className="loading-block" role="status">
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
        <div className="empty-block">Nothing unbilled — every time/expense entry is invoiced.</div>
      )}

      {billable.map((c) => {
        const ids = clientEntryIds(c)
        const allSelected = ids.length > 0 && ids.every((id) => selected[id])
        const someSelected = ids.some((id) => selected[id])
        return (
          <section key={c.clientEntityId} className="li-bill-client-section">
            <div className="li-bill-client-head">
              <h3 className="li-bill-client-name">{c.clientName}</h3>
              <span className="li-bill-chip li-bill-chip--blue">
                {c.billableRate ? `${money(c.billableRate, currency)}/hr` : 'no rate set'}
                {c.billingType ? ` · ${c.billingType}` : ''}
              </span>
              <strong className="li-bill-unbilled-total">
                Unbilled {money(c.total, currency)}
              </strong>
              {/* A LABELED select-all, not a bare floating checkbox (beta: read as a
                  "stray empty text box" at the top of the page). */}
              <label className="li-bill-selectall">
                <SelectAllCheckbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={(v) => setClientSelection(c, v)}
                  title={`Select all unbilled entries for ${c.clientName}`}
                />
                Select all
              </label>
              <button
                className="li-bill-btn-primary"
                disabled={!someSelected || busy === c.clientEntityId}
                onClick={() => generate(c)}
              >
                {busy === c.clientEntityId ? '…' : 'Generate invoice'}
              </button>
            </div>
            {c.matters.map((m) => {
              const mAllSelected =
                m.entries.length > 0 && m.entries.every((e) => selected[e.sourceEventId])
              const mSomeSelected = m.entries.some((e) => selected[e.sourceEventId])
              return (
                <div key={m.matterEntityId} className="li-bill-matter">
                  <div className="li-bill-matter-head">
                    {m.matterSummary ? (
                      <>
                        <span className="li-bill-matter-summary">{m.matterSummary}</span>
                        <span className="li-bill-matter-number">{m.matterNumber}</span>
                      </>
                    ) : (
                      <span className="li-bill-matter-number">{m.matterNumber}</span>
                    )}
                    <span className="li-bill-matter-total">· {money(m.total, currency)}</span>
                  </div>
                  <div className="li-bill-table">
                    <div className="li-bill-thead li-bill-thead--entries">
                      <span>
                        <SelectAllCheckbox
                          checked={mAllSelected}
                          indeterminate={mSomeSelected}
                          onChange={(v) => setMatterSelection(m, v)}
                          title="Select all entries in this matter"
                        />
                      </span>
                      <span>DATE</span>
                      <span>KIND</span>
                      <span>DESCRIPTION</span>
                      <span className="li-bill-td-right">QTY</span>
                      <span className="li-bill-td-right">RATE</span>
                      <span className="li-bill-td-right">AMOUNT</span>
                    </div>
                    {m.entries.map((e) => (
                      <div key={e.sourceEventId} className="li-bill-trow li-bill-trow--entries">
                        <label className="li-bill-td-check">
                          <input
                            type="checkbox"
                            checked={!!selected[e.sourceEventId]}
                            onChange={() => toggle(e.sourceEventId)}
                            aria-label="select entry"
                          />
                        </label>
                        <span className="li-bill-td-muted">{fmtDate(e.date)}</span>
                        <span className={kindChipClass(e.kind)}>{kindLabel(e.kind)}</span>
                        <span>{e.description}</span>
                        <span className="li-bill-td-right li-bill-td-muted">
                          {e.kind === 'time'
                            ? `${e.quantity}h`
                            : e.kind === 'service_fee' || e.kind === 'document_fee'
                              ? '—'
                              : e.quantity}
                        </span>
                        <span className="li-bill-td-right li-bill-td-muted">
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
                              className="li-bill-input li-bill-input--sm"
                              style={{ width: '5.5rem' }}
                            />
                          ) : (
                            '—'
                          )}
                        </span>
                        <span className="li-bill-td-right li-bill-amount">
                          {money(e.amount, currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </section>
        )
      })}

      {orphans.map((c) => (
        <section key="__none__" className="li-bill-client-section" style={{ opacity: 0.9 }}>
          <h3 className="li-bill-client-name">{c.clientName}</h3>
          <p className="li-bill-orphan-intro">
            These matters aren’t linked to a client yet, so they can’t be invoiced. Set up billing
            to create the client from the matter’s contact and make it invoiceable. Unbilled{' '}
            {money(c.total, currency)}.
          </p>
          <div className="li-bill-table">
            <div className="li-bill-thead li-bill-thead--orphan">
              <span>MATTER</span>
              <span>CONTACT</span>
              <span className="li-bill-td-right">UNBILLED</span>
              <span className="li-bill-td-right">ACTIONS</span>
            </div>
            {c.matters.map((m) => (
              <div key={m.matterEntityId} className="li-bill-trow li-bill-trow--orphan">
                <span>{m.matterNumber}</span>
                <span className="li-bill-td-muted">{m.contactName ?? '—'}</span>
                <span className="li-bill-td-right li-bill-amount">{money(m.total, currency)}</span>
                <span className="li-bill-td-right">
                  {m.contactEntityId ? (
                    <button
                      className="li-bill-btn-primary li-bill-btn-primary--sm"
                      disabled={setupBusy === m.matterEntityId}
                      onClick={() => setupBilling(m)}
                    >
                      {setupBusy === m.matterEntityId ? '…' : 'Set up billing'}
                    </button>
                  ) : (
                    <span className="li-bill-td-muted">no contact</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

// ── Invoices tab ─────────────────────────────────────────────────────────────
function InvoicesTab({ reloadKey }: { reloadKey: number }): React.ReactElement {
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [pdf, setPdf] = useState<{ url: string; filename: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [paying, setPaying] = useState<string | null>(null)
  // Client-reported Zelle/crypto payments (migration 0115) awaiting verification.
  const [reports, setReports] = useState<PaymentReport[]>([])

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const r = await callAttorneyMcp<{ invoices: InvoiceSummary[] }>({
        toolName: 'legal.invoice.list',
      })
      setInvoices(r.invoices)
      // Client-reported Zelle/crypto payments ride along; a failure here must not
      // take down the invoices table (reports are additive verification work).
      try {
        const rep = await callAttorneyMcp<{ reports: PaymentReport[] }>({
          toolName: 'legal.billing.payment_reports',
        })
        setReports(rep.reports)
      } catch {
        setReports([])
      }
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

  // Confirm a client-reported Zelle/crypto payment: the SAME invoice.pay action as
  // "Mark paid", but carrying the report's method + verification reference so the
  // payment record says exactly how it was verified.
  async function confirmReport(report: PaymentReport) {
    setPaying(report.invoiceEntityId)
    setError(null)
    setNotice(null)
    try {
      await callAttorneyMcp<{ paid: boolean }>({
        toolName: 'legal.invoice.pay',
        input: {
          invoiceEntityId: report.invoiceEntityId,
          method: report.method,
          reference: report.reference,
        },
      })
      setNotice(`${report.invoiceNumber} marked paid (${report.method}).`)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPaying(null)
    }
  }

  async function dismissReport(report: PaymentReport) {
    const reason = prompt('Dismiss this payment report? Optional reason for the record:')
    if (reason === null) return
    setBusy(report.eventId)
    setError(null)
    try {
      await callAttorneyMcp<{ eventId: string }>({
        toolName: 'legal.billing.dismiss_payment_report',
        input: { reportEventId: report.eventId, reason: reason || undefined },
      })
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
      <div className="loading-block" role="status">
        <span className="spinner" /> Loading…
      </div>
    )

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert">{notice}</div>}

      {/* Client-reported Zelle/crypto payments awaiting verification. Confirm =
          the same invoice.pay action as Mark paid, carrying the report's method +
          reference; Dismiss records an append-only correction. */}
      {reports.some((r) => r.status === 'open') && (
        <section className="li-bill-reports">
          <h3 className="li-bill-section-title li-bill-section-title--lg">
            Payments reported by clients
          </h3>
          <div className="li-bill-reports-grid">
            {reports
              .filter((r) => r.status === 'open')
              .map((r) => {
                const explorer = explorerUrl(r)
                return (
                  <div key={r.eventId} className="li-bill-report-card">
                    <div className="li-bill-report-head">
                      <strong className="li-bill-report-number">{r.invoiceNumber}</strong>
                      <span className="li-bill-chip li-bill-chip--sm li-bill-chip--blue">
                        {r.method === 'crypto'
                          ? `crypto${r.wallet?.currency ? ` · ${r.wallet.currency}` : ''}`
                          : 'Zelle'}
                      </span>
                      <span className="li-bill-report-meta">
                        {fmtDate(r.reportedAt)}
                        {r.payerName ? ` · from ${r.payerName}` : ''}
                      </span>
                    </div>
                    <div className="li-bill-report-conf">
                      {r.method === 'crypto' ? 'Transaction ID: ' : 'Confirmation #: '}
                      <code className="li-bill-code">{r.reference}</code>
                      {explorer && (
                        <>
                          {' · '}
                          <a
                            className="li-bill-link"
                            href={explorer}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            View on block explorer ↗
                          </a>
                        </>
                      )}
                      {r.screenshotKey && (
                        <>
                          {' · '}
                          <a
                            className="li-bill-link"
                            href={`/api/attorney/payments/report-screenshot?key=${encodeURIComponent(r.screenshotKey)}`}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            View screenshot ↗
                          </a>
                        </>
                      )}
                    </div>
                    {r.note && <div className="li-bill-report-note">“{r.note}”</div>}
                    <div className="li-bill-report-actions">
                      <button
                        type="button"
                        className="li-bill-btn-ok"
                        disabled={paying === r.invoiceEntityId}
                        onClick={() => confirmReport(r)}
                      >
                        <CheckIcon size={14} />
                        {paying === r.invoiceEntityId ? '…' : 'Verified — mark paid'}
                      </button>
                      <button
                        type="button"
                        className="li-bill-btn"
                        disabled={busy === r.eventId}
                        onClick={() => dismissReport(r)}
                      >
                        {busy === r.eventId ? '…' : 'Dismiss'}
                      </button>
                    </div>
                  </div>
                )
              })}
          </div>
        </section>
      )}

      {invoices.length === 0 ? (
        <section>
          <p className="text-muted">No invoices yet. Generate one from the Unbilled tab.</p>
        </section>
      ) : (
        <div className="li-bill-table li-bill-table--lg">
          <div className="li-bill-thead li-bill-thead--inv">
            <span>INVOICE</span>
            <span>CLIENT</span>
            <span>STATUS</span>
            <span>ISSUED</span>
            <span className="li-bill-td-right">LINES</span>
            <span className="li-bill-td-right">TOTAL</span>
            <span className="li-bill-td-right">ACTIONS</span>
          </div>
          {invoices.map((inv) => {
            const reported = reports.some(
              (r) => r.status === 'open' && r.invoiceEntityId === inv.invoiceEntityId,
            )
            return (
              <Fragment key={inv.invoiceEntityId}>
                <div className="li-bill-trow li-bill-trow--inv">
                  <button
                    className="li-bill-inv-number"
                    onClick={() => open(inv.invoiceEntityId, inv.invoiceNumber)}
                  >
                    {inv.invoiceNumber}
                  </button>
                  <span>{inv.clientName}</span>
                  <span>
                    <span className={statusChipClass(inv.status)}>
                      {inv.status === 'paid' ? '✓ paid' : inv.status}
                    </span>
                    {reported && (
                      <span
                        className="li-bill-chip li-bill-chip--sm li-bill-chip--gray"
                        style={{ marginLeft: 6 }}
                      >
                        payment reported
                      </span>
                    )}
                  </span>
                  <span className="li-bill-td-muted">{fmtDate(inv.issuedDate)}</span>
                  <span className="li-bill-td-right li-bill-td-muted">{inv.lineCount}</span>
                  <span className="li-bill-td-right li-bill-amount">
                    {money(inv.total, inv.currency)}
                  </span>
                  <span className="li-bill-inv-actions">
                    <button
                      className="li-bill-link"
                      onClick={() => open(inv.invoiceEntityId, inv.invoiceNumber)}
                    >
                      {openId === inv.invoiceEntityId ? 'Hide' : 'View'}
                    </button>
                    {inv.status === 'paid' ? (
                      <span className="li-bill-paid-label">Paid</span>
                    ) : (
                      <>
                        <button
                          className="li-bill-link-muted"
                          disabled={paying === inv.invoiceEntityId}
                          onClick={() => markPaid(inv)}
                        >
                          {paying === inv.invoiceEntityId ? '…' : 'Mark paid'}
                        </button>
                        <button
                          className="li-bill-btn-primary li-bill-btn-primary--sm"
                          disabled={busy === inv.invoiceEntityId}
                          onClick={() => send(inv)}
                        >
                          {busy === inv.invoiceEntityId ? '…' : 'Send'}
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {openId === inv.invoiceEntityId && (
                  <div className="li-bill-detail">
                    {pdf === null ? (
                      <div className="loading-block" role="status">
                        <span className="spinner" /> Rendering invoice…
                      </div>
                    ) : (
                      <div>
                        <div style={{ marginBottom: 'var(--space-2)' }}>
                          <a className="li-bill-link" href={pdf.url} download={pdf.filename}>
                            Download PDF
                          </a>
                        </div>
                        <iframe
                          title={`Invoice ${inv.invoiceNumber}`}
                          src={pdf.url}
                          className="li-bill-iframe"
                        />
                      </div>
                    )}
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>
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

function RatesTab(): React.ReactElement {
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
      <div className="loading-block" role="status">
        <span className="spinner" /> Loading…
      </div>
    )

  const firmDirty = firmDraft.trim() !== '' && firmDraft.trim() !== (view.firmDefaultRate ?? '')

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert">{notice}</div>}

      <div className="li-bill-rate-row">
        <label className="li-bill-field">
          Firm default hourly rate (USD)
          <input
            type="number"
            inputMode="decimal"
            value={firmDraft}
            onChange={(e) => setFirmDraft(e.target.value)}
            className="li-bill-input"
          />
        </label>
        <button
          className="li-bill-btn-primary li-bill-btn-primary--tall"
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
      <p className="li-bill-hint">
        The fallback hourly rate billed when a client has no explicit rate. Per-client rates and
        per-service fixed fees below are the single source of truth and apply everywhere.
      </p>

      <h3 className="li-bill-section-title">Client hourly rates</h3>
      <div className="li-bill-table li-bill-table--lg">
        <div className="li-bill-thead li-bill-thead--rate">
          <span>CLIENT</span>
          <span className="li-bill-td-right">RATE (USD/HR)</span>
          <span className="li-bill-td-right">ACTIONS</span>
        </div>
        {view.clients.length === 0 && <div className="li-bill-trow-empty">No clients yet.</div>}
        {view.clients.map((c) => {
          const current = c.ownRate ?? ''
          const val = clientDraft[c.clientEntityId] ?? current
          const dirty = val.trim() !== current && val.trim() !== ''
          return (
            <div key={c.clientEntityId} className="li-bill-trow li-bill-trow--rate">
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              <span className="li-bill-td-right">
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
                  className="li-bill-input li-bill-input--sm"
                />
              </span>
              <span className="li-bill-td-right">
                <button
                  className="li-bill-btn li-bill-btn--sm"
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
              </span>
            </div>
          )
        })}
      </div>

      <h3 className="li-bill-section-title li-bill-section-title--tight">
        Service &amp; document fees
      </h3>
      <p className="li-bill-hint li-bill-hint--tight">
        A service’s fixed fee bills when the service is marked complete. Per-document fees (billed
        when a document is approved) are set on each service’s Billing tab and shown here.
      </p>
      <div className="li-bill-table li-bill-table--lg">
        <div className="li-bill-thead li-bill-thead--rate">
          <span>SERVICE</span>
          <span className="li-bill-td-right">FIXED FEE (USD)</span>
          <span className="li-bill-td-right">ACTIONS</span>
        </div>
        {view.services.length === 0 && (
          <div className="li-bill-trow-empty">No services configured.</div>
        )}
        {view.services.map((s) => {
          const current = s.fixedFee ?? ''
          const val = serviceDraft[s.serviceKey] ?? current
          const dirty = val.trim() !== current && val.trim() !== ''
          return (
            <div key={s.serviceKey} className="li-bill-trow li-bill-trow--rate">
              <span>
                <span style={{ fontWeight: 600 }}>{s.displayName}</span>
                <div className="li-bill-doc-fee-note">
                  {Object.keys(s.documentFees).length > 0
                    ? `Document fees: ${Object.entries(s.documentFees)
                        .map(([k, v]) => `${k.replace(/_/g, ' ')} ${money(v)}`)
                        .join(', ')} · `
                    : ''}
                  <Link href={`/attorney/services/${s.serviceKey}/billing`}>
                    {Object.keys(s.documentFees).length > 0
                      ? 'edit document fees'
                      : 'set document fees →'}
                  </Link>
                </div>
              </span>
              <span className="li-bill-td-right">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="—"
                  value={val}
                  onChange={(e) =>
                    setServiceDraft((st) => ({ ...st, [s.serviceKey]: e.target.value }))
                  }
                  className="li-bill-input li-bill-input--sm"
                />
              </span>
              <span className="li-bill-td-right">
                <button
                  className="li-bill-btn li-bill-btn--sm"
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
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type BillTabKey = 'unbilled' | 'invoices' | 'rates'
const BILL_TABS: Array<{ key: BillTabKey; label: string }> = [
  { key: 'unbilled', label: 'Unbilled' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'rates', label: 'Rates' },
]

export default function BillingPage(): React.ReactElement {
  // Bump to re-pull the Invoices tab after issuing from the Unbilled tab.
  const [reloadKey, setReloadKey] = useState(0)
  const [tab, setTab] = useState<BillTabKey>('unbilled')

  return (
    <main>
      <h1 className="li-bill-title">Billing</h1>
      <p className="li-bill-subtitle">
        Unbilled work, issued invoices, and the firm rates they draw from.
      </p>
      <div className="li-bill-tabs" role="tablist">
        {BILL_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`li-bill-tab ${tab === t.key ? 'is-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'unbilled' && <UnbilledTab onIssued={() => setReloadKey((k) => k + 1)} />}
        {tab === 'invoices' && <InvoicesTab reloadKey={reloadKey} />}
        {tab === 'rates' && <RatesTab />}
      </div>
    </main>
  )
}
