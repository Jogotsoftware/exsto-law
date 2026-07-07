'use client'

// Payments (Settings → Payments). The firm connects online card/bank payments via
// Stripe Connect Express: exsto-law is the platform, the firm is a connected
// account, and clients pay invoices on an embedded form branded as the firm.
// Connecting is a browser redirect to /api/billing/connect/init (Stripe-hosted
// onboarding), mirroring the Google connect flow; this card shows status and the
// connect / finish-setup / refresh / disconnect actions.
import { useCallback, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { CollapsibleSection } from '@/components/CollapsibleSection'

interface FirmPaymentStatus {
  configured: boolean
  connected: boolean
  chargesEnabled: boolean
  detailsSubmitted: boolean
  accountId: string | null
}

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

// The ?payments= flag the connect return/refresh routes set on the way back.
function returnBanner(flag: string | null): { tone: 'ok' | 'warn' | 'error'; text: string } | null {
  switch (flag) {
    case 'connected':
      return { tone: 'ok', text: 'Payments connected — your firm can now accept online payments.' }
    case 'incomplete':
      return {
        tone: 'warn',
        text: 'Almost there — Stripe still needs a few details before you can accept payments.',
      }
    case 'signin':
      return { tone: 'warn', text: 'Your session expired during setup. Sign in and try again.' }
    case 'error':
      return { tone: 'error', text: 'Something went wrong finishing setup. Please try again.' }
    default:
      return null
  }
}

export function PaymentsSection(): React.ReactElement {
  const [status, setStatus] = useState<FirmPaymentStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [banner, setBanner] = useState<ReturnType<typeof returnBanner>>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await callAttorneyMcp<{ status: FirmPaymentStatus }>({
        toolName: 'legal.firm.payment_status',
      })
      setStatus(r.status)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Surface the connect-return result once, then strip the query param so a
  // refresh doesn't re-show it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const b = returnBanner(params.get('payments'))
    if (b) {
      setBanner(b)
      params.delete('payments')
      const qs = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
    }
  }, [])

  function connect(): void {
    setBusy('connect')
    window.location.href = '/api/billing/connect/init'
  }

  async function refresh(): Promise<void> {
    setBusy('refresh')
    setError(null)
    try {
      const r = await callAttorneyMcp<{ status: FirmPaymentStatus }>({
        toolName: 'legal.firm.payment_refresh',
      })
      setStatus(r.status)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function disconnect(): Promise<void> {
    if (!confirm('Stop accepting online payments? You can reconnect anytime.')) return
    setBusy('disconnect')
    setError(null)
    try {
      await callAttorneyMcp({ toolName: 'legal.firm.payment_disconnect' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <CollapsibleSection title="Payments">
      {banner && (
        <div
          className={banner.tone === 'error' ? 'alert alert-error' : 'alert'}
          style={
            banner.tone === 'warn'
              ? { background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }
              : undefined
          }
        >
          {banner.text}
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {loading && !status ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      ) : status ? (
        <>
          <p className="text-muted" style={{ marginBottom: '1rem', lineHeight: 1.5 }}>
            Accept card and bank (ACH) payments on your invoices. Clients pay on a secure form on
            your own invoice page — it never leaves your site. Powered by Stripe; your firm is the
            account of record and funds settle to your bank.
          </p>

          {!status.configured ? (
            <div className="alert">
              Online payments aren’t enabled on this deployment yet. (Set the Stripe keys in the
              environment to turn them on.)
            </div>
          ) : !status.connected ? (
            <button
              type="button"
              className="primary"
              disabled={busy === 'connect'}
              onClick={connect}
            >
              {busy === 'connect' ? 'Redirecting…' : 'Connect payments'}
            </button>
          ) : status.chargesEnabled ? (
            <div>
              <div className="alert" style={{ background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
                <strong>Connected.</strong> Your firm is ready to accept online payments.
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: '0.6rem' }}>
                <button type="button" disabled={busy === 'refresh'} onClick={refresh}>
                  {busy === 'refresh' ? 'Checking…' : 'Refresh status'}
                </button>
                <button type="button" disabled={busy === 'disconnect'} onClick={disconnect}>
                  {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div
                className="alert"
                style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}
              >
                <strong>Setup not finished.</strong> Stripe still needs a few details before you can
                accept payments.
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: '0.6rem' }}>
                <button
                  type="button"
                  className="primary"
                  disabled={busy === 'connect'}
                  onClick={connect}
                >
                  {busy === 'connect' ? 'Redirecting…' : 'Finish setup'}
                </button>
                <button type="button" disabled={busy === 'refresh'} onClick={refresh}>
                  {busy === 'refresh' ? 'Checking…' : 'Refresh status'}
                </button>
              </div>
            </div>
          )}
        </>
      ) : null}

      <ManualMethodsEditor />
    </CollapsibleSection>
  )
}

// Zelle + crypto (migration 0115): instruct-then-verify rails shown to clients on
// the invoice payment page. Clients report their payment with a confirmation
// number / tx hash; those reports land on Billing for the attorney to verify.
function ManualMethodsEditor(): React.ReactElement {
  const [methods, setMethods] = useState<ManualPaymentMethods | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    callAttorneyMcp<{ methods: ManualPaymentMethods }>({
      toolName: 'legal.firm.get_payment_methods',
    })
      .then((r) => setMethods(r.methods))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (error && !methods) return <div className="alert alert-error">{error}</div>
  if (!methods) {
    return (
      <div className="loading-block" role="status">
        <span className="spinner" /> Loading…
      </div>
    )
  }

  const zelle = methods.zelle ?? { recipient: '', recipientName: '' }
  const setZelle = (patch: Partial<{ recipient: string; recipientName: string }>) =>
    setMethods({ ...methods, zelle: { ...zelle, ...patch } })
  const setWallet = (i: number, patch: Partial<CryptoWallet>) =>
    setMethods({
      ...methods,
      wallets: methods.wallets.map((w, wi) => (wi === i ? { ...w, ...patch } : w)),
    })

  async function save(): Promise<void> {
    if (!methods || saving) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const config: ManualPaymentMethods = {
        zelle: zelle.recipient.trim()
          ? { recipient: zelle.recipient.trim(), recipientName: zelle.recipientName.trim() }
          : null,
        wallets: methods.wallets
          .map((w) => ({
            label: w.label.trim(),
            currency: w.currency.trim().toUpperCase(),
            network: w.network.trim(),
            address: w.address.trim(),
          }))
          .filter((w) => w.address && w.currency),
      }
      const r = await callAttorneyMcp<{ methods: ManualPaymentMethods }>({
        toolName: 'legal.firm.set_payment_methods',
        input: { config },
      })
      setMethods(r.methods)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const field: React.CSSProperties = { display: 'block', width: '100%', marginTop: 4 }

  return (
    <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
      <h3 style={{ margin: '0 0 0.25rem' }}>Zelle &amp; crypto</h3>
      <p className="text-muted" style={{ marginTop: 0, lineHeight: 1.5 }}>
        Shown to clients on the invoice payment page as “Other ways to pay”, with step-by-step
        instructions and QR codes. Clients report their payment with a Zelle confirmation number or
        crypto transaction ID (plus an optional screenshot); you verify and confirm it on the
        Billing page — invoices are never marked paid automatically.
      </p>
      {error && <div className="alert alert-error">{error}</div>}

      <div style={{ display: 'grid', gap: '0.5rem', maxWidth: 560 }}>
        <label className="text-sm">
          Zelle email or U.S. phone <span className="text-muted">(blank = don’t offer Zelle)</span>
          <input
            type="text"
            value={zelle.recipient}
            onChange={(e) => setZelle({ recipient: e.target.value })}
            placeholder="payments@yourfirm.com"
            style={field}
          />
        </label>
        <label className="text-sm">
          Zelle recipient name <span className="text-muted">(what the payer’s bank shows)</span>
          <input
            type="text"
            value={zelle.recipientName}
            onChange={(e) => setZelle({ recipientName: e.target.value })}
            placeholder="Pacheco Law PLLC"
            style={field}
          />
        </label>

        <div className="text-sm" style={{ marginTop: '0.5rem', fontWeight: 600 }}>
          Crypto wallets
        </div>
        {methods.wallets.map((w, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gap: '0.4rem',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '0.6rem',
            }}
          >
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input
                type="text"
                value={w.currency}
                onChange={(e) => setWallet(i, { currency: e.target.value })}
                placeholder="Currency (BTC, ETH, USDC…)"
                style={{ flex: 1 }}
              />
              <input
                type="text"
                value={w.network}
                onChange={(e) => setWallet(i, { network: e.target.value })}
                placeholder="Network (e.g. Ethereum mainnet)"
                style={{ flex: 2 }}
              />
            </div>
            <input
              type="text"
              value={w.address}
              onChange={(e) => setWallet(i, { address: e.target.value })}
              placeholder="Wallet address"
            />
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input
                type="text"
                value={w.label}
                onChange={(e) => setWallet(i, { label: e.target.value })}
                placeholder="Label (optional, e.g. Firm treasury)"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={() =>
                  setMethods({ ...methods, wallets: methods.wallets.filter((_, wi) => wi !== i) })
                }
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <div>
          <button
            type="button"
            disabled={methods.wallets.length >= 10}
            onClick={() =>
              setMethods({
                ...methods,
                wallets: [
                  ...methods.wallets,
                  { label: '', currency: '', network: '', address: '' },
                ],
              })
            }
          >
            Add wallet
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: '0.4rem' }}>
          <button type="button" className="primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save payment methods'}
          </button>
          {saved && (
            <span
              className="text-sm text-muted"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Check size={14} aria-hidden /> Saved
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
