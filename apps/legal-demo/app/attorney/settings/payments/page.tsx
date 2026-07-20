'use client'

// Settings → Payments (WP-G). Split out of the old settings monolith — same
// legal.firm.payment_status/payment_refresh/payment_disconnect and
// legal.firm.get_payment_methods/set_payment_methods tools, restyled to the
// comp's card. Keeps the app's richer connect/finish-setup/refresh/disconnect
// flow (the comp shows a single "Manage" button opening a Stripe manage
// panel — deferred to WIRING.md §WP-G G2, no backing tool exists yet).
import { useCallback, useEffect, useState } from 'react'
import { CreditCard, Check } from 'lucide-react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { SettingsHeader, SettingsLoading, SettingsAlert } from '../shared'

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
function returnBanner(
  flag: string | null,
): { tone: 'success' | 'warn' | 'error'; text: string } | null {
  switch (flag) {
    case 'connected':
      return {
        tone: 'success',
        text: 'Payments connected — your firm can now accept online payments.',
      }
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

export default function PaymentsPage(): React.ReactElement {
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

  const statusTone = !status
    ? 'off'
    : !status.connected
      ? 'off'
      : status.chargesEnabled
        ? 'ok'
        : 'warn'
  const statusText = !status
    ? ''
    : !status.configured
      ? 'Not enabled on this deployment'
      : !status.connected
        ? 'Not connected'
        : status.chargesEnabled
          ? 'Connected'
          : 'Setup not finished'

  return (
    <>
      <SettingsHeader title="Payments" />
      {banner && <SettingsAlert tone={banner.tone}>{banner.text}</SettingsAlert>}
      {error && <SettingsAlert tone="error">{error}</SettingsAlert>}

      {loading && !status ? (
        <SettingsLoading />
      ) : status ? (
        <div className="li-set-card li-set-card--narrow">
          <div className="li-set-pay-head">
            <span className="li-set-pay-icon">
              <CreditCard size={20} aria-hidden />
            </span>
            <div>
              <div className="li-set-pay-title">Card Payments — Stripe</div>
              <div className={`li-set-pay-status ${statusTone}`}>{statusText}</div>
            </div>
          </div>
          <p className="li-set-hint" style={{ fontSize: '13.5px', margin: '0 0 18px' }}>
            Accept card and bank (ACH) payments on your invoices. Clients pay on a secure form on
            your own invoice page — it never leaves your site. Powered by Stripe; your firm is the
            account of record and funds settle to your bank.
          </p>

          {!status.configured ? (
            <SettingsAlert tone="warn">
              Online payments aren’t enabled on this deployment yet. (Set the Stripe keys in the
              environment to turn them on.)
            </SettingsAlert>
          ) : !status.connected ? (
            <button
              type="button"
              className="li-set-btn li-set-btn-primary"
              disabled={busy === 'connect'}
              onClick={connect}
            >
              {busy === 'connect' ? 'Redirecting…' : 'Connect payments'}
            </button>
          ) : status.chargesEnabled ? (
            <>
              <SettingsAlert tone="success">
                <strong>Connected.</strong> Your firm is ready to accept online payments.
              </SettingsAlert>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="li-set-btn"
                  disabled={busy === 'refresh'}
                  onClick={refresh}
                >
                  {busy === 'refresh' ? 'Checking…' : 'Refresh status'}
                </button>
                <button
                  type="button"
                  className="li-set-btn li-set-btn-danger"
                  disabled={busy === 'disconnect'}
                  onClick={disconnect}
                >
                  {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </div>
            </>
          ) : (
            <>
              <SettingsAlert tone="warn">
                <strong>Setup not finished.</strong> Stripe still needs a few details before you can
                accept payments.
              </SettingsAlert>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="li-set-btn li-set-btn-primary"
                  disabled={busy === 'connect'}
                  onClick={connect}
                >
                  {busy === 'connect' ? 'Redirecting…' : 'Finish setup'}
                </button>
                <button
                  type="button"
                  className="li-set-btn"
                  disabled={busy === 'refresh'}
                  onClick={refresh}
                >
                  {busy === 'refresh' ? 'Checking…' : 'Refresh status'}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      <ManualMethodsCard />
    </>
  )
}

// Zelle + crypto (migration 0115): instruct-then-verify rails shown to clients on
// the invoice payment page. Clients report their payment with a confirmation
// number / tx hash; those reports land on Billing for the attorney to verify.
function ManualMethodsCard(): React.ReactElement {
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

  if (error && !methods)
    return (
      <div className="li-set-card li-set-card--narrow">
        <SettingsAlert tone="error">{error}</SettingsAlert>
      </div>
    )
  if (!methods)
    return (
      <div className="li-set-card li-set-card--narrow">
        <SettingsLoading />
      </div>
    )

  const zelle = methods.zelle ?? { recipient: '', recipientName: '' }
  const setZelle = (patch: Partial<{ recipient: string; recipientName: string }>): void =>
    setMethods({ ...methods, zelle: { ...zelle, ...patch } })
  const setWallet = (i: number, patch: Partial<CryptoWallet>): void =>
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

  return (
    <div className="li-set-card li-set-card--narrow">
      <div className="li-set-pay-methods" style={{ marginBottom: 20 }}>
        <div className="li-set-pay-method">
          <div className="li-set-pay-method-title">Zelle</div>
          <div className="li-set-pay-method-sub">{zelle.recipient || 'Not configured'}</div>
        </div>
        <div className="li-set-pay-method">
          <div className="li-set-pay-method-title">Crypto — BTC / USDC</div>
          <div className="li-set-pay-method-sub">{methods.wallets.length} wallet(s) configured</div>
        </div>
      </div>

      <div
        className="li-set-manual-block"
        style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}
      >
        <h3>Zelle &amp; Crypto</h3>
        <p className="li-set-hint" style={{ margin: '0 0 16px' }}>
          Shown to clients on the invoice payment page as “Other ways to pay”, with step-by-step
          instructions and QR codes. Clients report their payment with a Zelle confirmation number
          or crypto transaction ID (plus an optional screenshot); you verify and confirm it on the
          Billing page — invoices are never marked paid automatically.
        </p>
        {error && <SettingsAlert tone="error">{error}</SettingsAlert>}

        <label className="li-set-label">
          <span>
            Zelle email or U.S. phone{' '}
            <span className="li-set-hint" style={{ display: 'inline', margin: 0 }}>
              (blank = don’t offer Zelle)
            </span>
          </span>
          <input
            type="text"
            className="li-set-input"
            value={zelle.recipient}
            onChange={(e) => setZelle({ recipient: e.target.value })}
            placeholder="payments@yourfirm.com"
          />
        </label>
        <label className="li-set-label">
          <span>
            Zelle recipient name{' '}
            <span className="li-set-hint" style={{ display: 'inline', margin: 0 }}>
              (what the payer’s bank shows)
            </span>
          </span>
          <input
            type="text"
            className="li-set-input"
            value={zelle.recipientName}
            onChange={(e) => setZelle({ recipientName: e.target.value })}
            placeholder="Smith & Associates PLLC"
          />
        </label>

        <div className="li-set-table-title" style={{ marginTop: 10 }}>
          Crypto Wallets
        </div>
        {methods.wallets.map((w, i) => (
          <div key={i} className="li-set-wallet-card">
            <div className="li-set-wallet-row">
              <input
                type="text"
                className="li-set-input"
                value={w.currency}
                onChange={(e) => setWallet(i, { currency: e.target.value })}
                placeholder="Currency (BTC, ETH, USDC…)"
              />
              <input
                type="text"
                className="li-set-input"
                value={w.network}
                onChange={(e) => setWallet(i, { network: e.target.value })}
                placeholder="Network (e.g. Ethereum mainnet)"
                style={{ flex: 2 }}
              />
            </div>
            <input
              type="text"
              className="li-set-input"
              value={w.address}
              onChange={(e) => setWallet(i, { address: e.target.value })}
              placeholder="Wallet address"
            />
            <div className="li-set-wallet-row">
              <input
                type="text"
                className="li-set-input"
                value={w.label}
                onChange={(e) => setWallet(i, { label: e.target.value })}
                placeholder="Label (optional, e.g. Firm treasury)"
              />
              <button
                type="button"
                className="li-set-btn li-set-btn-sm"
                onClick={() =>
                  setMethods({ ...methods, wallets: methods.wallets.filter((_, wi) => wi !== i) })
                }
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <div className="li-set-actions-row" style={{ justifyContent: 'flex-start' }}>
          <button
            type="button"
            className="li-set-btn"
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
          <button
            type="button"
            className="li-set-btn li-set-btn-primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save payment methods'}
          </button>
          {saved && (
            <span
              className="li-set-hint"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: 0 }}
            >
              <Check size={14} aria-hidden /> Saved
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
