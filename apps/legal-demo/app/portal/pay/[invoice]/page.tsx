'use client'

// Public "Pay now" landing for an invoice (the link in the invoice email points
// here: /portal/pay/<invoiceNumber>). Online card payments are not built yet, so
// this is an honest "coming soon" page that names the invoice and tells the client
// how to pay in the meantime. No auth and no invoice data fetch — it only shows the
// invoice number from the URL, so nothing sensitive is exposed on a public link.
import { use } from 'react'

export default function InvoicePayComingSoonPage({
  params,
}: {
  params: Promise<{ invoice: string }>
}) {
  const { invoice } = use(params)
  const invoiceNumber = decodeURIComponent(invoice)

  return (
    <main className="public-draft">
      <div className="public-draft-head">
        <div>
          <div className="public-draft-firm">Pacheco Law</div>
          <h1 style={{ margin: 'var(--space-1) 0 0' }}>Pay invoice {invoiceNumber}</h1>
        </div>
      </div>

      <section style={{ marginTop: 'var(--space-4)' }}>
        <div className="alert">
          <strong>Online payments are coming soon.</strong> We&apos;re finishing secure card and
          bank payments for {invoiceNumber}. In the meantime, you can pay by check or bank transfer
          — just reply to the invoice email and we&apos;ll send payment details right away.
        </div>

        <p className="text-muted" style={{ marginTop: 'var(--space-4)' }}>
          The amount due is shown on the invoice email we sent you. Once online payments are live,
          this page will let you pay {invoiceNumber} by card in a few clicks.
        </p>

        <p style={{ marginTop: 'var(--space-4)' }}>
          <a href="/portal">Go to your client portal →</a>
        </p>
      </section>
    </main>
  )
}
