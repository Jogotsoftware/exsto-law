// Tenant control-plane operations (ADR 0046): list/get the registry, bootstrap a
// new tenant, change a tenant's status, and read the control-plane audit log.
// Reads go through the guarded private.cp_* functions (cross-tenant, but each
// self-guards on is_platform_admin); writes additionally record a
// control_plane_action audit row. NO substrate state tables are touched here.
import { randomUUID } from 'crypto'
import { withAppRole } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'
import {
  assertPlatformAdmin,
  recordControlPlaneAction,
  PLATFORM_TENANT_ID,
  SANDBOX_TENANT_ID,
} from './context.js'

export interface TenantSummary {
  id: string
  name: string
  status: string
  createdAt: string
  reserved: boolean // platform/sandbox infrastructure tenant (not an ordinary firm)
}

export interface TenantDetail extends TenantSummary {
  actorCount: number
  humanCount: number
}

function classify(id: string): boolean {
  return id === PLATFORM_TENANT_ID || id === SANDBOX_TENANT_ID
}

// The full tenant registry (platform admins only). Reserved infra tenants are
// flagged, not hidden, so the operator can see the platform/sandbox tenants too.
export async function listTenants(ctx: ActionContext): Promise<TenantSummary[]> {
  await assertPlatformAdmin(ctx)
  const rows = await withAppRole(async (client) => {
    const r = await client.query<{
      id: string
      name: string
      status: string
      created_at: string
    }>(`SELECT * FROM private.cp_list_tenants($1)`, [ctx.actorId])
    return r.rows
  })
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    createdAt: t.created_at,
    reserved: classify(t.id),
  }))
}

export async function getTenant(
  ctx: ActionContext,
  tenantId: string,
): Promise<TenantDetail | null> {
  await assertPlatformAdmin(ctx)
  const row = await withAppRole(async (client) => {
    const r = await client.query<{
      id: string
      name: string
      status: string
      created_at: string
      actor_count: string
      human_count: string
    }>(`SELECT * FROM private.cp_get_tenant($1, $2)`, [ctx.actorId, tenantId])
    return r.rows[0] ?? null
  })
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    actorCount: Number(row.actor_count),
    humanCount: Number(row.human_count),
    reserved: classify(row.id),
  }
}

export interface BootstrapTenantInput {
  name: string
  ownerEmail: string
  ownerDisplayName?: string
}

// Stand up a new tenant the substrate way (tenant -> actors -> cloned core kind
// registries -> RBAC + owner role), via the guarded private.cp_bootstrap_tenant.
// The new tenant id is generated here so the audit records exactly what was made.
export async function bootstrapTenant(
  ctx: ActionContext,
  input: BootstrapTenantInput,
): Promise<{ tenantId: string; ownerActorId: string }> {
  await assertPlatformAdmin(ctx)
  const name = (input.name ?? '').trim()
  const ownerEmail = (input.ownerEmail ?? '').trim()
  if (!name) throw new Error('Tenant name is required.')
  if (!ownerEmail || !ownerEmail.includes('@')) {
    throw new Error('A valid owner email is required (the firm owner signs in with it).')
  }
  const tenantId = randomUUID()
  const ownerActorId = await withAppRole(async (client) => {
    const r = await client.query<{ id: string }>(
      `SELECT private.cp_bootstrap_tenant($1, $2, $3, $4, $5) AS id`,
      [ctx.actorId, tenantId, name, ownerEmail, input.ownerDisplayName ?? null],
    )
    return r.rows[0]?.id ?? null
  })
  if (!ownerActorId) throw new Error('Tenant bootstrap failed.')
  await recordControlPlaneAction(
    ctx,
    'tenant.bootstrap',
    tenantId,
    { name, ownerEmail, ownerDisplayName: input.ownerDisplayName ?? null },
    { tenantId, ownerActorId },
  )
  return { tenantId, ownerActorId }
}

const VALID_STATUSES = new Set(['active', 'suspended', 'archived'])

export async function setTenantStatus(
  ctx: ActionContext,
  input: { tenantId: string; status: string },
): Promise<{ ok: true }> {
  await assertPlatformAdmin(ctx)
  if (!VALID_STATUSES.has(input.status)) {
    throw new Error(`Invalid status: ${input.status}`)
  }
  if (input.tenantId === PLATFORM_TENANT_ID) {
    throw new Error('The platform tenant cannot change status.')
  }
  await withAppRole(async (client) => {
    await client.query(`SELECT private.cp_set_tenant_status($1, $2, $3)`, [
      ctx.actorId,
      input.tenantId,
      input.status,
    ])
  })
  await recordControlPlaneAction(ctx, 'tenant.set_status', input.tenantId, {
    status: input.status,
  })
  return { ok: true }
}

export interface TenantOwner {
  actorId: string
  displayName: string
  email: string | null
}

// Resolve a tenant's owner human actor (private.cp_tenant_owner). Used by the
// admin console's "Enter sandbox" to mint an attorney session for the sandbox
// owner — the only way into the sandbox workspace (it is excluded from firm
// Google sign-in). Guarded: platform admins only.
export async function resolveTenantOwner(
  ctx: ActionContext,
  tenantId: string,
): Promise<TenantOwner | null> {
  await assertPlatformAdmin(ctx)
  return withAppRole(async (client) => {
    const r = await client.query<{ actor_id: string; display_name: string; email: string | null }>(
      `SELECT * FROM private.cp_tenant_owner($1, $2)`,
      [ctx.actorId, tenantId],
    )
    const row = r.rows[0]
    if (!row) return null
    return { actorId: row.actor_id, displayName: row.display_name, email: row.email }
  })
}

export interface ControlPlaneAuditEntry {
  id: string
  platformActorId: string
  operation: string
  targetTenantId: string | null
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  recordedAt: string
}

export async function controlPlaneAuditLog(
  ctx: ActionContext,
  limit = 100,
): Promise<ControlPlaneAuditEntry[]> {
  await assertPlatformAdmin(ctx)
  const rows = await withAppRole(async (client) => {
    const r = await client.query<{
      id: string
      platform_actor_id: string
      operation: string
      target_tenant_id: string | null
      payload: Record<string, unknown>
      result: Record<string, unknown> | null
      recorded_at: string
    }>(`SELECT * FROM private.cp_audit_log($1, $2)`, [ctx.actorId, limit])
    return r.rows
  })
  return rows.map((r) => ({
    id: r.id,
    platformActorId: r.platform_actor_id,
    operation: r.operation,
    targetTenantId: r.target_tenant_id,
    payload: r.payload,
    result: r.result,
    recordedAt: r.recorded_at,
  }))
}
