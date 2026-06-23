// Module control-plane operations (ADR 0046 §5). The admin reads the MASTER
// catalog in the platform context, and enables/disables a module for a TARGET
// tenant by impersonating that tenant (buildTargetContext + submitAction) so the
// install is an audited action in the target. A firm-facing read
// (listEnabledModulesForCaller) lets the attorney app gate its nav.
import { submitAction, executeQuery, type ActionContext } from '@exsto/substrate'
import { assertPlatformAdmin, buildTargetContext, recordControlPlaneAction } from './context.js'

export interface ModuleCatalogEntry {
  moduleKey: string
  displayName: string
  description: string | null
  uiAreas: string[]
  requires: Record<string, unknown>
  dependsOn: string[]
}

export interface TenantModuleState extends ModuleCatalogEntry {
  enabled: boolean
}

// The master catalog, read in the caller's tenant (the admin's platform tenant).
export async function listCatalog(ctx: ActionContext): Promise<ModuleCatalogEntry[]> {
  await assertPlatformAdmin(ctx)
  const r = await executeQuery<{
    module_key: string
    display_name: string
    description: string | null
    ui_areas: string[]
    requires: Record<string, unknown>
    depends_on: string[]
  }>(
    ctx,
    `SELECT module_key, display_name, description, ui_areas, requires, depends_on
       FROM module_definition
      WHERE tenant_id = $1 AND valid_to IS NULL AND status = 'active'
      ORDER BY display_name`,
    [ctx.tenantId],
  )
  return r.rows.map(toCatalogEntry)
}

function toCatalogEntry(row: {
  module_key: string
  display_name: string
  description: string | null
  ui_areas: unknown
  requires: unknown
  depends_on: unknown
}): ModuleCatalogEntry {
  return {
    moduleKey: row.module_key,
    displayName: row.display_name,
    description: row.description,
    uiAreas: Array.isArray(row.ui_areas) ? (row.ui_areas as string[]) : [],
    requires: (row.requires as Record<string, unknown>) ?? {},
    dependsOn: Array.isArray(row.depends_on) ? (row.depends_on as string[]) : [],
  }
}

// The catalog joined with one target tenant's enablement (admin matrix for a
// selected tenant). Catalog is read in the platform context; enablement in the
// target context.
export async function tenantModuleStates(
  ctx: ActionContext,
  targetTenantId: string,
): Promise<TenantModuleState[]> {
  const catalog = await listCatalog(ctx)
  const target = await buildTargetContext(ctx, targetTenantId)
  const enabled = await executeQuery<{ module_key: string; enabled: boolean }>(
    target,
    `SELECT module_key, enabled FROM module_enablement WHERE tenant_id = $1`,
    [targetTenantId],
  )
  const byKey = new Map(enabled.rows.map((e) => [e.module_key, e.enabled]))
  return catalog.map((m) => ({ ...m, enabled: byKey.get(m.moduleKey) ?? false }))
}

// Enable a module for a target tenant. Reads the module's manifest + ui_areas
// from the platform catalog, installs any manifest permission scopes through the
// target's action layer, then records the enablement (audited) and a
// control-plane action.
export async function enableModule(
  ctx: ActionContext,
  input: { tenantId: string; moduleKey: string },
): Promise<{ ok: true }> {
  await assertPlatformAdmin(ctx)
  const catalog = await listCatalog(ctx)
  const mod = catalog.find((m) => m.moduleKey === input.moduleKey)
  if (!mod) throw new Error(`Unknown module: ${input.moduleKey}`)

  const target = await buildTargetContext(ctx, input.tenantId)

  // Install any permission scopes the module declares (legal modules pre-exist,
  // so this is usually empty; promotion is what carries genuinely-new scopes).
  const scopes = Array.isArray((mod.requires as { scopes?: unknown[] }).scopes)
    ? ((mod.requires as { scopes?: Record<string, unknown>[] }).scopes ?? [])
    : []
  for (const scope of scopes) {
    await submitAction(target, {
      actionKindName: 'permission_scope.define',
      intentKind: 'enforcement',
      payload: scope,
    })
  }

  // Record enablement (the audited marker; carries ui_areas for firm-side gating).
  await submitAction(target, {
    actionKindName: 'legal.module.enable',
    intentKind: 'enforcement',
    payload: { module_key: mod.moduleKey, manifest: { ...mod.requires, ui_areas: mod.uiAreas } },
  })
  await recordControlPlaneAction(ctx, 'module.enable', input.tenantId, { moduleKey: mod.moduleKey })
  return { ok: true }
}

export async function disableModule(
  ctx: ActionContext,
  input: { tenantId: string; moduleKey: string },
): Promise<{ ok: true }> {
  await assertPlatformAdmin(ctx)
  const target = await buildTargetContext(ctx, input.tenantId)
  await submitAction(target, {
    actionKindName: 'legal.module.disable',
    intentKind: 'enforcement',
    payload: { module_key: input.moduleKey },
  })
  await recordControlPlaneAction(ctx, 'module.disable', input.tenantId, {
    moduleKey: input.moduleKey,
  })
  return { ok: true }
}

// FIRM-FACING (not admin): the module_keys EXPLICITLY DISABLED for the calling
// tenant, for the attorney app to gate its nav. RLS-scoped to ctx.tenant; no
// platform gate. Modules are opt-OUT: "no row" means enabled (a fresh firm has
// every feature), so gating keys off the explicit enabled=false rows ONLY. The
// app maps these keys to nav areas (it owns that mapping) and hides exactly them
// — so enabling/disabling one module never affects any other module's UI.
export async function listDisabledModulesForCaller(
  ctx: ActionContext,
): Promise<{ disabledModuleKeys: string[] }> {
  const r = await executeQuery<{ module_key: string }>(
    ctx,
    `SELECT module_key FROM module_enablement WHERE tenant_id = $1 AND enabled = false`,
    [ctx.tenantId],
  )
  return { disabledModuleKeys: r.rows.map((row) => row.module_key) }
}
