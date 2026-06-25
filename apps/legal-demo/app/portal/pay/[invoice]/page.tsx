'use client'

// Invoice detail + pay landing (the link in the invoice email points here:
// /portal/pay/<invoiceNumber>). It now fetches REAL invoice data behind the signed
// client session — the authed portal tool authorizes the invoice against the
// client's own matters, so a number in the URL is no longer a public oracle. Online
// payment is a seam (lib/payments/provider.ts); until a provider is wired, the page
// shows the amount due and how to pay offline.
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { callClientPortalMcp, PortalSessionExpiredError } from '@/lib/mcpClientPortal'
import { getPaymentProvider } from '@/lib/payments/provider'
import { BackButton } from '@/components/BackButton'
import { PayForm } from './PayForm'

// The payment-intent shape returned by legal.client.invoice_payment_intent.
type IntentReady = {
  status: 'ready'
  clientSecret: string
  publishableKey: string
  connectedAccountId: string
  amountCents: number
  currency: string
  invoiceNumber: string
}
type IntentResult = IntentReady | { status: 'unavailable'; reason: string }

interface ClientInvoiceLine {
  description: string
  amount: string
}
interface ClientInvoiceDetail {
  invoiceEntityId: string
  invoiceNumber: string
  status: 'due' | 'paid'
  total: string
  currency: string
  issuedDate: string | null
  dueDate: string | null
  lines: ClientInvoiceLine[]
}

function money(amount: string, currency: string): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return `${amount} ${currency}`
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n)
  } catch {
    return `${amount} ${currency}`
  }
}

interface InvoicePdf {
  filename: string
  contentType: string
  base64: string
}

// base64 → a Blob object URL the browser can view/download (no server round-trip
// for the bytes beyond the one MCP call). Caller must URL.revokeObjectURL it.
function base64ToBlobUrl(base64: string, contentType: string): string {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: contentType }))
}

