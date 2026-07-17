'use client'

// Matter › BILLING tab. Three ledgers for this matter (comp: Accrued / Invoiced /
// Paid sub-tabs):
//   • Accrued — logged time, expenses, and accrued fees not yet on an invoice
//     (filtered from the firm-wide unbilled feed to this matter), plus the matter's
//     engagement fee from its service config, and the panel to log more.
//   • Invoiced — line items already billed but not yet paid.
//   • Paid — invoiced line items whose invoice has been marked paid (status data
//     already exists on each line; this is a client-side filter, no new read).
// "Accrued" = a ledger event (time.logged / expense.recorded / *_fee.recorded)
// with no matching billed event. "Send invoice" (WP-B2) issues + sends one
// in place, scoped to this matter — legal.invoice.issue already accepts an
// optional matterEntityId (the same call the Overview workflow's BillStep
// makes for the same purpose), so no dashboard hop is needed.
//
// v1 reads the tenant-wide legal.billing.unbilled and filters to this matter — fine
// at firm scale; a matter-scoped query is a perf follow-up.
import { use, useCallback, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { SendIcon } from '@/components/icons'

// PORTAL-1 (WP3): the client's fee-consent trail (who consented, to what
// amount, for what, when) rendered beside the fees it authorized.
interface ConsentEntry {
  eventId: string
  decision: 'accepted' | 'declined' | 'quoted'
  subjectKind: string
  subjectKey: string
  amount: string | null
  rate: string | null
  durationMinutes: number | null
  basis: string
  description: string | null
  at: string
}
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

type BillTab = 'accrued' | 'invoiced' | 'paid'

export default function MatterBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [matter, setMatter] = useState<MatterDetail | null>(null)
  const [unbilled, setUnbilled] = useState<UnbilledMatter | null>(null)
  const [invoiced, setInvoiced] = useState<InvoicedItem[]>([])
  const [consents, setConsents] = useState<ConsentEntry[]>([])
  const [currency, setCurrency] = useState('USD')
  const [fee, setFee] = useState<ServiceCost | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [tab, setTab] = useState<BillTab>('accrued')
  // "Add time"/"Add expense"/"Add fee" buttons at the top of the matter deep-link
  // here with ?add=time|expense|fee to open the corresponding form on arrival.
  const [initialForm, setInitialForm] = useState<'time' | 'expense' | null>(null)
  // Manual "Add fee" form + service-completion / void actions.
  const [showFee, setShowFee] = useState(false)
  const [feeType, setFeeType] = useState<'service' | 'document'>('service')
  const [feeAmount, setFeeAmount] = useState('')
  const [feeDesc, setFeeDesc] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const add = params.get('add')
    if (add === 'time' || add === 'expense') setInitialForm(add)
    if (add === 'fee') setShowFee(true)
  }, [])

  async function run(key: string, call: () => Promise<unknown>, ok: string) {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      await call()
      setNotice(ok)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function addFee() {
    if (!feeAmount.trim()) {
      setError('Enter a fee amount.')
      return
    }
    await run(
      'add-fee',
      () =>
        callAttorneyMcp({
          toolName: 'legal.matter.add_fee',
          input: {
            matterEntityId: id,
            feeType,
            amount: feeAmount.trim(),
            description: feeDesc.trim() || null,
          },
        }),
      `Added ${feeType === 'document' ? 'document' : 'service'} fee.`,
    )
    setShowFee(false)
    setFeeAmount('')
    setFeeDesc('')
  }

  function markComplete() {
    void run(
      'complete',
      () => callAttorneyMcp({ toolName: 'legal.service.complete', input: { matterEntityId: id } }),
      'Marked the service complete; its fee (if any) is now unbilled.',
    )
  }

  function voidFee(sourceEventId: string) {
    void run(
      `void:${sourceEventId}`,
      () => callAttorneyMcp({ toolName: 'legal.matter.void_fee', input: { sourceEventId } }),
      'Fee voided.',
    )
  }

  // WP-B2: in-tab "Send invoice" — issues + sends an invoice from THIS
  // matter's accrued entries, in place. legal.invoice.issue already accepts an
  // optional matterEntityId to scope the invoice to one matter (the same call
  // the Overview workflow's BillStep makes), so no new operation is needed —
  // just this tab's own selection (all of `entries`, matching the comp's
  // single "Send invoice" action with no per-line picking).
  async function sendInvoiceNow() {
    if (!matter?.clientEntityId) {
      setError('This matter has no linked client, so an invoice can’t be addressed.')
      return
    }
    if (entries.length === 0) return
    setBusy('send-invoice')
    setError(null)
    setNotice(null)
    try {
      const issued = await callAttorneyMcp<{ invoiceEntityId: string; invoiceNumber: string }>({
        toolName: 'legal.invoice.issue',
        input: {
          clientEntityId: matter.clientEntityId,
          matterEntityId: id,
          currency,
          lines: entries.map((e) => ({ sourceEventId: e.sourceEventId, kind: e.kind })),
        },
      })
      const sent = await callAttorneyMcp<{ to?: string }>({
        toolName: 'legal.invoice.send',
        input: {
          invoiceEntityId: issued.invoiceEntityId,
          payUrlBase: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
      })
      setNotice(`Invoice ${issued.invoiceNumber} sent${sent.to ? ` to ${sent.to}` : ''}.`)
      setTab('invoiced')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const load = useCallback(async () => {
    setError(null)
    try {
      callAttorneyMcp<{ consents: ConsentEntry[] }>({
        toolName: 'legal.matter.fee_consents',
        input: { matterEntityId: id },
      })
        .then((r) => setConsents(r.consents))
        .catch(() => setConsents([]))
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
  const acceptedConsents = consents.filter((c) => c.decision !== 'quoted')
  const invoicedUnpaid = invoiced.filter((i) => i.invoiceStatus !== 'paid')
  const invoicedPaid = invoiced.filter((i) => i.invoiceStatus === 'paid')
  const unpaidTotal = invoicedUnpaid.reduce((s, i) => s + (Number(i.amount) || 0), 0).toFixed(2)
  const paidTotal = invoicedPaid.reduce((s, i) => s + (Number(i.amount) || 0), 0).toFixed(2)

  return (
    <div className="li-mat-ov-col">
      {acceptedConsents.length > 0 && (
        <section className="li-mat-card">
          <h2 className="li-mat-card-title">Client fee consents</h2>
          <p className="text-muted text-sm">
            Fees the client explicitly accepted (or declined) in the portal, on the ledger.
          </p>
          <div className="table-wrap" style={{ marginTop: 'var(--space-3)' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Decision</th>
                  <th>For</th>
                  <th>Terms</th>
                </tr>
              </thead>
              <tbody>
                {acceptedConsents.map((c) => (
                  <tr key={c.eventId}>
                    <td>{fmtDate(c.at)}</td>
                    <td>
                      <span className={`badge ${c.decision === 'accepted' ? 'ok' : ''}`}>
                        {c.decision}
                      </span>
                    </td>
                    <td>{c.description ?? c.subjectKey}</td>
                    <td>
                      {c.amount
                        ? `$${c.amount}`
                        : c.rate
                          ? `$${c.rate}/hr${c.durationMinutes ? ` × ${c.durationMinutes} min` : ''}`
                          : c.basis}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="li-mat-card li-mat-billcard">
        <div className="li-mat-billtabs">
          {(['accrued', 'invoiced', 'paid'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? 'li-mat-billtab is-active' : 'li-mat-billtab'}
              onClick={() => setTab(t)}
            >
              {t === 'accrued' ? 'Accrued' : t === 'invoiced' ? 'Invoiced' : 'Paid'}
            </button>
          ))}
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert">{notice}</div>}

        {tab === 'accrued' && (
          <div className="li-mat-billpanel">
            {matter?.clientName && (
              <p className="text-muted text-sm">
                Client: <strong>{matter.clientName}</strong>
              </p>
            )}
            {fee && (
              <p className="text-sm">
                <strong>Engagement fee:</strong>{' '}
                {fee.type === 'fixed'
                  ? `${money(fee.amount, currency)} fixed`
                  : `${money(fee.amount, currency)}/hr${fee.hours ? ` · ~${fee.hours}h` : ''}`}{' '}
                <span className="text-muted">(from the service)</span>
              </p>
            )}
            <div className="li-mat-billactions">
              <button
                type="button"
                className="li-mat-btn-ghost"
                onClick={() => setShowFee((v) => !v)}
                disabled={busy === 'add-fee'}
              >
                {showFee ? 'Cancel' : 'Add fee'}
              </button>
              <button
                type="button"
                className="li-mat-btn-ghost"
                onClick={markComplete}
                disabled={busy === 'complete'}
              >
                {busy === 'complete' ? 'Working…' : 'Mark service complete'}
              </button>
            </div>

            {showFee && (
              <div className="li-mat-feeform">
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <label className="li-mat-field">
                    <span>Fee type</span>
                    <select
                      value={feeType}
                      onChange={(e) => setFeeType(e.target.value as 'service' | 'document')}
                    >
                      <option value="service">Service fee</option>
                      <option value="document">Document fee</option>
                    </select>
                  </label>
                  <label className="li-mat-field">
                    <span>Amount (USD)</span>
                    <input
                      inputMode="decimal"
                      value={feeAmount}
                      onChange={(e) => setFeeAmount(e.target.value)}
                      placeholder="250.00"
                      style={{ width: 120 }}
                    />
                  </label>
                </div>
                <label className="li-mat-field">
                  <span>Description (optional)</span>
                  <input
                    value={feeDesc}
                    onChange={(e) => setFeeDesc(e.target.value)}
                    placeholder="e.g. Filing package"
                  />
                </label>
                <button
                  type="button"
                  className="li-mat-btn-primary"
                  onClick={() => void addFee()}
                  disabled={busy === 'add-fee'}
                >
                  {busy === 'add-fee' ? 'Saving…' : 'Save fee'}
                </button>
              </div>
            )}

            {entries.length === 0 ? (
              <div className="li-mat-billempty">
                <div className="li-mat-billempty-ico">
                  <SendIcon size={20} />
                </div>
                <div>Nothing accrued. Log time or an expense below.</div>
              </div>
            ) : (
              <>
                <div className="li-mat-billlines">
                  {entries.map((e) => {
                    const isFee = e.kind === 'service_fee' || e.kind === 'document_fee'
                    return (
                      <div key={e.sourceEventId} className="li-mat-billline">
                        <div className="li-mat-billline-main">
                          <div className="li-mat-billline-desc">
                            {e.description || humanizeKind(e.kind)}
                          </div>
                          <div className="li-mat-billline-meta">
                            {fmtDate(e.date)}
                            {e.kind === 'time' && e.durationMinutes != null
                              ? ` · ${(e.durationMinutes / 60).toFixed(2)}h`
                              : ''}
                          </div>
                        </div>
                        {isFee && (
                          <button
                            type="button"
                            className="li-mat-billvoid"
                            onClick={() => voidFee(e.sourceEventId)}
                            disabled={busy === `void:${e.sourceEventId}`}
                            title="Void this fee"
                          >
                            {busy === `void:${e.sourceEventId}` ? '…' : 'Void'}
                          </button>
                        )}
                        <span className="li-mat-billline-amount">{money(e.amount, currency)}</span>
                      </div>
                    )
                  })}
                </div>
                <div className="li-mat-billfooter">
                  <button
                    type="button"
                    className="li-mat-billsend"
                    onClick={() => void sendInvoiceNow()}
                    disabled={busy === 'send-invoice' || !matter?.clientEntityId}
                    title={
                      matter?.clientEntityId
                        ? 'Issue and send an invoice for everything accrued on this matter'
                        : 'This matter has no linked client'
                    }
                  >
                    <SendIcon size={15} />
                    {busy === 'send-invoice' ? 'Sending…' : 'Send invoice'}
                  </button>
                  <span className="li-mat-billtotal">
                    <span className="li-mat-billtotal-label">Total accrued</span>
                    <span className="li-mat-billtotal-amount">
                      {money(unbilled?.total ?? '0.00', currency)}
                    </span>
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'invoiced' && (
          <div className="li-mat-billpanel">
            {invoicedUnpaid.length === 0 ? (
              <div className="li-mat-billempty">
                <div className="li-mat-billempty-ico">
                  <SendIcon size={20} />
                </div>
                <div>Nothing invoiced (and unpaid) on this matter.</div>
              </div>
            ) : (
              <>
                <div className="li-mat-billlines">
                  {invoicedUnpaid.map((i) => (
                    <div key={i.lineEntityId} className="li-mat-billline">
                      <div className="li-mat-billline-main">
                        <div className="li-mat-billline-desc">
                          {i.description || humanizeKind(i.kind)}
                        </div>
                        <div className="li-mat-billline-meta">
                          {fmtDate(i.issuedDate)} · {i.invoiceNumber}
                        </div>
                      </div>
                      <span className="li-mat-chip li-mat-chip-info">{i.invoiceStatus}</span>
                      <span className="li-mat-billline-amount">{money(i.amount, currency)}</span>
                    </div>
                  ))}
                </div>
                <div className="li-mat-billfooter">
                  <span />
                  <span className="li-mat-billtotal">
                    <span className="li-mat-billtotal-label">Total invoiced</span>
                    <span className="li-mat-billtotal-amount">{money(unpaidTotal, currency)}</span>
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'paid' && (
          <div className="li-mat-billpanel">
            {invoicedPaid.length === 0 ? (
              <div className="li-mat-billempty">
                <div className="li-mat-billempty-ico">
                  <SendIcon size={20} />
                </div>
                <div>No payments recorded.</div>
              </div>
            ) : (
              <>
                <div className="li-mat-billlines">
                  {invoicedPaid.map((i) => (
                    <div key={i.lineEntityId} className="li-mat-billline">
                      <div className="li-mat-billline-main">
                        <div className="li-mat-billline-desc">
                          {i.description || humanizeKind(i.kind)}
                        </div>
                        <div className="li-mat-billline-meta">
                          {fmtDate(i.issuedDate)} · {i.invoiceNumber}
                        </div>
                      </div>
                      <span className="li-mat-chip li-mat-chip-ok">Paid</span>
                      <span className="li-mat-billline-amount">{money(i.amount, currency)}</span>
                    </div>
                  ))}
                </div>
                <div className="li-mat-billfooter">
                  <span />
                  <span className="li-mat-billtotal">
                    <span className="li-mat-billtotal-label">Total paid</span>
                    <span className="li-mat-billtotal-amount">{money(paidTotal, currency)}</span>
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="li-mat-card">
        <h2 className="li-mat-card-title">Log time &amp; expenses</h2>
        <p className="text-muted text-sm">
          Each entry is recorded on the matter timeline and appears under Accrued until invoiced.
        </p>
        <TimeExpensePanel matterEntityId={id} initialForm={initialForm} onChange={load} />
      </section>
    </div>
  )
}
