'use client'

// "Other ways to pay" — the firm's instruct-then-verify rails (Zelle + crypto,
// migration 0115). Neither has a charge API, so the contract with the client is:
// CLEAR step-by-step instructions (with QR codes) → they pay in their own
// banking/wallet app → they REPORT the payment here with a verification handle
// (Zelle confirmation number / crypto transaction hash) and an optional proof
// screenshot. The invoice stays "Amount due" until the attorney verifies — the
// report form says so explicitly, so nobody thinks reporting = paid.
import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Check } from 'lucide-react'
import { callClientPortalMcp, PortalSessionExpiredError } from '@/lib/mcpClientPortal'

interface CryptoWallet {
  label: string
  currency: string
  network: string
  address: string
}
interface ManualPaymentMethods {
  zelle: { recipient: string; recipientName: string } | null
  wallets: CryptoWallet[]
}

// Zelle's QR payload: the enroll.zellepay.com URL wraps a base64 JSON
// {token, name, action} — the format Zelle-enabled banking apps generate and
// scan. Unofficial but stable; the recipient email/phone is ALSO shown in
// plain text right next to it, so a bank app that won't scan it loses nothing.
function zelleQrUrl(recipient: string, name: string): string {
  const payload = { token: recipient, action: 'payment', name: name || recipient }
  return `https://enroll.zellepay.com/qr-codes?data=${btoa(JSON.stringify(payload))}`
}

// BIP-21-style URI schemes wallets recognize when scanning; unknown currencies
// fall back to a raw-address QR (still scannable as text in every wallet).
const URI_SCHEME: Record<string, string> = {
  BTC: 'bitcoin:',
  ETH: 'ethereum:',
  USDC: 'ethereum:',
  USDT: 'ethereum:',
  LTC: 'litecoin:',
  DOGE: 'dogecoin:',
  BCH: 'bitcoincash:',
}
function cryptoQrValue(w: CryptoWallet): string {
  const scheme = URI_SCHEME[w.currency.toUpperCase()]
  // Token currencies on other networks (e.g. USDC on Solana) get the raw address.
  if (scheme === 'ethereum:' && w.network && !/ether|erc/i.test(w.network)) return w.address
  return scheme ? `${scheme}${w.address}` : w.address
}

function QrImage({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(value, { width: 168, margin: 1 })
      .then((url) => {
        if (!cancelled) setSrc(url)
      })
      .catch(() => {
        if (!cancelled) setSrc(null)
      })
    return () => {
      cancelled = true
    }
  }, [value])
  if (!src) return null
  // A data-URL QR is self-contained — next/image adds nothing here.
  return (
    <img
      src={src}
      alt={label}
      width={168}
      height={168}
      style={{ borderRadius: 8, border: '1px solid var(--border)', background: '#fff' }}
    />
  )
}

function CopyButton({ text, what }: { text: string; what: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="pdash-btn pdash-btn-sm"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        })
      }}
    >
      {copied ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Check size={14} aria-hidden /> Copied
        </span>
      ) : (
        `Copy ${what}`
      )}
    </button>
  )
}

const stepList: React.CSSProperties = {
  margin: 'var(--space-2) 0 0',
  paddingLeft: '1.2rem',
  display: 'grid',
  gap: '0.35rem',
}
const mono: React.CSSProperties = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: '0.85rem',
  wordBreak: 'break-all',
}

