import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

export interface TenantSettings {
  firmName: string | null
  attorneyName: string | null
  firmEmail: string | null
  firmPhone: string | null
  firmAddress: string | null
  defaultHourlyRateUsd: number | null
  defaultLlcFlatFeeUsd: number | null
  updatedAt: string | null
}

const EMPTY: TenantSettings = {
  firmName: null,
  attorneyName: null,
  firmEmail: null,
  firmPhone: null,
  firmAddress: null,
  defaultHourlyRateUsd: null,
  defaultLlcFlatFeeUsd: null,
  updatedAt: null,
}

// Phase 0: the wedge-era tenant_settings table is not part of the certified
// foundation. Firm-settings editing arrives with the Phase 1 library layer
// (schema-as-data, not a bespoke table); until then reads degrade to defaults
// so Settings renders, and writes refuse loudly.
const FIRM_DEFAULTS: TenantSettings = {
  ...EMPTY,
  firmName: 'Pacheco Law Firm',
  attorneyName: 'Juan Carlos Pacheco',
}

// P13 — firm identity now lives the substrate-native way: firm_name /
// firm_address / firm_phone / firm_email attributes on the per-tenant
// firm_profile singleton (migration 0161), written through legal.firm.set_profile
// (handlers/firmProfile.ts). Reads here overlay the substrate value FIRST, then
// fall back to the wedge-era tenant_settings table for anything unset.
export interface FirmProfileFields {
  firmName: string | null
  firmAddress: string | null
  firmPhone: string | null
  firmEmail: string | null
}

const PROFILE_ATTR_KINDS = ['firm_name', 'firm_address', 'firm_phone', 'firm_email'] as const

// Tri-state per field, read off the firm_profile singleton:
//   string    — set to a value;
//   null      — an attribute row EXISTS with an empty value: the attorney
//               explicitly cleared it (legal.firm.set_profile stores '' on
//               clear). A cleared field must resolve to null — NEVER fall back
//               to the legacy table or a default, or the clear can never take;
//   undefined — no attribute row at all (never set) → fallback allowed.
interface FirmProfileAttrReads {
  firmName: string | null | undefined
  firmAddress: string | null | undefined
  firmPhone: string | null | undefined
  firmEmail: string | null | undefined
}

// Latest firm-identity attributes off the firm_profile singleton (all undefined
// when no singleton / no rows yet). Mirrors api/firmSignature.readStored.
async function readFirmProfileAttrs(ctx: ActionContext): Promise<FirmProfileAttrReads> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ kind_name: string; value: string | null }>(
      `WITH fp AS (
         SELECT e.id
           FROM entity e
           JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
          WHERE e.tenant_id = $1 AND ekd.kind_name = 'firm_profile' AND e.status = 'active'
          ORDER BY e.recorded_at ASC
          LIMIT 1
       )
       SELECT DISTINCT ON (akd.kind_name) akd.kind_name, a.value #>> '{}' AS value
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
        WHERE a.tenant_id = $1 AND a.entity_id = (SELECT id FROM fp)
          AND akd.kind_name = ANY($2)
          AND (a.valid_to IS NULL OR a.valid_to > now())
        ORDER BY akd.kind_name, a.valid_from DESC`,
      [ctx.tenantId, [...PROFILE_ATTR_KINDS]],
    )
    const byKind = new Map(res.rows.map((r) => [r.kind_name, r.value]))
    const val = (kind: string): string | null | undefined => {
      if (!byKind.has(kind)) return undefined // never set → fallback allowed
      const v = byKind.get(kind)
      return typeof v === 'string' && v.trim() ? v : null // row with '' = explicit clear
    }
    return {
      firmName: val('firm_name'),
      firmAddress: val('firm_address'),
      firmPhone: val('firm_phone'),
      firmEmail: val('firm_email'),
    }
  })
}

// Substrate profile value wins; an EXPLICIT CLEAR stays cleared (resolves null,
// no legacy/default resurrection); a legacy table value survives only where the
// profile has never been set (append-only history stays on the substrate side).
function overlayProfile(base: TenantSettings, profile: FirmProfileAttrReads): TenantSettings {
  const field = (p: string | null | undefined, b: string | null): string | null =>
    p === undefined ? b : p
  return {
    ...base,
    firmName: field(profile.firmName, base.firmName),
    firmAddress: field(profile.firmAddress, base.firmAddress),
    firmPhone: field(profile.firmPhone, base.firmPhone),
    firmEmail: field(profile.firmEmail, base.firmEmail),
  }
}

export async function getTenantSettings(ctx: ActionContext): Promise<TenantSettings> {
  const profile = await readFirmProfileAttrs(ctx)
  try {
    return overlayProfile(await readTenantSettings(ctx), profile)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('tenant_settings') || msg.includes('does not exist')) {
      return overlayProfile(FIRM_DEFAULTS, profile)
    }
    throw err
  }
}

