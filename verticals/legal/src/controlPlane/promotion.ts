// Service promotion (ADR 0046 §6): copy a service (workflow_definition) built in
// the sandbox to one or more production tenants — by REPLAY through each target's
// submitAction('workflow.define'), never a cross-tenant SQL copy. Idempotent on
// the stable kind_name; each promotion lands a NEW version in the target (so
// in-flight instances stay bound to their started version — invariant 17). A
// dry-run diff precedes any write. Services reference entity kinds by NAME, so
// they promote without UUID remapping.
import { submitAction, type ActionContext } from '@exsto/substrate'
import { withAppRole } from '@exsto/shared'
import {
  assertPlatformAdmin,
  buildTargetContext,
  recordControlPlaneAction,
  SANDBOX_TENANT_ID,
  PLATFORM_TENANT_ID,
} from './context.js'

export interface ServiceDef {
  kindName: string
  displayName: string
  description: string | null
  states: unknown[]
  transitions: unknown
  participatingEntityKinds: unknown[]
  version: number
}

interface RawWorkflow {
  kind_name: string
  display_name: string
  description: string | null
  states: unknown[]
  transitions: unknown
  participating_entity_kinds: unknown[]
  version: number
}

function toServiceDef(r: RawWorkflow): ServiceDef {
  return {
    kindName: r.kind_name,
    displayName: r.display_name,
    description: r.description,
    states: Array.isArray(r.states) ? r.states : [],
    transitions: r.transitions ?? [],
    participatingEntityKinds: Array.isArray(r.participating_entity_kinds)
      ? r.participating_entity_kinds
      : [],
    version: r.version,
  }
}

async function listWorkflows(platformActorId: string, tenantId: string): Promise<ServiceDef[]> {
  return withAppRole(async (client) => {
    const r = await client.query<RawWorkflow>(`SELECT * FROM private.cp_list_workflows($1, $2)`, [
      platformActorId,
      tenantId,
    ])
    return r.rows.map(toServiceDef)
  })
}

// The services available to promote FROM a source tenant (default: the sandbox).
export async function listPromotableServices(
  ctx: ActionContext,
  sourceTenantId: string = SANDBOX_TENANT_ID,
): Promise<ServiceDef[]> {
  await assertPlatformAdmin(ctx)
  return listWorkflows(ctx.actorId, sourceTenantId)
}

export type DiffStatus = 'new' | 'changed' | 'identical'

export interface ServiceDiff {
  kindName: string
  displayName: string
  status: DiffStatus
  sourceVersion: number
  targetVersion: number | null
}

function shape(s: ServiceDef): string {
  return JSON.stringify([
    s.states,
    s.transitions,
    s.participatingEntityKinds,
    s.displayName,
    s.description,
  ])
}

// Dry-run: classify each source service against the target (new/changed/identical).
export async function diffServices(
  ctx: ActionContext,
  sourceTenantId: string,
  targetTenantId: string,
): Promise<ServiceDiff[]> {
  await assertPlatformAdmin(ctx)
  const [source, target] = await Promise.all([
    listWorkflows(ctx.actorId, sourceTenantId),
    listWorkflows(ctx.actorId, targetTenantId),
  ])
  const targetByName = new Map(target.map((t) => [t.kindName, t]))
  await recordControlPlaneAction(ctx, 'promote.dryrun', targetTenantId, {
    sourceTenantId,
    serviceCount: source.length,
  })
  return source.map((s) => {
    const t = targetByName.get(s.kindName)
    const status: DiffStatus = !t ? 'new' : shape(s) === shape(t) ? 'identical' : 'changed'
    return {
      kindName: s.kindName,
      displayName: s.displayName,
      status,
      sourceVersion: s.version,
      targetVersion: t?.version ?? null,
    }
  })
}

export interface PromoteResult {
  targetTenantId: string
  promoted: string[]
  skipped: string[]
}

// Promote selected services from source to one or more targets. Each promoted
// service is re-submitted through the TARGET's submitAction('workflow.define')
// with version = target's current max + 1.
export async function promoteServices(
  ctx: ActionContext,
  input: { sourceTenantId?: string; targetTenantIds: string[]; kindNames: string[] },
): Promise<PromoteResult[]> {
  await assertPlatformAdmin(ctx)
  const sourceTenantId = input.sourceTenantId ?? SANDBOX_TENANT_ID
  if (!input.targetTenantIds?.length) throw new Error('At least one target tenant is required.')
  if (!input.kindNames?.length) throw new Error('At least one service is required.')

  // Validate ALL targets BEFORE any write, so an illegal target can never leave a
  // partial, already-committed promotion behind (de-dupe too).
  const targetTenantIds = [...new Set(input.targetTenantIds)]
  for (const t of targetTenantIds) {
    if (t === PLATFORM_TENANT_ID) throw new Error('The platform tenant is not a promotion target.')
    if (t === sourceTenantId) throw new Error('A tenant cannot promote to itself.')
  }

  const source = await listWorkflows(ctx.actorId, sourceTenantId)
  const selected = source.filter((s) => input.kindNames.includes(s.kindName))
  if (selected.length === 0) throw new Error('None of the selected services exist in the source.')

  const results: PromoteResult[] = []
  for (const targetTenantId of targetTenantIds) {
    const target = await buildTargetContext(ctx, targetTenantId)
    const existing = await listWorkflows(ctx.actorId, targetTenantId)
    const existingByName = new Map(existing.map((e) => [e.kindName, e]))
    const promoted: string[] = []
    const skipped: string[] = []
    for (const svc of selected) {
      const cur = existingByName.get(svc.kindName)
      // Idempotent: an identical service is skipped (no needless version bump) —
      // this matches the diff/UI semantics for direct MCP/REST callers too.
      if (cur && shape(svc) === shape(cur)) {
        skipped.push(svc.kindName)
        continue
      }
      const nextVersion = (cur?.version ?? 0) + 1
      await submitAction(target, {
        actionKindName: 'workflow.define',
        intentKind: 'adjustment',
        payload: {
          kind_name: svc.kindName,
          display_name: svc.displayName,
          description: svc.description ?? undefined,
          states: svc.states,
          transitions: svc.transitions,
          participating_entity_kinds: svc.participatingEntityKinds,
          version: nextVersion,
        },
      })
      promoted.push(svc.kindName)
    }
    await recordControlPlaneAction(ctx, 'promote.run', targetTenantId, {
      sourceTenantId,
      promoted,
      skipped,
    })
    results.push({ targetTenantId, promoted, skipped })
  }
  return results
}
