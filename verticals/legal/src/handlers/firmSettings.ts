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
