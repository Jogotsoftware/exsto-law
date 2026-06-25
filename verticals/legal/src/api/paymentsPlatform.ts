// Platform Stripe credentials — the OWNER/ADMIN surface that provisions exsto-law's
// own Stripe keys (one set for the whole product, NOT per firm). Stored encrypted
// in Vault under the platform tenant via the same connectionStore the Anthropic/
// Perplexity keys use; the adapter (getStripeCredentials) reads them Vault-first
// with an env fallback. Every function re-asserts platform-admin (assertPlatformAdmin)
// so the gate holds for any adapter, and NO secret is ever returned to a caller —
// status exposes only booleans + the secret key's last four.
import {
  assertPlatformAdmin,
  PLATFORM_TENANT_ID,
  recordControlPlaneAction,
} from '../controlPlane/context.js'
import {
  saveConnection,
  loadConnection,
  getConnectionInfo,
  disconnect,
} from '../adapters/connectionStore.js'
import { getStripeCredentials, verifyStripeSecretKey } from '../adapters/stripe.js'
import type { ActionContext } from '@exsto/substrate'

interface StripeVaultSecret {
  secret_key?: string
  publishable_key?: string
  webhook_secret?: string
}

export interface StripePlatformStatus {
  secretKeySet: boolean
  publishableKeySet: boolean
  webhookSecretSet: boolean
  /** Last four of the secret key, for a masked confirmation in the UI. */
  lastFour: string | null
  connectedAt: string | null
  lastError: string | null
}

export interface SaveStripeKeysInput {
  secretKey?: string | null
  publishableKey?: string | null
  webhookSecret?: string | null
}

export interface SaveStripeKeysResult {
  ok: boolean
  error?: string
}

// Which keys resolve right now (Vault or env) + the masked secret tail.
export async function getStripePlatformStatus(ctx: ActionContext): Promise<StripePlatformStatus> {
  await assertPlatformAdmin(ctx)
  const creds = await getStripeCredentials()
  const info = await getConnectionInfo(PLATFORM_TENANT_ID, 'stripe')
  return {
    secretKeySet: !!creds.secretKey,
    publishableKeySet: !!creds.publishableKey,
    webhookSecretSet: !!creds.webhookSecret,
    lastFour: creds.secretKey ? creds.secretKey.slice(-4) : null,
    connectedAt: info?.connectedAt?.toISOString() ?? null,
    lastError: info?.lastError ?? null,
  }
}

// Save (merge) the platform keys into Vault. A blank field LEAVES the stored value
// alone (so you can rotate one key without re-entering the others). The secret key,
// if provided, is shape-checked and PROBED against Stripe before persisting.
export async function saveStripePlatformKeys(
  ctx: ActionContext,
  input: SaveStripeKeysInput,
): Promise<SaveStripeKeysResult> {
  await assertPlatformAdmin(ctx)

  const existing =
    (await loadConnection<StripeVaultSecret>(PLATFORM_TENANT_ID, 'stripe'))?.secret ?? {}
  const secretKey = (input.secretKey ?? '').trim() || existing.secret_key
  const publishableKey = (input.publishableKey ?? '').trim() || existing.publishable_key
  const webhookSecret = (input.webhookSecret ?? '').trim() || existing.webhook_secret

  if (secretKey && !/^sk_(test|live)_/.test(secretKey)) {
    return { ok: false, error: 'Secret key should start with sk_test_ or sk_live_.' }
  }
  if (publishableKey && !/^pk_(test|live)_/.test(publishableKey)) {
    return { ok: false, error: 'Publishable key should start with pk_test_ or pk_live_.' }
  }
  if (webhookSecret && !/^whsec_/.test(webhookSecret)) {
    return { ok: false, error: 'Webhook signing secret should start with whsec_.' }
  }

  // Probe the secret key (only when it changed) — verifies the key works AND that
  // Connect is enabled, before we store it.
  if (secretKey && secretKey !== existing.secret_key) {
    const err = await verifyStripeSecretKey(secretKey)
    if (err) return { ok: false, error: err }
  }

  const secret: StripeVaultSecret = {}
  if (secretKey) secret.secret_key = secretKey
  if (publishableKey) secret.publishable_key = publishableKey
  if (webhookSecret) secret.webhook_secret = webhookSecret

  await saveConnection(
    PLATFORM_TENANT_ID,
    'stripe',
    secret,
    { detail: { last_four: secretKey ? secretKey.slice(-4) : null } },
    ctx.actorId,
  )
  await recordControlPlaneAction(ctx, 'payments.set_keys', null, {
    fields: Object.entries(input)
      .filter(([, v]) => (v ?? '').toString().trim())
      .map(([k]) => k),
  })
  return { ok: true }
}

// Re-probe the currently-stored secret key (the "Test connection" button).
export async function testStripePlatformConnection(
  ctx: ActionContext,
): Promise<SaveStripeKeysResult> {
  await assertPlatformAdmin(ctx)
  const { secretKey } = await getStripeCredentials()
  if (!secretKey) return { ok: false, error: 'No Stripe secret key is set yet.' }
  const err = await verifyStripeSecretKey(secretKey)
  return err ? { ok: false, error: err } : { ok: true }
}

// Clear the stored platform keys (an env fallback, if any, still applies).
export async function clearStripePlatformKeys(ctx: ActionContext): Promise<void> {
  await assertPlatformAdmin(ctx)
  await disconnect(PLATFORM_TENANT_ID, 'stripe', ctx.actorId)
  await recordControlPlaneAction(ctx, 'payments.clear_keys', null, {})
}
