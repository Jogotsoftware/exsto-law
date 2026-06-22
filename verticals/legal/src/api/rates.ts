// Contract K (Session 7) — billing rates, the SINGLE SOURCE OF TRUTH.
//
// Three rate scopes, each with one substrate-native home. Contract K is the only
// reader/writer the rest of the app goes through, so a rate edited anywhere — the
// client page (S2's inline editor), the service page, the Rates tab — resolves to
// the identical value everywhere, because they all read/write the same fact:
//
//   • per-client hourly  → client_billable_rate attribute on the client entity
//                           (migration 0020). set via legal.client.update.
//   • per-service fee     → fixed_fee key in the service's workflow_definition
//                           config (services ARE workflow_definition rows).
//                           set via legal.service.upsert (transitions_patch).
//   • firm default hourly → firm_default_hourly_rate on the singleton
//                           firm_settings entity (migration 0065). set via
//                           legal.firm.set_default_rate.
//
// Effective-dating is native: every write is an append-only attribute row (or a
// new immutable workflow_definition version), so "current rate = latest" and the
// prior rate stays in history. Money is DECIMAL STRINGS (ADR 0044) end to end —
// reads return the stored string, writes validate it, nothing is ever a float.
//
// Writes go THROUGH THE CORE via submitAction (vertical CLAUDE.md). Reads use
// withActionContext, tenant-scoped, latest-valid_from (exsto-query-substrate).
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

// A decimal-string money value (ADR 0044). Mirrors the handler guard.
const MONEY_RE = /^-?\d+(\.\d+)?$/