export function ManualPaymentOptions({
  invoiceNumber,
  amountLabel,
}: {
  invoiceNumber: string
  amountLabel: string
}) {
  const [methods, setMethods] = useState<ManualPaymentMethods | null>(null)

  // Report form state.
  const [method, setMethod] = useState<'zelle' | 'crypto' | null>(null)
  const [walletIdx, setWalletIdx] = useState(0)
  const [reference, setReference] = useState('')
  const [payerName, setPayerName] = useState('')
  const [note, setNote] = useState('')
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reported, setReported] = useState(false)

  useEffect(() => {
    callClientPortalMcp<{ methods: ManualPaymentMethods }>({
      toolName: 'legal.client.payment_methods',
    })
      .then((r) => setMethods(r.methods))
      .catch(() => setMethods(null)) // no options → render nothing; card/ACH still works
  }, [])

  const hasZelle = !!methods?.zelle
  const wallets = useMemo(() => methods?.wallets ?? [], [methods])
  // Default the report form to whichever single method exists.
  useEffect(() => {
    if (!methods || method) return
    if (hasZelle && wallets.length === 0) setMethod('zelle')
    if (!hasZelle && wallets.length > 0) setMethod('crypto')
  }, [methods, method, hasZelle, wallets])

  if (!methods || (!hasZelle && wallets.length === 0)) return null

  async function submitReport() {
    if (busy || !method) return
    setBusy(true)
    setError(null)
    try {
      // Optional proof screenshot first — the report then carries its key.
      let screenshotKey: string | null = null
      if (screenshot) {
        const form = new FormData()
        form.append('file', screenshot)
        const res = await fetch('/api/client/portal/payments/screenshot', {
          method: 'POST',
          body: form,
          credentials: 'same-origin',
        })
        const body = (await res.json().catch(() => null)) as { key?: string; error?: string }
        if (!res.ok || !body?.key) {
          throw new Error(body?.error || 'Screenshot upload failed — try again or skip it.')
        }
        screenshotKey = body.key
      }
      const wallet =
        method === 'crypto' && wallets[walletIdx]
          ? { label: wallets[walletIdx].label, currency: wallets[walletIdx].currency }
          : null
      await callClientPortalMcp<{ eventId: string }>({
        toolName: 'legal.client.report_payment',
        input: {
          invoiceNumber,
          method,
          reference: reference.trim(),
          payerName: payerName.trim() || null,
          note: note.trim() || null,
          wallet,
          screenshotKey,
        },
      })
      setReported(true)
    } catch (e) {
      if (e instanceof PortalSessionExpiredError) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 'var(--space-4)', display: 'grid', gap: 'var(--space-3)' }}>
      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Other ways to pay</h2>

      {hasZelle && methods.zelle && (
        <div className="pdash-card">
          <div className="pdash-card-head">
            <h3 style={{ margin: 0 }}>Pay with Zelle</h3>
            <span className="pdash-badge">No fees</span>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-4)',
              flexWrap: 'wrap',
              alignItems: 'start',
            }}
          >
            <ol style={stepList}>
              <li>Open your banking app and choose “Send money with Zelle”.</li>
              <li>
                Add the recipient: <strong style={mono}>{methods.zelle.recipient}</strong>
                {methods.zelle.recipientName && <> ({methods.zelle.recipientName})</>} — or scan the
                QR code with your banking app.
              </li>
              <li>
                Send <strong>{amountLabel}</strong> and put{' '}
                <strong style={mono}>{invoiceNumber}</strong> in the memo/note so the firm can match
                your payment.
              </li>
              <li>Report the payment below with the confirmation number your bank shows.</li>
            </ol>
            <div style={{ textAlign: 'center' }}>
              <QrImage
                value={zelleQrUrl(methods.zelle.recipient, methods.zelle.recipientName)}
                label={`Zelle QR for ${methods.zelle.recipient}`}
              />
              <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                Scan in your banking app
              </div>
            </div>
          </div>
        </div>
      )}

      {wallets.map((w, i) => (
        <div key={i} className="pdash-card">
          <div className="pdash-card-head">
            <h3 style={{ margin: 0 }}>
              Pay with {w.currency}
              {w.label ? ` — ${w.label}` : ''}
            </h3>
            {w.network && <span className="pdash-badge">{w.network}</span>}
          </div>
          <div className="alert" role="note" style={{ marginTop: 'var(--space-2)' }}>
            Send <strong>only {w.currency}</strong>
            {w.network && (
              <>
                {' '}
                on <strong>{w.network}</strong>
              </>
            )}{' '}
            to this address. Funds sent as a different coin or on a different network cannot be
            recovered.
          </div>
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-4)',
              flexWrap: 'wrap',
              alignItems: 'start',
            }}
          >
            <div style={{ flex: '1 1 260px' }}>
              <ol style={stepList}>
                <li>
                  Copy the address below and paste it into your wallet (or scan the QR).
                  Double-check the first and last four characters after pasting.
                </li>
                <li>
                  Send the {w.currency} equivalent of <strong>{amountLabel}</strong> (use your
                  wallet’s USD conversion at the time you send).
                </li>
                <li>Wait until your wallet shows the transaction as sent/confirmed.</li>
                <li>
                  Copy the <strong>transaction ID</strong> (also called tx hash) from your wallet
                  and report it below — the firm uses it to verify your payment on the blockchain.
                </li>
              </ol>
              <div style={{ ...mono, marginTop: 'var(--space-2)' }}>{w.address}</div>
              <div style={{ marginTop: 'var(--space-2)' }}>
                <CopyButton text={w.address} what="address" />
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <QrImage value={cryptoQrValue(w)} label={`${w.currency} address QR`} />
              <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                Scan in your wallet app
              </div>
            </div>
          </div>
        </div>
      ))}

      <div className="pdash-card">
        <div className="pdash-card-head">
          <h3 style={{ margin: 0 }}>Already paid? Report it</h3>
        </div>
        {reported ? (
          <div className="alert" role="status">
            <strong>Payment reported — thank you.</strong> The firm will verify it and mark this
            invoice paid; the status here updates once that happens. No further action is needed.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-2)', maxWidth: 520 }}>
            <p className="text-sm text-muted" style={{ margin: 0 }}>
              Zelle and crypto payments are confirmed by the firm — reporting your payment here with
              the confirmation details lets them verify it quickly. The invoice shows “Amount due”
              until they do.
            </p>
            {hasZelle && wallets.length > 0 && (
              <label className="text-sm">
                How did you pay?
                <select
                  value={method ?? ''}
                  onChange={(e) => setMethod(e.target.value === 'crypto' ? 'crypto' : 'zelle')}
                  style={{ display: 'block', marginTop: 4 }}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  <option value="zelle">Zelle</option>
                  <option value="crypto">Crypto</option>
                </select>
              </label>
            )}
            {method === 'crypto' && wallets.length > 1 && (
              <label className="text-sm">
                Which address did you pay to?
                <select
                  value={walletIdx}
                  onChange={(e) => setWalletIdx(Number(e.target.value))}
                  style={{ display: 'block', marginTop: 4 }}
                >
                  {wallets.map((w, i) => (
                    <option key={i} value={i}>
                      {w.currency}
                      {w.label ? ` — ${w.label}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-sm">
              {method === 'crypto'
                ? 'Transaction ID (tx hash) from your wallet'
                : 'Zelle confirmation number from your bank'}
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={
                  method === 'crypto'
                    ? '0x… or a long letters-and-numbers code'
                    : 'e.g. BACabc123xyz'
                }
                style={{ display: 'block', width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="text-sm">
              Your name (as it appears on the payment){' '}
              <span className="text-muted">(optional)</span>
              <input
                type="text"
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="text-sm">
              Note for the firm <span className="text-muted">(optional)</span>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: 4 }}
              />
            </label>
            <label className="text-sm">
              Proof screenshot <span className="text-muted">(optional — PNG or JPG)</span>
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
                style={{ display: 'block', marginTop: 4 }}
              />
            </label>
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}
            <div>
              <button
                type="button"
                className="pdash-btn"
                disabled={busy || !method || reference.trim().length < 4}
                onClick={() => void submitReport()}
              >
                {busy ? 'Reporting…' : 'Report payment'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
