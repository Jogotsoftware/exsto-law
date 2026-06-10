import { withActionContext, type ActionContext } from '@exsto/substrate'

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

export async function getTenantSettings(ctx: ActionContext): Promise<TenantSettings> {
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
