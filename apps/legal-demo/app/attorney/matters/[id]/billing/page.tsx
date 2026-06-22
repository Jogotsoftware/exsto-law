'use client'

// Matter › BILLING tab. Two ledgers for this matter:
//   • Unbilled — logged time, expenses, and accrued fees not yet on an invoice
//     (filtered from the firm-wide unbilled feed to this matter), plus the matter's
//     engagement fee from its service config, and the panel to log more.
//   • Invoiced — line items already billed, each with its invoice number + status.
// "Unbilled" = a ledger event (time.logged / expense.recorded / *_fee.recorded)
// with no matching billed event; generating an invoice happens on the Billing
// dashboard (which groups a client's matters together).
//
// v1 reads the tenant-wide legal.billing.unbilled and filters to this matter — fine
// at firm scale; a matter-scoped query is a perf follow-up.
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { TimeExpensePanel } from '@/components/TimeExpensePanel'
import { humanizeKind, type MatterDetail } from '../shared'

interface UnbilledEntry {
  sourceEventId: string
  kind: 'time' | 'expense' | 'service_fee' | 'document_fee'
  date: string | null
  description: string
  durationMinutes?: number | null
  quantity?: string | null
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
  matters: UnbilledMatter[]
}
interface UnbilledResult {
  clients: UnbilledClient[]
  currency: string
}
interface InvoicedItem {
  lineEntityId: string
  kind: string
  description: string
  quantity: string
  rate: string
  amount: string
  invoiceEntityId: string
  invoiceNumber: string
  invoiceStatus: string
  issuedDate: string | null
}
interface ServiceCost {
  type: 'hourly' | 'fixed'
  amount: string
  hours: number | null
}

function money(amount: string | null, currency: string): string {
  if (amount === null) return '—'
  const n = Number(amount)
  if (!Number.isFinite(n)) return amount
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n)
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}
function invoiceStatusClass(status: string): string {
  if (status === 'sent' || status === 'paid') return 'badge ok'
  if (status === 'issued') return 'badge info'
  return 'badge'
}

