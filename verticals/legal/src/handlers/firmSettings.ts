import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEntity, lookupKindId } from './common.js'

// ───────────────────────────────────────────────────────────────────────────
// Contract K (Session 7) — the firm default billing rate, substrate-native.
//
// firm_settings is a SINGLETON entity per tenant (migration 0065). It is the
// only home Contract K had to build: per-client rate (client_billable_rate) and
// per-service fee (workflow_definition.fixed_fee) already had homes. The firm
// default is the fallback getClientRate uses when a client has no explicit rate.
//
// Setting the rate writes a NEW firm_default_hourly_rate attribute row that
// supersedes the prior value (append-only; the prior rate stays in history,
// effective-dated by valid_from). Reads — getFirmDefaultRate / the Rates tab —
// live in api/rates.ts + queries.
// ───────────────────────────────────────────────────────────────────────────

const FIRM_SETTINGS_KIND = 'firm_settings'

// A decimal-string money value (ADR 0044): digits with an optional decimal part,
// optional leading minus. No JSON numbers, ever. Rejects '', 'abc', '1.2.3'.
const MONEY_RE = /^-?\d+(\.\d+)?$/

interface SetDefaultRatePayload {
  rate: string // decimal string, e.g. "350.00"
}

// Find the tenant's singleton firm_settings entity, creating it on first use.
// Idempotent within a tenant: there is at most one active firm_settings entity,
// so subsequent calls reuse it and only append a new rate attribute.
export async function ensureFirmSettings(
  client: DbClient,
  tenantId: string,
  actionId: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT e.id
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
      WHERE e.tenant_id = $1 AND ekd.kind_name = $2 AND e.status = 'active'
      ORDER BY e.created_at ASC
      LIMIT 1`,
    [tenantId, FIRM_SETTINGS_KIND],
  )
  const found = existing.rows[0]?.id
  if (found) return found

  const kindId = await lookupKindId(client, 'entity_kind_definition', tenantId, FIRM_SETTINGS_KIND)
  return insertEntity(client, tenantId, actionId, kindId, 'Firm settings', {})
}

// Handler-side read of the firm default, within an open transaction (the api
// reader is api/rates.ts getFirmDefaultRate). Used by the invoice rollup to fall
// back to the firm default when a client has no explicit client_billable_rate.
export async function readFirmDefaultRate(
  client: DbClient,
  tenantId: string,
): Promise<string | null> {
  const res = await client.query<{ rate: string | null }>(
    `SELECT a.value #>> '{}' AS rate
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       JOIN entity e ON e.id = a.entity_id
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
      WHERE a.tenant_id = $1
        AND akd.kind_name = 'firm_default_hourly_rate'
        AND ekd.kind_name = 'firm_settings'
        AND (a.valid_to IS NULL OR a.valid_to > now())
      ORDER BY a.valid_from DESC
      LIMIT 1`,
    [tenantId],
  )
  return res.rows[0]?.rate ?? null
}

registerActionHandler('legal.firm.set_default_rate', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as SetDefaultRatePayload
  const rate = (p.rate ?? '').trim()
  if (!MONEY_RE.test(rate)) {
    throw new Error(
      `firm default rate must be a decimal string (ADR 0044), e.g. "350.00"; got ${JSON.stringify(
        p.rate,
      )}.`,
    )
  }

  const firmSettingsId = await ensureFirmSettings(client, ctx.tenantId, actionId)
  const akId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'firm_default_hourly_rate',
  )
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: firmSettingsId,
    attributeKindId: akId,
    value: rate,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: ctx.actorId,
  })

  return { firm_settings_id: firmSettingsId, rate }
})

// ───────────────────────────────────────────────────────────────────────────
// Online payments — Stripe Connect (migration 0113).
//
// The firm onboards as a Stripe Express CONNECTED ACCOUNT; what we remember on
// firm_settings is its public acct_… id plus two capability flags Stripe reports
// (charges_enabled, details_submitted). None of these are secrets — the platform
// keys are env vars. connect records/refreshes them; disconnect clears them so
// the firm stops accepting online payments (the account persists at Stripe).
// ───────────────────────────────────────────────────────────────────────────

// Append one attribute on the firm_settings singleton. knowabilityState lets a
// disconnect record a real "no value" (observed_null) rather than delete history.
async function writeFirmAttr(args: {
  client: DbClient
  tenantId: string
  actionId: string
  actorId: string
  firmSettingsId: string
  kind: string
  value: unknown
  knowabilityState?: string
}): Promise<void> {
  const akId = await lookupKindId(
    args.client,
    'attribute_kind_definition',
    args.tenantId,
    args.kind,
  )
  await insertAttribute(args.client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    entityId: args.firmSettingsId,
    attributeKindId: akId,
    value: args.value,
    confidence: 1.0,
    knowabilityState: args.knowabilityState ?? 'observed',
    sourceType: 'human',
    sourceRef: args.actorId,
  })
}

interface ConnectStripePayload {
  account_id?: string | null
  charges_enabled?: boolean | null
  details_submitted?: boolean | null
}

registerActionHandler('legal.firm.connect_stripe', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as ConnectStripePayload
  const firmSettingsId = await ensureFirmSettings(client, ctx.tenantId, actionId)
  const base = { client, tenantId: ctx.tenantId, actionId, actorId: ctx.actorId, firmSettingsId }

  // account_id is set at onboarding start; the capability flags arrive on each
  // refresh (return route + account.updated webhook). Only write what's provided.
  if (p.account_id !== undefined) {
    const acct = (p.account_id ?? '').toString().trim()
    await writeFirmAttr({
      ...base,
      kind: 'stripe_connected_account_id',
      value: acct || null,
      knowabilityState: acct ? 'observed' : 'observed_null',
    })
  }
  if (p.charges_enabled !== undefined && p.charges_enabled !== null) {
    await writeFirmAttr({ ...base, kind: 'stripe_charges_enabled', value: !!p.charges_enabled })
  }
  if (p.details_submitted !== undefined && p.details_submitted !== null) {
    await writeFirmAttr({ ...base, kind: 'stripe_details_submitted', value: !!p.details_submitted })
  }
  return { firm_settings_id: firmSettingsId }
})

registerActionHandler('legal.firm.disconnect_stripe', async (ctx, client, payload, actionId) => {
  void payload
  const firmSettingsId = await ensureFirmSettings(client, ctx.tenantId, actionId)
  const base = { client, tenantId: ctx.tenantId, actionId, actorId: ctx.actorId, firmSettingsId }
  // Clear the connection: account id → observed_null, capabilities → false.
  await writeFirmAttr({
    ...base,
    kind: 'stripe_connected_account_id',
    value: null,
    knowabilityState: 'observed_null',
  })
  await writeFirmAttr({ ...base, kind: 'stripe_charges_enabled', value: false })
  await writeFirmAttr({ ...base, kind: 'stripe_details_submitted', value: false })
  return { firm_settings_id: firmSettingsId }
})

// Manual payment methods — Zelle + crypto wallets (migration 0115). One JSON
// config attribute on the firm_settings singleton, same discipline as
// invoice_template_config below, except the shape is validated at the WRITE
// boundary too: these strings render on the client payment page, so nothing
// unbounded may be stored.
registerActionHandler(
  'legal.firm.set_manual_payment_methods',
  async (ctx, client, payload, actionId) => {
    const p = payload as unknown as { config?: Record<string, unknown> }
    const config = validateManualPaymentConfig(p.config)

    const firmSettingsId = await ensureFirmSettings(client, ctx.tenantId, actionId)
    const akId = await lookupKindId(
      client,
      'attribute_kind_definition',
      ctx.tenantId,
      'manual_payment_methods_config',
    )
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: firmSettingsId,
      attributeKindId: akId,
      value: config,
      confidence: 1.0,
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })
    return { firm_settings_id: firmSettingsId }
  },
)

// Bound + normalize the config at the write boundary. Length caps keep the
// client payment page honest; the wallet cap stops it becoming a wall of
// addresses. Wallets missing an address or currency are dropped, not stored.
function validateManualPaymentConfig(raw: unknown): Record<string, unknown> {
  const cfg = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const str = (v: unknown, label: string, max: number): string => {
    const s = typeof v === 'string' ? v.trim() : ''
    if (s.length > max) throw new Error(`${label} is too long (max ${max} characters).`)
    return s
  }

  let zelle: { recipient: string; recipientName: string } | null = null
  if (cfg.zelle && typeof cfg.zelle === 'object') {
    const z = cfg.zelle as Record<string, unknown>
    const recipient = str(z.recipient, 'Zelle recipient', 120)
    const recipientName = str(z.recipientName, 'Zelle recipient name', 80)
    if (recipient) zelle = { recipient, recipientName }
  }

  const walletsRaw = Array.isArray(cfg.wallets) ? cfg.wallets : []
  if (walletsRaw.length > 10) throw new Error('At most 10 crypto wallets can be configured.')
  const wallets = walletsRaw
    .map((w) => {
      const o = w && typeof w === 'object' ? (w as Record<string, unknown>) : {}
      return {
        label: str(o.label, 'Wallet label', 40),
        currency: str(o.currency, 'Wallet currency', 12).toUpperCase(),
        network: str(o.network, 'Wallet network', 60),
        address: str(o.address, 'Wallet address', 200),
      }
    })
    .filter((w) => w.address && w.currency)

  return { zelle, wallets }
}

// The firm's invoice template branding/content config (Phase 3). Stored as one
// JSON attribute on the firm_settings singleton; a new write supersedes the prior
// (append-only, effective-dated). The shape is validated/resolved on the read side
// (api/invoiceTemplate.ts) so a partial save still renders.
registerActionHandler('legal.firm.set_invoice_template', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as { config?: Record<string, unknown> }
  const config = p.config && typeof p.config === 'object' ? p.config : {}

  const firmSettingsId = await ensureFirmSettings(client, ctx.tenantId, actionId)
  const akId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'invoice_template_config',
  )
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: firmSettingsId,
    attributeKindId: akId,
    value: config,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: ctx.actorId,
  })
  return { firm_settings_id: firmSettingsId }
})