function assertMoney(label: string, value: string): string {
  const v = (value ?? '').trim()
  if (!MONEY_RE.test(v)) {
    throw new Error(
      `${label} must be a decimal string (ADR 0044), e.g. "350.00"; got ${JSON.stringify(value)}.`,
    )
  }
  return v
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** The firm-wide fallback hourly rate, or null if never set. */
export async function getFirmDefaultRate(ctx: ActionContext): Promise<string | null> {
  return withActionContext(ctx, async (client) => readFirmDefault(client, ctx.tenantId))
}

/**
 * A client's effective hourly rate: the explicit client_billable_rate if set,
 * otherwise the firm default. This is the fallback the invoice rollup needs and
 * the value the Rates tab shows in the "(firm default)" column.
 */
export async function getClientRate(
  ctx: ActionContext,
  clientEntityId: string,
): Promise<string | null> {
  return withActionContext(ctx, async (client) => {
    const own = await readClientOwnRate(client, ctx.tenantId, clientEntityId)
    if (own != null) return own
    return readFirmDefault(client, ctx.tenantId)
  })
}

/** A service's fixed fee (its workflow_definition fixed_fee), or null if unpriced. */
export async function getServiceRate(
  ctx: ActionContext,
  serviceKey: string,
): Promise<string | null> {
  return withActionContext(ctx, async (client) => readServiceFee(client, ctx.tenantId, serviceKey))
}

// ── Writes (through the core) ─────────────────────────────────────────────────

export async function setFirmDefaultRate(
  ctx: ActionContext,
  rate: string,
): Promise<{ rate: string }> {
  const r = assertMoney('firm default rate', rate)
  await submitAction(ctx, {
    actionKindName: 'legal.firm.set_default_rate',
    intentKind: 'adjustment',
    payload: { rate: r },
  })
  return { rate: r }
}

/** Set a client's billable rate. Routes through legal.client.update so the rate
 *  has exactly one writer. (legal.client.update treats null as "leave unchanged",
 *  so this path sets a value; a future clear-rate needs a handler change.) */
export async function setClientRate(
  ctx: ActionContext,
  clientEntityId: string,
  rate: string,
): Promise<{ rate: string }> {
  const r = assertMoney('client rate', rate)
  await submitAction(ctx, {
    actionKindName: 'legal.client.update',
    intentKind: 'adjustment',
    payload: { client_entity_id: clientEntityId, billable_rate: r },
  })
  return { rate: r }
}

/** Set a service's fixed fee. Routes through legal.service.upsert, preserving the
 *  service's other config (the handler merges transitions_patch over the prior
 *  version). Writes the CANONICAL home — transitions.cost {type:'fixed'} — so the
 *  Rates tab, the service editor, and the service-fee accrual all read one source
 *  (the legacy transitions.fixed_fee is still read as a fallback on the way in). */
export async function setServiceRate(
  ctx: ActionContext,
  serviceKey: string,
  fixedFee: string,
): Promise<{ fixedFee: string }> {
  const fee = assertMoney('service fee', fixedFee)
  const displayName = await withActionContext(ctx, async (client) => {
    const res = await client.query<{ display_name: string }>(
      `SELECT display_name FROM workflow_definition
        WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL
        ORDER BY version DESC LIMIT 1`,
      [ctx.tenantId, serviceKey],
    )
    if (!res.rows[0]) throw new Error(`Service not found: ${serviceKey}`)
    return res.rows[0].display_name
  })
  await submitAction(ctx, {
    actionKindName: 'legal.service.upsert',
    intentKind: 'adjustment',
    payload: {
      service_key: serviceKey,
      display_name: displayName,
      transitions_patch: { cost: { type: 'fixed', amount: fee, hours: null } },
    },
  })
  return { fixedFee: fee }
}

// ── Rates tab view (Clients + Services sub-tabs) ──────────────────────────────

export interface ClientRateRow {
  clientEntityId: string
  name: string
  /** The client's explicit rate, or null when it inherits the firm default. */
  ownRate: string | null
  /** The rate that actually applies = ownRate ?? firmDefault. */
  effectiveRate: string | null
  inheritsFirmDefault: boolean
}

export interface ServiceRateRow {
  serviceKey: string
  displayName: string
  fixedFee: string | null
  // Per-document-kind flat fees configured on the service (read-only here; edited
  // on the service's Billing tab). { [document_kind]: decimal-string }.
  documentFees: Record<string, string>
}

export interface RatesView {
  firmDefaultRate: string | null
  clients: ClientRateRow[]
  services: ServiceRateRow[]
}

/** Everything the Rates tab renders, resolved through the one source. */
export async function getRatesView(ctx: ActionContext): Promise<RatesView> {
  return withActionContext(ctx, async (client) => {
    const firmDefaultRate = await readFirmDefault(client, ctx.tenantId)

    const clientRows = await client.query<{ id: string; name: string; rate: string | null }>(
      `WITH attrs AS (
         SELECT DISTINCT ON (a.entity_id, akd.kind_name)
                a.entity_id, akd.kind_name, a.value
           FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
          WHERE a.tenant_id = $1 AND akd.kind_name = 'client_billable_rate'
          ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
       )
       SELECT e.id, e.name,
              (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id) AS rate
         FROM entity e
         JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
        WHERE e.tenant_id = $1 AND ekd.kind_name = 'client' AND e.status = 'active'
        ORDER BY e.name`,
      [ctx.tenantId],
    )
    const clients: ClientRateRow[] = clientRows.rows.map((r) => ({
      clientEntityId: r.id,
      name: r.name,
      ownRate: r.rate,
      effectiveRate: r.rate ?? firmDefaultRate,
      inheritsFirmDefault: r.rate == null,
    }))

    const serviceRows = await client.query<{
      kind_name: string
      display_name: string
      cost: { type?: string; amount?: string } | null
      fixed_fee: string | null
      document_fees: Record<string, string> | null
    }>(
      `SELECT kind_name, display_name,
              transitions -> 'cost'           AS cost,
              transitions ->> 'fixed_fee'     AS fixed_fee,
              transitions -> 'document_fees'  AS document_fees
         FROM workflow_definition
        WHERE tenant_id = $1 AND valid_to IS NULL
        ORDER BY display_name`,
      [ctx.tenantId],
    )
    const services: ServiceRateRow[] = serviceRows.rows.map((r) => {
      // One source of truth: a fixed cost.amount is the fee; legacy fixed_fee is a
      // read fallback for rows written before the convention was unified.
      const fromCost = r.cost && r.cost.type === 'fixed' && r.cost.amount ? r.cost.amount : null
      const docFees: Record<string, string> = {}
      if (r.document_fees && typeof r.document_fees === 'object') {
        for (const [k, v] of Object.entries(r.document_fees)) {
          if (typeof v === 'string') docFees[k] = v
        }
      }
      return {
        serviceKey: r.kind_name,
        displayName: r.display_name,
        fixedFee: fromCost ?? r.fixed_fee,
        documentFees: docFees,
      }
    })

    return { firmDefaultRate, clients, services }
  })
}

// ── shared read helpers (one connection) ──────────────────────────────────────

export async function readFirmDefault(
  client: import('@exsto/shared').DbClient,
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
      ORDER BY a.valid_from DESC
      LIMIT 1`,
    [tenantId],
  )
  return res.rows[0]?.rate ?? null
}

async function readClientOwnRate(
  client: import('@exsto/shared').DbClient,
  tenantId: string,
  clientEntityId: string,
): Promise<string | null> {
  const res = await client.query<{ rate: string | null }>(
    `SELECT a.value #>> '{}' AS rate
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
      WHERE a.tenant_id = $1 AND a.entity_id = $2::uuid
        AND akd.kind_name = 'client_billable_rate'
      ORDER BY a.valid_from DESC
      LIMIT 1`,
    [tenantId, clientEntityId],
  )
  return res.rows[0]?.rate ?? null
}

async function readServiceFee(
  client: import('@exsto/shared').DbClient,
  tenantId: string,
  serviceKey: string,
): Promise<string | null> {
  const res = await client.query<{ fixed_fee: string | null }>(
    `SELECT transitions ->> 'fixed_fee' AS fixed_fee
       FROM workflow_definition
      WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL
      ORDER BY version DESC LIMIT 1`,
    [tenantId, serviceKey],
  )
  return res.rows[0]?.fixed_fee ?? null
}
