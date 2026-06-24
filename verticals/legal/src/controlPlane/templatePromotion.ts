// Template-library promotion (ADR 0046 §6): copy the firm's standalone
// document/email TEMPLATE library from the sandbox to production tenants by REPLAY
// through the target's submitAction(legal.template.create / legal.template.update)
// — never a cross-tenant SQL copy. Idempotent on the stable (category, name) key:
// an identical template is skipped, a changed one updates the target's existing
// template (by name), a new one is created. A template entity holds no outbound
// UUID refs, so it promotes standalone with no remap. Mirrors promotion.ts.
import { submitAction, type ActionContext } from '@exsto/substrate'
import { withAppRole } from '@exsto/shared'
import {
  assertPlatformAdmin,
  buildTargetContext,
  recordControlPlaneAction,
  SANDBOX_TENANT_ID,
  PLATFORM_TENANT_ID,
} from './context.js'
import type { DiffStatus } from './promotion.js'

export interface TemplateDef {
  templateEntityId: string // source-tenant id (NOT the promotion key — target is resolved by name)
  name: string
  category: 'document' | 'email'
  body: string
  docKind: string | null
  variables: Record<string, unknown>
}

interface RawTemplate {
  template_entity_id: string
  name: string | null
  category: string | null
  body: string | null
  doc_kind: string | null
  variables: Record<string, unknown> | null
}

function toTemplateDef(r: RawTemplate): TemplateDef {
  return {
    templateEntityId: r.template_entity_id,
    name: r.name ?? '',
    category: r.category === 'email' ? 'email' : 'document',
    body: r.body ?? '',
    docKind: r.doc_kind,
    variables: r.variables ?? {},
  }
}

// Stable identity: a 'document' NDA and an 'email' NDA are distinct units.
function templateKey(t: { category: string; name: string }): string {
  return `${t.category}::${t.name}`
}

// Canonical JSON (sorted keys, recursive) so an identical variables map never
// reads as 'changed' just because key order differs.
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`
}

function shape(t: TemplateDef): string {
  return JSON.stringify([t.body, t.docKind ?? null, canonical(t.variables)])
}

async function listTemplates(platformActorId: string, tenantId: string): Promise<TemplateDef[]> {
  return withAppRole(async (client) => {
    const r = await client.query<RawTemplate>(`SELECT * FROM private.cp_list_templates($1, $2)`, [
      platformActorId,
      tenantId,
    ])
    // A nameless template can't be promoted (no stable key) — drop defensively.
    return r.rows.map(toTemplateDef).filter((t) => t.name)
  })
}

// The templates available to promote FROM a source tenant (default: the sandbox).
export async function listPromotableTemplates(
  ctx: ActionContext,
  sourceTenantId: string = SANDBOX_TENANT_ID,
): Promise<TemplateDef[]> {
  await assertPlatformAdmin(ctx)
  return listTemplates(ctx.actorId, sourceTenantId)
}

export interface TemplateDiff {
  key: string
  name: string
  category: 'document' | 'email'
  status: DiffStatus
}

// Dry-run: classify each source template against the target (new/changed/identical).
export async function diffTemplates(
  ctx: ActionContext,
  sourceTenantId: string,
  targetTenantId: string,
): Promise<TemplateDiff[]> {
  await assertPlatformAdmin(ctx)
  const [source, target] = await Promise.all([
    listTemplates(ctx.actorId, sourceTenantId),
    listTemplates(ctx.actorId, targetTenantId),
  ])
  const targetByKey = new Map(target.map((t) => [templateKey(t), t]))
  await recordControlPlaneAction(ctx, 'promote.templates.dryrun', targetTenantId, {
    sourceTenantId,
    templateCount: source.length,
  })
  return source.map((s) => {
    const t = targetByKey.get(templateKey(s))
    const status: DiffStatus = !t ? 'new' : shape(s) === shape(t) ? 'identical' : 'changed'
    return { key: templateKey(s), name: s.name, category: s.category, status }
  })
}

export interface TemplatePromoteResult {
  targetTenantId: string
  promoted: string[]
  skipped: string[]
}

// Promote selected templates (by `${category}::${name}` key) from source to one or
// more targets. Per target: create if absent, update the existing same-named
// template if changed, skip if identical.
export async function promoteTemplates(
  ctx: ActionContext,
  input: { sourceTenantId?: string; targetTenantIds: string[]; keys: string[] },
): Promise<TemplatePromoteResult[]> {
  await assertPlatformAdmin(ctx)
  const sourceTenantId = input.sourceTenantId ?? SANDBOX_TENANT_ID
  if (!input.targetTenantIds?.length) throw new Error('At least one target tenant is required.')
  if (!input.keys?.length) throw new Error('At least one template is required.')

  const targetTenantIds = [...new Set(input.targetTenantIds)]
  for (const t of targetTenantIds) {
    if (t === PLATFORM_TENANT_ID) throw new Error('The platform tenant is not a promotion target.')
    if (t === sourceTenantId) throw new Error('A tenant cannot promote to itself.')
  }

  const source = await listTemplates(ctx.actorId, sourceTenantId)
  const wanted = new Set(input.keys)
  // De-dupe by key, keeping the first — a source with two same-(category,name)
  // templates is ambiguous; we promote one and report nothing silently wrong.
  const selected: TemplateDef[] = []
  const seen = new Set<string>()
  for (const t of source) {
    const k = templateKey(t)
    if (wanted.has(k) && !seen.has(k)) {
      seen.add(k)
      selected.push(t)
    }
  }
  if (selected.length === 0) throw new Error('None of the selected templates exist in the source.')

  const results: TemplatePromoteResult[] = []
  for (const targetTenantId of targetTenantIds) {
    const target = await buildTargetContext(ctx, targetTenantId)
    const existing = await listTemplates(ctx.actorId, targetTenantId)
    const existingByKey = new Map(existing.map((e) => [templateKey(e), e]))
    const promoted: string[] = []
    const skipped: string[] = []
    for (const tpl of selected) {
      const cur = existingByKey.get(templateKey(tpl))
      if (cur && shape(tpl) === shape(cur)) {
        skipped.push(templateKey(tpl))
        continue
      }
      if (cur) {
        await submitAction(target, {
          actionKindName: 'legal.template.update',
          intentKind: 'adjustment',
          payload: {
            template_entity_id: cur.templateEntityId,
            name: tpl.name,
            body: tpl.body,
            doc_kind: tpl.docKind ?? undefined,
            variables: tpl.variables,
          },
        })
      } else {
        await submitAction(target, {
          actionKindName: 'legal.template.create',
          intentKind: 'adjustment',
          payload: {
            name: tpl.name,
            category: tpl.category,
            body: tpl.body,
            doc_kind: tpl.docKind ?? undefined,
            variables: tpl.variables,
          },
        })
      }
      promoted.push(templateKey(tpl))
    }
    await recordControlPlaneAction(ctx, 'promote.templates.run', targetTenantId, {
      sourceTenantId,
      promoted,
      skipped,
    })
    results.push({ targetTenantId, promoted, skipped })
  }
  return results
}