export default function InvoicePayPage({ params }: { params: Promise<{ invoice: string }> }) {
  const { invoice } = use(params)
  const invoiceNumber = decodeURIComponent(invoice)
  const [data, setData] = useState<ClientInvoiceDetail | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [pdf, setPdf] = useState<{ url: string; filename: string } | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const provider = useMemo(() => getPaymentProvider(), [])
  // Online-payment flow: idle → loading (creating a PaymentIntent) → ready (the
  // embedded Element is shown) | unavailable (firm not connected / already paid).
  const [payState, setPayState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const [intent, setIntent] = useState<IntentReady | null>(null)
  const [payReason, setPayReason] = useState<string | null>(null)

  // Revoke the blob URL when it changes or the page unmounts (no leaked object URLs).
  useEffect(() => {
    return () => {
      if (pdf?.url) URL.revokeObjectURL(pdf.url)
    }
  }, [pdf])

  async function viewPdf() {
    if (pdfBusy) return
    setPdfBusy(true)
    setPdfError(null)
    try {
      const r = await callClientPortalMcp<{ pdf: InvoicePdf | null }>({
        toolName: 'legal.client.invoice_pdf',
        input: { invoiceNumber },
      })
      if (r.pdf) {
        setPdf({ url: base64ToBlobUrl(r.pdf.base64, r.pdf.contentType), filename: r.pdf.filename })
      } else {
        setPdfError('This invoice isn’t available to download yet.')
      }
    } catch (e) {
      if (!(e instanceof PortalSessionExpiredError)) {
        setPdfError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setPdfBusy(false)
    }
  }

  const loadInvoice = useCallback(() => {
    callClientPortalMcp<{ invoice: ClientInvoiceDetail | null }>({
      toolName: 'legal.client.invoice_get',
      input: { invoiceNumber },
    })
      .then((r) => {
        if (!r.invoice) {
          setState('notfound')
          return
        }
        setData(r.invoice)
        setState('ready')
      })
      .catch((e) => {
        if (e instanceof PortalSessionExpiredError) return // wrapper bounces to login
        setError(e instanceof Error ? e.message : String(e))
        setState('error')
      })
  }, [invoiceNumber])

  useEffect(() => {
    loadInvoice()
  }, [loadInvoice])

  // Create a PaymentIntent for this invoice and reveal the embedded Element. The
  // firm-not-connected / already-paid cases come back as a clean 'unavailable'.
  async function startPayment(): Promise<void> {
    setPayState('loading')
    setPayReason(null)
    try {
      const r = await callClientPortalMcp<IntentResult>({
        toolName: 'legal.client.invoice_payment_intent',
        input: { invoiceNumber },
      })
      if (r.status === 'ready') {
        setIntent(r)
        setPayState('ready')
      } else {
        setPayReason(r.reason)
        setPayState('unavailable')
      }
    } catch (e) {
      if (e instanceof PortalSessionExpiredError) return
      setPayReason(e instanceof Error ? e.message : String(e))
      setPayState('unavailable')
    }
  }

  return (
    <main className="public-draft">
      <BackButton fallback="/portal" forceFallback />
      <div className="public-draft-head">
        <div>
          <div className="public-draft-firm">Pacheco Law</div>
          <h1 style={{ margin: 'var(--space-1) 0 0' }}>Invoice {invoiceNumber}</h1>
        </div>
      </div>

      <section style={{ marginTop: 'var(--space-4)' }}>
        {state === 'loading' && (
          <div className="loading-block" role="status">
            <span className="spinner" /> Loading invoice…
          </div>
        )}

        {state === 'notfound' && (
          <div className="alert">
            We couldn&apos;t find this invoice on your account. If you think this is a mistake,
            reply to the invoice email or contact the firm.
          </div>
        )}

        {state === 'error' && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        {state === 'ready' && data && (
          <>
            <div className="pdash-card">
              <div className="pdash-card-head">
                <h2>{money(data.total, data.currency)}</h2>
                <span
                  className={`pdash-badge ${data.status === 'paid' ? 'pdash-badge-ok' : 'pdash-badge-warn'}`}
                >
                  {data.status === 'paid' ? 'Paid' : 'Amount due'}
                </span>
              </div>
              <div className="text-sm text-muted">
                {data.issuedDate && <>Issued {new Date(data.issuedDate).toLocaleDateString()} · </>}
                {data.dueDate && data.status !== 'paid' && (
                  <>Due {new Date(data.dueDate).toLocaleDateString()}</>
                )}
              </div>

              {data.lines.length > 0 && (
                <ul className="pdash-docs" style={{ marginTop: 'var(--space-3)' }}>
                  {data.lines.map((l, i) => (
                    <li key={i} className="pdash-doc">
                      <div className="pdash-doc-title">{l.description || 'Service'}</div>
                      <div>{money(l.amount, data.currency)}</div>
                    </li>
                  ))}
                </ul>
              )}

              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                {!pdf ? (
                  <button
                    type="button"
                    className="pdash-btn pdash-btn-sm"
                    disabled={pdfBusy}
                    onClick={viewPdf}
                  >
                    {pdfBusy ? 'Preparing PDF…' : 'View / download PDF'}
                  </button>
                ) : (
                  <a className="pdash-btn pdash-btn-sm" href={pdf.url} download={pdf.filename}>
                    Download PDF
                  </a>
                )}
              </div>
              {pdfError && (
                <div
                  className="text-sm text-muted"
                  role="alert"
                  style={{ marginTop: 'var(--space-2)' }}
                >
                  {pdfError}
                </div>
              )}
            </div>

            {pdf && (
              <iframe
                title="Invoice PDF"
                src={pdf.url}
                style={{
                  width: '100%',
                  height: '70vh',
                  marginTop: 'var(--space-3)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                }}
              />
            )}

            {data.status === 'paid' ? (
              <p className="text-muted" style={{ marginTop: 'var(--space-4)' }}>
                This invoice has been paid. Thank you!
              </p>
            ) : provider.enabled ? (
              <div style={{ marginTop: 'var(--space-4)' }}>
                {payState === 'idle' && (
                  <button type="button" className="pdash-btn" onClick={startPayment}>
                    Pay {money(data.total, data.currency)} online
                  </button>
                )}
                {payState === 'loading' && (
                  <div className="loading-block" role="status">
                    <span className="spinner" /> Preparing secure payment…
                  </div>
                )}
                {payState === 'ready' && intent && (
                  <PayForm
                    clientSecret={intent.clientSecret}
                    publishableKey={intent.publishableKey}
                    connectedAccountId={intent.connectedAccountId}
                    amountLabel={money(data.total, data.currency)}
                    returnUrl={typeof window !== 'undefined' ? window.location.href : ''}
                    onPaid={loadInvoice}
                  />
                )}
                {payState === 'unavailable' && (
                  <div className="alert">
                    {payReason ?? 'Online payment isn’t available for this invoice right now.'} To
                    pay, reply to the invoice email or contact the firm for check or bank-transfer
                    details.
                  </div>
                )}
              </div>
            ) : (
              <div className="alert" style={{ marginTop: 'var(--space-4)' }}>
                <strong>To pay this invoice,</strong> reply to the invoice email or contact the firm
                for check or bank-transfer details. Online card payment is coming soon.
              </div>
            )}
          </>
        )}
      </section>
    </main>
  )
}
