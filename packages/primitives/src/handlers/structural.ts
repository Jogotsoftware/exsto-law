// Temporal & structural write paths: periods, hierarchies, collections,
// ownership, roles, commitments.
import { randomUUID } from 'crypto'
import { registerActionHandler } from '@exsto/substrate'
import { lookupKind } from './util.js'

registerActionHandler('period.open', async (ctx, client, payload, actionId) => {
  const p = payload as {
    period_kind_name: string
    name: string
    start_date: string
    end_date: string
    parent_period_id?: string
  }
  const kindId = await lookupKind(
    client,
    'period_kind_definition',
    ctx.tenantId,
    p.period_kind_name,
  )
  const id = randomUUID()
  await client.query(
    `INSERT INTO period (id, tenant_id, action_id, period_kind_id, name, start_date, end_date, parent_period_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      ctx.tenantId,
      actionId,
      kindId,
      p.name,
      p.start_date,
      p.end_date,
      p.parent_period_id ?? null,
    ],
  )
  return { periodId: id }
})

registerActionHandler('period.close', async (ctx, client, payload) => {
  const p = payload as { period_id: string }
  const r = await client.query(
    `UPDATE period SET status = 'closed', closed_at = now() WHERE tenant_id = $1 AND id = $2 AND status = 'open'`,
    [ctx.tenantId, p.period_id],
  )
  if (r.rowCount === 0) throw new Error(`Open period not found: ${p.period_id}`)
  return { periodId: p.period_id, status: 'closed' }
})

registerActionHandler('ownership.assign', async (ctx, client, payload, actionId) => {
  const p = payload as { entity_id: string; owner_actor_id: string; ownership_kind?: string }
  // Close any current ownership of the same kind (single accountable owner).
  await client.query(
    `UPDATE ownership_assignment SET valid_to = now()
      WHERE tenant_id = $1 AND entity_id = $2 AND ownership_kind = $3 AND valid_to IS NULL`,
    [ctx.tenantId, p.entity_id, p.ownership_kind ?? 'primary'],
  )
  const id = randomUUID()
  await client.query(
    `INSERT INTO ownership_assignment (id, tenant_id, action_id, entity_id, owner_actor_id, ownership_kind)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, ctx.tenantId, actionId, p.entity_id, p.owner_actor_id, p.ownership_kind ?? 'primary'],
  )
  return { ownershipAssignmentId: id }
})

registerActionHandler('role.define', async (ctx, client, payload, actionId) => {
  const p = payload as {
    role_name: string
    display_name: string
    description?: string
    default_permission_scopes?: unknown[]
  }
  const id = randomUUID()
  await client.query(
    `INSERT INTO role_definition (id, tenant_id, action_id, role_name, display_name, description, default_permission_scopes)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.role_name,
      p.display_name,
      p.description ?? null,
      JSON.stringify(p.default_permission_scopes ?? []),
    ],
  )
  return { roleDefinitionId: id }
})

registerActionHandler('role.assign', async (ctx, client, payload, actionId) => {
  const p = payload as {
    role_definition_id: string
    person_entity_id: string
    org_unit_entity_id?: string
    reports_to_assignment_id?: string
  }
  const id = randomUUID()
  await client.query(
    `INSERT INTO role_assignment (id, tenant_id, action_id, role_definition_id, person_entity_id, org_unit_entity_id, reports_to_assignment_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.role_definition_id,
      p.person_entity_id,
      p.org_unit_entity_id ?? null,
      p.reports_to_assignment_id ?? null,
    ],
  )
  return { roleAssignmentId: id }
})

registerActionHandler('hierarchy.define', async (ctx, client, payload, actionId) => {
  const p = payload as {
    hierarchy_name: string
    display_name: string
    description?: string
    entity_kind_name?: string
  }
  const entityKindId = p.entity_kind_name
    ? await lookupKind(client, 'entity_kind_definition', ctx.tenantId, p.entity_kind_name)
    : null
  const id = randomUUID()
  await client.query(
    `INSERT INTO hierarchy_definition (id, tenant_id, action_id, hierarchy_name, display_name, description, entity_kind_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.hierarchy_name,
      p.display_name,
      p.description ?? null,
      entityKindId,
    ],
  )
  return { hierarchyDefinitionId: id }
})

registerActionHandler('hierarchy.set_membership', async (ctx, client, payload, actionId) => {
  const p = payload as {
    hierarchy_definition_id: string
    entity_id: string
    parent_entity_id?: string
  }
  // Close prior membership in this hierarchy for the entity.
  await client.query(
    `UPDATE hierarchy_membership SET valid_to = now()
      WHERE tenant_id = $1 AND hierarchy_definition_id = $2 AND entity_id = $3 AND valid_to IS NULL`,
    [ctx.tenantId, p.hierarchy_definition_id, p.entity_id],
  )
  const id = randomUUID()
  await client.query(
    `INSERT INTO hierarchy_membership (id, tenant_id, action_id, hierarchy_definition_id, entity_id, parent_entity_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.hierarchy_definition_id,
      p.entity_id,
      p.parent_entity_id ?? null,
    ],
  )
  return { hierarchyMembershipId: id }
})

registerActionHandler('collection.define', async (ctx, client, payload, actionId) => {
  const p = payload as {
    collection_name: string
    display_name: string
    description?: string
    collection_type?: string
    criteria?: Record<string, unknown>
    entity_kind_name?: string
  }
  const entityKindId = p.entity_kind_name
    ? await lookupKind(client, 'entity_kind_definition', ctx.tenantId, p.entity_kind_name)
    : null
  const id = randomUUID()
  await client.query(
    `INSERT INTO collection_definition (id, tenant_id, action_id, collection_name, display_name, description, collection_type, criteria, entity_kind_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.collection_name,
      p.display_name,
      p.description ?? null,
      p.collection_type ?? 'static',
      JSON.stringify(p.criteria ?? {}),
      entityKindId,
    ],
  )
  return { collectionDefinitionId: id }
})

registerActionHandler('commitment.create', async (ctx, client, payload, actionId) => {
  const p = payload as {
    commitment_kind?: string
    subject_entity_id?: string
    description: string
    due_at: string
    due_at_precision?: string
    threshold_at?: string
    consequences?: Record<string, unknown>
  }
  const id = randomUUID()
  await client.query(
    `INSERT INTO commitment (id, tenant_id, action_id, commitment_kind, subject_entity_id, description, due_at, due_at_precision, threshold_at, consequences)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.commitment_kind ?? 'deadline',
      p.subject_entity_id ?? null,
      p.description,
      p.due_at,
      p.due_at_precision ?? 'exact_instant',
      p.threshold_at ?? null,
      JSON.stringify(p.consequences ?? {}),
    ],
  )
  return { commitmentId: id }
})

registerActionHandler('commitment.fulfill', async (ctx, client, payload) => {
  const p = payload as { commitment_id: string; status?: 'fulfilled' | 'breached' | 'cancelled' }
  const r = await client.query(
    `UPDATE commitment SET status = $3, fulfilled_at = CASE WHEN $3 = 'fulfilled' THEN now() ELSE fulfilled_at END
      WHERE tenant_id = $1 AND id = $2`,
    [ctx.tenantId, p.commitment_id, p.status ?? 'fulfilled'],
  )
  if (r.rowCount === 0) throw new Error(`Commitment not found: ${p.commitment_id}`)
  return { commitmentId: p.commitment_id, status: p.status ?? 'fulfilled' }
})
