'use client'

// Platform Stripe setup (admin console → Payments). exsto-law's OWN Stripe keys —
// one set for the whole product, used to run the Connect platform. Stored encrypted
// in Vault; the secret + webhook secret never come back to the browser (status is
// booleans + the secret's last four only). A blank field on save leaves the stored
// value unchanged, so you can rotate one key at a time.
import { useCallback, useEffect, useState } from 'react'
import { callAdminMcp } from '@/lib/mcpAdmin'

interface StripePlatformStatus {
  secretKeySet: boolean
  publishableKeySet: boolean
  webhookSecretSet: boolean
  lastFour: string | null
  connectedAt: string | null
  lastError: string | null
}

function Dot({ on }: { on: boolean }): React.ReactElement {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 9,
        height: 9,
        borderRadius: '50%',
        marginRight: 6,
        background: on ? '#16a34a' : '#cbd5e1',
      }}
    />
  )
}

export default function AdminPaymentsPage(): React.ReactElement {
  const [status, setStatus] = useState<StripePlatformStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [secretKey, setSecretKey] = useState('')
  const [publishableKey, setPublishableKey] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await callAdminMcp<{ status: StripePlatformStatus }>({
        toolName: 'admin.payments.status',
      })
      setStatus(r.status)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save(): Promise<void> {
    setBusy('save')
    setError(null)
    setNotice(null)
    try {
      const r = await callAdminMcp<{ ok: boolean; error?: string }>({
        toolName: 'admin.payments.set_keys',
        input: { secretKey, publishableKey, webhookSecret },
      })
      if (!r.ok) {
        setError(r.error ?? 'Could not save the keys.')
      } else {
        setNotice('Saved. Keys are stored encrypted.')
        setSecretKey('')
        setPublishableKey('')
        setWebhookSecret('')
        await load()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function test(): Promise<void> {
    setBusy('test')
    setError(null)
    setNotice(null)
    try {
      const r = await callAdminMcp<{ ok: boolean; error?: string }>({
        toolName: 'admin.payments.test',
      })
      if (r.ok) setNotice('Stripe connection OK — the secret key works and Connect is enabled.')
      else setError(r.error ?? 'Stripe connection failed.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function clear(): Promise<void> {
    if (!confirm('Remove the stored Stripe keys? Online payments will stop until re-entered.'))
      return
    setBusy('clear')
    setError(null)
    setNotice(null)
    try {
      await callAdminMcp({ toolName: 'admin.payments.clear' })
      setNotice('Stored keys removed.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <main style={{ maxWidth: 720 }}>
      <h1>Payments</h1>
      <p style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
        exsto-law&rsquo;s own Stripe keys, used to run the Connect platform that lets firms accept
        online payments. Use <strong>test-mode</strong> keys (sk_test_… / pk_test_…) until you go
        live. Keys are stored encrypted; environment variables act as a fallback.
      </p>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div
          className="alert"
          role="status"
          style={{ background: '#ecfdf5', border: '1px solid #a7f3d0' }}
        >
          {notice}
        </div>
      )}

      {status && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '0.9rem 1rem',
            margin: '1rem 0',
          }}
        >
          <div>
            <Dot on={status.secretKeySet} /> Secret key{' '}
            {status.lastFour ? <code>…{status.lastFour}</code> : <em>not set</em>}
          </div>
          <div style={{ marginTop: 4 }}>
            <Dot on={status.publishableKeySet} /> Publishable key{' '}
            {status.publishableKeySet ? 'set' : <em>not set</em>}
          </div>
          <div style={{ marginTop: 4 }}>
            <Dot on={status.webhookSecretSet} /> Webhook signing secret{' '}
            {status.webhookSecretSet ? 'set' : <em>not set</em>}
          </div>
          {status.lastError && (
            <div style={{ marginTop: 8, color: '#b91c1c', fontSize: '0.85rem' }}>
              Last error: {status.lastError}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gap: '0.8rem', maxWidth: 520 }}>
        <label>
          <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Secret key</div>
          <input
            type="password"
            autoComplete="off"
            placeholder="sk_test_…  (leave blank to keep current)"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            style={{ width: '100%' }}
          />
        </label>
        <label>
          <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Publishable key</div>
          <input
            type="text"
            autoComplete="off"
            placeholder="pk_test_…  (leave blank to keep current)"
            value={publishableKey}
            onChange={(e) => setPublishableKey(e.target.value)}
            style={{ width: '100%' }}
          />
        </label>
        <label>
          <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Webhook signing secret</div>
          <input
            type="password"
            autoComplete="off"
            placeholder="whsec_…  (leave blank to keep current)"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            style={{ width: '100%' }}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: '1rem' }}>
        <button
          type="button"
          className="primary"
          disabled={busy !== null || (!secretKey && !publishableKey && !webhookSecret)}
          onClick={save}
        >
          {busy === 'save' ? 'Saving…' : 'Save keys'}
        </button>
        <button type="button" disabled={busy !== null || !status?.secretKeySet} onClick={test}>
          {busy === 'test' ? 'Testing…' : 'Test connection'}
        </button>
        <button
          type="button"
          disabled={
            busy !== null ||
            !(status?.secretKeySet || status?.publishableKeySet || status?.webhookSecretSet)
          }
          onClick={clear}
        >
          {busy === 'clear' ? 'Clearing…' : 'Clear stored keys'}
        </button>
      </div>

      <p
        style={{ color: 'var(--muted)', fontSize: '0.82rem', marginTop: '1.5rem', lineHeight: 1.5 }}
      >
        Get the secret &amp; publishable keys from the Stripe Dashboard → Developers → API keys (in
        test mode). The webhook signing secret comes from the webhook endpoint you create at
        Developers → Webhooks pointing to <code>…/api/webhooks/stripe</code> (events{' '}
        <code>payment_intent.succeeded</code> and <code>account.updated</code>). Enable Connect on
        the Stripe account first.
      </p>
    </main>
  )
}