export default function MatterBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [matter, setMatter] = useState<MatterDetail | null>(null)
  const [unbilled, setUnbilled] = useState<UnbilledMatter | null>(null)
  const [invoiced, setInvoiced] = useState<InvoicedItem[]>([])
  const [currency, setCurrency] = useState('USD')
  const [fee, setFee] = useState<ServiceCost | null>(null)
  const [error, setError] = useState<string | null>(null)
  // "Log time"/"Log expense" buttons at the top of the matter deep-link here with
  // ?add=time|expense to open the corresponding form straight away.
  const [initialForm, setInitialForm] = useState<'time' | 'expense' | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const add = new URLSearchParams(window.location.search).get('add')
    if (add === 'time' || add === 'expense') setInitialForm(add)
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      const mRes = await callAttorneyMcp<{ matter: MatterDetail | null }>({
        toolName: 'legal.matter.get',
        input: { matterEntityId: id },
      })
      setMatter(mRes.matter)

      const [u, inv] = await Promise.all([
        callAttorneyMcp<UnbilledResult>({ toolName: 'legal.billing.unbilled' }),
        callAttorneyMcp<{ items: InvoicedItem[]; currency: string }>({
          toolName: 'legal.billing.matter_invoiced',
          input: { matterEntityId: id },
        }),
      ])
      setCurrency(u.currency || inv.currency || 'USD')
      let found: UnbilledMatter | null = null
      for (const c of u.clients ?? [])
        for (const m of c.matters ?? []) if (m.matterEntityId === id) found = m
      setUnbilled(found)
      setInvoiced(inv.items ?? [])

      // Best-effort: the matter's engagement fee from its service config. The
      // matter's practice area maps to a service key; if it doesn't resolve, we
      // just omit the fee line rather than erroring.
      if (mRes.matter?.practiceArea) {
        try {
          const sRes = await callAttorneyMcp<{ service: { cost: ServiceCost | null } | null }>({
            toolName: 'legal.service.get',
            input: { serviceKey: mRes.matter.practiceArea },
          })
          setFee(sRes.service?.cost ?? null)
        } catch {
          setFee(null)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const entries = unbilled?.entries ?? []
  const invoicedTotal = invoiced.reduce((s, i) => s + (Number(i.amount) || 0), 0).toFixed(2)

  return (
    <>
      <section>
        <h2>Unbilled</h2>
        <p className="text-muted text-sm">
          {matter?.clientName ? (
            <>
              Client: <strong>{matter.clientName}</strong>.{' '}
            </>
          ) : null}
          Logged time, expenses, and fees on this matter not yet on an invoice.{' '}
          <Link href="/attorney/billing" className="back-link">
            Generate an invoice on the Billing dashboard →
          </Link>
        </p>
        {error && <div className="alert alert-error">{error}</div>}

        {fee && (
          <p className="text-sm" style={{ marginTop: 'var(--space-2)' }}>
            <strong>Engagement fee:</strong>{' '}
            {fee.type === 'fixed'
              ? `${money(fee.amount, currency)} fixed`
              : `${money(fee.amount, currency)}/hr${fee.hours ? ` · ~${fee.hours}h` : ''}`}{' '}
            <span className="text-muted">(from the service)</span>
          </p>
        )}

        {entries.length === 0 ? (
          <p className="text-muted" style={{ marginTop: 'var(--space-3)' }}>
            Nothing unbilled on this matter. Log time or an expense below.
          </p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 'var(--space-3)' }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.sourceEventId}>
                    <td>{fmtDate(e.date)}</td>
                    <td>
                      <span className={`badge ${e.kind === 'time' ? 'info' : ''}`}>
                        {humanizeKind(e.kind)}
                      </span>
                    </td>
                    <td>{e.description || '—'}</td>
                    <td>
                      {e.kind === 'time'
                        ? e.durationMinutes != null
                          ? `${(e.durationMinutes / 60).toFixed(2)}h`
                          : (e.quantity ?? '—')
                        : '1'}
                    </td>
                    <td>{money(e.rate, currency)}</td>
                    <td>{money(e.amount, currency)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={5} style={{ textAlign: 'right', fontWeight: 600 }}>
                    Total unbilled
                  </td>
                  <td style={{ fontWeight: 600 }}>{money(unbilled?.total ?? '0.00', currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Invoiced</h2>
        <p className="text-muted text-sm">
          Line items already billed on this matter, with the status of each invoice.
        </p>
        {invoiced.length === 0 ? (
          <p className="text-muted" style={{ marginTop: 'var(--space-3)' }}>
            Nothing invoiced on this matter yet.
          </p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 'var(--space-3)' }}>
            <table>
              <thead>
                <tr>
                  <th>Issued</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Invoice</th>
                </tr>
              </thead>
              <tbody>
                {invoiced.map((i) => (
                  <tr key={i.lineEntityId}>
                    <td>{fmtDate(i.issuedDate)}</td>
                    <td>
                      <span className={`badge ${i.kind === 'time' ? 'info' : ''}`}>
                        {humanizeKind(i.kind)}
                      </span>
                    </td>
                    <td>{i.description || '—'}</td>
                    <td>{money(i.amount, currency)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {i.invoiceNumber}{' '}
                      <span className={invoiceStatusClass(i.invoiceStatus)}>{i.invoiceStatus}</span>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600 }}>
                    Total invoiced
                  </td>
                  <td style={{ fontWeight: 600 }}>{money(invoicedTotal, currency)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Log time &amp; expenses</h2>
        <p className="text-muted text-sm">
          Each entry is recorded on the matter timeline and appears above until invoiced.
        </p>
        <TimeExpensePanel matterEntityId={id} initialForm={initialForm} onChange={load} />
      </section>
    </>
  )
}
