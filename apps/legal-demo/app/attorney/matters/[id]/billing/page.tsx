'use client'

// Matter › BILLING tab. Everything billable on this matter that has NOT yet been
// invoiced — logged time and expenses (filtered from the firm-wide unbilled feed
// to this matter), plus the matter's engagement fee from its service config — and
// the panel to log more. "Unbilled" means a time.logged / expense.recorded entry
// with no matching billed event; generating an invoice happens on the Billing
// dashboard (which groups a client's matters together).
//
// v1 reads the tenant-wide legal.billing.unbilled and filters to this matter — fine
// at firm scale; a matter-scoped query (legal.matter.unbilled) is a perf follow-up.
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { TimeExpensePanel } from '@/components/TimeExpensePanel'
import { humanizeKind, type MatterDetail } from '../shared'

interface UnbilledEntry {
  sourceEventId: string
  kind: 'time' | 'expense'
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

export default function MatterBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [unbilled, setUnbilled] = useState<UnbilledMatter | null>(null)
  const [currency, setCurrency] = useState('USD')
  const [fee, setFee] = useState<ServiceCost | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const mRes = await callAttorneyMcp<{ matter: MatterDetail | null }>({
        toolName: 'legal.matter.get',
        input: { matterEntityId: id },
      })

      const u = await callAttorneyMcp<UnbilledResult>({ toolName: 'legal.billing.unbilled' })
      setCurrency(u.currency || 'USD')
      let found: UnbilledMatter | null = null
      for (const c of u.clients ?? [])
        for (const m of c.matters ?? []) if (m.matterEntityId === id) found = m
      setUnbilled(found)

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

  return (
    <>
      <section>
        <h2>Un-invoiced</h2>
        <p className="text-muted text-sm">
          Logged time and expenses on this matter not yet on an invoice.{' '}
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
            <span className="text-muted">(from the service — billed separately)</span>
          </p>
        )}

        {unbilled === null ? (
          <p className="text-muted" style={{ marginTop: 'var(--space-3)' }}>
            Nothing un-invoiced on this matter. Log time or an expense below.
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
                    <td>{e.date ? new Date(e.date + 'T00:00:00').toLocaleDateString() : '—'}</td>
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
                    Total un-invoiced
                  </td>
                  <td style={{ fontWeight: 600 }}>{money(unbilled.total, currency)}</td>
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
        <TimeExpensePanel matterEntityId={id} />
      </section>
    </>
  )
}
