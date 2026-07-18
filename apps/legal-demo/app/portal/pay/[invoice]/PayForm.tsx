'use client'

// The embedded Stripe Payment Element for one invoice. The parent fetches a
// PaymentIntent (legal.client.invoice_payment_intent) and hands us its client
// secret + the firm's connected-account id; we mount Stripe Elements against the
// CONNECTED ACCOUNT (direct charge) so the Element offers card + bank/ACH and the
// firm is the merchant of record. confirmPayment with redirect:'if_required'
// keeps cards in-page; bank methods that need a redirect use return_url. The
// invoice's authoritative flip to "paid" is the Stripe webhook, not this form —
// so on success we show a confirmation and let the parent re-check status.
import { useState, type FormEvent } from 'react'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'

interface PayFormProps {
  clientSecret: string
  publishableKey: string
  connectedAccountId: string
  amountLabel: string
  returnUrl: string
  onPaid: () => void
}

// One Stripe.js instance per (publishable key + connected account). loadStripe is
// expensive and must not run on every render.
const stripeCache = new Map<string, Promise<Stripe | null>>()
function stripePromiseFor(pk: string, account: string): Promise<Stripe | null> {
  const key = `${pk}|${account}`
  let p = stripeCache.get(key)
  if (!p) {
    p = loadStripe(pk, { stripeAccount: account })
    stripeCache.set(key, p)
  }
  return p
}

export function PayForm(props: PayFormProps): React.ReactElement {
  return (
    <Elements
      stripe={stripePromiseFor(props.publishableKey, props.connectedAccountId)}
      options={{ clientSecret: props.clientSecret, appearance: { theme: 'stripe' } }}
    >
      <InnerForm {...props} />
    </Elements>
  )
}

function InnerForm({ amountLabel, returnUrl, onPaid }: PayFormProps): React.ReactElement {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<null | 'succeeded' | 'processing'>(null)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!stripe || !elements) return
    setBusy(true)
    setError(null)
    const { error: payError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: 'if_required',
    })
    if (payError) {
      setError(payError.message ?? 'Payment could not be completed.')
      setBusy(false)
      return
    }
    if (paymentIntent?.status === 'succeeded') {
      setDone('succeeded')
      onPaid()
    } else if (paymentIntent?.status === 'processing') {
      // ACH/bank debits settle asynchronously — the webhook flips the invoice
      // when the funds clear (can take a few business days).
      setDone('processing')
      onPaid()
    } else {
      setError('Payment could not be completed. Please try again.')
    }
    setBusy(false)
  }

  if (done === 'succeeded') {
    return (
      <div className="alert" role="status" style={{ marginTop: 'var(--space-3)' }}>
        <strong>Payment received.</strong> Thank you — your invoice will show as paid shortly.
      </div>
    )
  }
  if (done === 'processing') {
    return (
      <div className="alert" role="status" style={{ marginTop: 'var(--space-3)' }}>
        <strong>Payment submitted.</strong> Bank payments take a few business days to clear; your
        invoice will update to paid once it does.
      </div>
    )
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 'var(--space-3)' }}>
      <PaymentElement />
      {error && (
        <div className="alert alert-error" role="alert" style={{ marginTop: 'var(--space-3)' }}>
          {error}
        </div>
      )}
      <button
        type="submit"
        className="li-cp-btn li-cp-btn--gold"
        disabled={!stripe || busy}
        style={{ marginTop: 'var(--space-3)' }}
      >
        {busy ? 'Processing…' : `Pay ${amountLabel}`}
      </button>
    </form>
  )
}