// For DOCUMENT MERGE only: degrade to EMPTY (unknown), never to FIRM_DEFAULTS.
// The Settings-page fallback above exists so the UI renders in a wedge-era
// environment; but a generated legal document that fills {{firm_name}} with the
// demo firm's identity for some OTHER tenant is a forgery the reviewing attorney
// gets no [[MISSING]] warning about. Unknown must render as MISSING — the
// substrate distinguishes "we don't know" from "we know a default".
// P13 NOTE: the firm_profile overlay above applies here too, but the anti-forgery
// guard MUST survive — when neither the substrate singleton nor the legacy table
// has a value, the answer is EMPTY (honest MISSING), never a demo-firm default.
export async function getTenantSettingsForMerge(ctx: ActionContext): Promise<TenantSettings> {
  const profile = await readFirmProfileAttrs(ctx)
  try {
    return overlayProfile(await readTenantSettings(ctx), profile)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('tenant_settings') || msg.includes('does not exist')) {
      return overlayProfile(EMPTY, profile)
    }
    throw err
  }
}

// The resolved firm profile for the Settings editor / MCP get tool: substrate
// singleton first, legacy tenant_settings fallback. Same values getTenantSettings
// reports for these four fields.
export async function getFirmProfile(ctx: ActionContext): Promise<FirmProfileFields> {
  const s = await getTenantSettings(ctx)
  return {
    firmName: s.firmName,
    firmAddress: s.firmAddress,
    firmPhone: s.firmPhone,
    firmEmail: s.firmEmail,
  }
}

export interface SetFirmProfileInput {
  // undefined leaves a field unchanged; ''/null clears it.
  firmName?: string | null
  firmAddress?: string | null
  firmPhone?: string | null
  firmEmail?: string | null
}

// Write the firm profile through the core (legal.firm.set_profile — append-only
// attribute supersede on the firm_profile singleton). Returns the fresh resolved
// profile so the editor can re-render without a second read.
export async function setFirmProfile(
  ctx: ActionContext,
  input: SetFirmProfileInput,
): Promise<FirmProfileFields> {
  await submitAction(ctx, {
    actionKindName: 'legal.firm.set_profile',
    intentKind: 'adjustment',
    payload: {
      ...(input.firmName !== undefined ? { firm_name: input.firmName } : {}),
      ...(input.firmAddress !== undefined ? { firm_address: input.firmAddress } : {}),
      ...(input.firmPhone !== undefined ? { firm_phone: input.firmPhone } : {}),
      ...(input.firmEmail !== undefined ? { firm_email: input.firmEmail } : {}),
    },
  })
  return getFirmProfile(ctx)
}

async function readTenantSettings(ctx: ActionContext): Promise<TenantSettings> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      firm_name: string | null
      attorney_name: string | null
      firm_email: string | null
      firm_phone: string | null
      firm_address: string | null
      default_hourly_rate_usd: string | null
      default_llc_flat_fee_usd: string | null
      updated_at: Date
    }>(
      `SELECT firm_name, attorney_name, firm_email, firm_phone, firm_address,
              default_hourly_rate_usd, default_llc_flat_fee_usd, updated_at
       FROM tenant_settings WHERE tenant_id = $1`,
      [ctx.tenantId],
    )
    const r = res.rows[0]
    if (!r) return EMPTY
    return {
      firmName: r.firm_name,
      attorneyName: r.attorney_name,
      firmEmail: r.firm_email,
      firmPhone: r.firm_phone,
      firmAddress: r.firm_address,
      defaultHourlyRateUsd:
        r.default_hourly_rate_usd != null ? Number(r.default_hourly_rate_usd) : null,
      defaultLlcFlatFeeUsd:
        r.default_llc_flat_fee_usd != null ? Number(r.default_llc_flat_fee_usd) : null,
      updatedAt: r.updated_at.toISOString(),
    }
  })
}

export interface UpdateTenantSettingsInput {
  firmName?: string | null
  attorneyName?: string | null
  firmEmail?: string | null
  firmPhone?: string | null
  firmAddress?: string | null
  defaultHourlyRateUsd?: number | null
  defaultLlcFlatFeeUsd?: number | null
}

export async function updateTenantSettings(
  ctx: ActionContext,
  input: UpdateTenantSettingsInput,
): Promise<TenantSettings> {
  throw new Error(
    'Firm settings editing arrives with the Phase 1 library layer (settings become substrate configuration, not a bespoke table).',
  )
  return withActionContext(ctx, async (client) => {
    await client.query(
      `INSERT INTO tenant_settings (
         tenant_id, firm_name, attorney_name, firm_email, firm_phone, firm_address,
         default_hourly_rate_usd, default_llc_flat_fee_usd, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         firm_name = COALESCE(EXCLUDED.firm_name, tenant_settings.firm_name),
         attorney_name = COALESCE(EXCLUDED.attorney_name, tenant_settings.attorney_name),
         firm_email = COALESCE(EXCLUDED.firm_email, tenant_settings.firm_email),
         firm_phone = COALESCE(EXCLUDED.firm_phone, tenant_settings.firm_phone),
         firm_address = COALESCE(EXCLUDED.firm_address, tenant_settings.firm_address),
         default_hourly_rate_usd = COALESCE(EXCLUDED.default_hourly_rate_usd, tenant_settings.default_hourly_rate_usd),
         default_llc_flat_fee_usd = COALESCE(EXCLUDED.default_llc_flat_fee_usd, tenant_settings.default_llc_flat_fee_usd),
         updated_at = now()`,
      [
        ctx.tenantId,
        input.firmName ?? null,
        input.attorneyName ?? null,
        input.firmEmail ?? null,
        input.firmPhone ?? null,
        input.firmAddress ?? null,
        input.defaultHourlyRateUsd ?? null,
        input.defaultLlcFlatFeeUsd ?? null,
      ],
    )
    return getTenantSettings(ctx)
  })
}
