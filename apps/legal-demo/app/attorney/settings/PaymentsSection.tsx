'use client'

// Payments (Settings → Payments). The firm connects online card/bank payments via
// Stripe Connect Express: exsto-law is the platform, the firm is a connected
// account, and clients pay invoices on an embedded form branded as the firm.
// Connecting is a browser redirect to /api/billing/connect/init (Stripe-hosted
// onboarding), mirroring the Google connect flow; this card shows status and the
// connect / finish-setup / refresh / disconnect actions.
import { useCallback, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { CollapsibleSection } from '@/components/CollapsibleSection'

interface FirmPaymentStatus {
  configured: boolean
  connected: boolean
  chargesEnabled: boolean
  detailsSubmitted: boolean
  accountId: string | null
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
        <div className="loading-block">
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
    </CollapsibleSection>
  )
}
