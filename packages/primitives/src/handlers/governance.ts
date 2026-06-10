// Workflow & governance write paths (invariants 17, 22). All route through the
// action layer; definitions are configuration data.
import { randomUUID } from 'crypto'
import { registerActionHandler } from '@exsto/substrate'
import { lookupKind } from './util.js'

registerActionHandler('workflow.define', async (ctx, client, payload, actionId) => {
  const p = payload as {
    kind_name: string
    display_name: string
    description?: string
    states?: unknown[]
    transitions?: unknown[]
    participating_entity_kinds?: unknown[]
    version?: number
  }
  const id = randomUUID()
  await client.query(
    `INSERT INTO workflow_definition (id, tenant_id, action_id, kind_name, display_name, description, states, transitions, participating_entity_kinds, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.kind_name,
      p.display_name,
      p.description ?? null,
      JSON.stringify(p.states ?? []),
      JSON.stringify(p.transitions ?? []),
      JSON.stringify(p.participating_entity_kinds ?? []),
      p.version ?? 1,
    ],
  )
  return { workflowDefinitionId: id }
})

registerActionHandler('workflow.start', async (ctx, client, payload, actionId) => {
  const p = payload as {
    workflow_definition_id: string
    subject_entity_id?: string
    current_state: string
  }
  const id = randomUUID()
  await client.query(
    `INSERT INTO workflow_instance (id, tenant_id, action_id, workflow_definition_id, subject_entity_id, current_state, state_history)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.workflow_definition_id,
      p.subject_entity_id ?? null,
      p.current_state,
      JSON.stringify([
        { state: p.current_state, at: new Date(0).toISOString(), action_id: actionId },
      ]),
    ],
  )
  return { workflowInstanceId: id }
})

registerActionHandler('workflow.advance', async (ctx, client, payload, actionId) => {
  const p = payload as { workflow_instance_id: string; to_state: string; status?: string }
  const r = await client.query(
    `UPDATE workflow_instance
        SET current_state = $3,
            status = COALESCE($4, status),
            state_history = state_history || jsonb_build_object('state', $3::text, 'action_id', $5::text)
      WHERE tenant_id = $1 AND id = $2`,
    [ctx.tenantId, p.workflow_instance_id, p.to_state, p.status ?? null, actionId],
  )
  if (r.rowCount === 0) throw new Error(`Workflow instance not found: ${p.workflow_instance_id}`)
  return { workflowInstanceId: p.workflow_instance_id, state: p.to_state }
})

registerActionHandler('approval.request', async (ctx, client, payload, actionId) => {
  const p = payload as {
    subject_action_id?: string
    subject_entity_id?: string
    approval_logic?: string
    required_approvers?: unknown[]
    expires_at?: string
  }
  const id = randomUUID()
  await client.query(
    `INSERT INTO approval_request (id, tenant_id, action_id, subject_action_id, subject_entity_id, approval_logic, required_approvers, requested_by_actor_id, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.subject_action_id ?? null,
      p.subject_entity_id ?? null,
      p.approval_logic ?? 'all',
      JSON.stringify(p.required_approvers ?? []),
      ctx.actorId,
      p.expires_at ?? null,
    ],
  )
  return { approvalRequestId: id }
})

registerActionHandler('approval.respond', async (ctx, client, payload, actionId) => {
  const p = payload as {
    approval_request_id: string
    response: 'approve' | 'reject' | 'abstain'
    comment?: string
  }
  const id = randomUUID()
  await client.query(
    `INSERT INTO approval_response (id, tenant_id, action_id, approval_request_id, responder_actor_id, response, comment)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, ctx.tenantId, actionId, p.approval_request_id, ctx.actorId, p.response, p.comment ?? null],
  )
  return { approvalResponseId: id }
})

registerActionHandler('policy.define', async (ctx, client, payload, actionId) => {
  const p = payload as {
    policy_name: string
    display_name: string
    description?: string
    policy_kind?: string
    rules?: Record<string, unknown>
    binding_strategy?: string
    version?: number
  }
  const id = randomUUID()
  await client.query(
    `INSERT INTO policy_definition (id, tenant_id, action_id, policy_name, display_name, description, policy_kind, rules, binding_strategy, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.policy_name,
      p.display_name,
      p.description ?? null,
      p.policy_kind ?? 'general',
      JSON.stringify(p.rules ?? {}),
      p.binding_strategy ?? 'at_start',
      p.version ?? 1,
    ],
  )
  return { policyDefinitionId: id }
})

registerActionHandler('permission_scope.define', async (ctx, client, payload, actionId) => {
  const p = payload as {
    scope_name: string
    display_name: string
    description?: string
    action_kinds?: unknown[]
    entity_kinds?: unknown[]
    attribute_kinds?: unknown[]
    row_filter_expression?: Record<string, unknown>
  }
  const id = randomUUID()
  await client.query(
    `INSERT INTO permission_scope_definition (id, tenant_id, action_id, scope_name, display_name, description, action_kinds, entity_kinds, attribute_kinds, row_filter_expression)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.scope_name,
      p.display_name,
      p.description ?? null,
      JSON.stringify(p.action_kinds ?? []),
      JSON.stringify(p.entity_kinds ?? []),
      JSON.stringify(p.attribute_kinds ?? []),
      JSON.stringify(p.row_filter_expression ?? {}),
    ],
  )
  return { permissionScopeDefinitionId: id }
})

registerActionHandler('actor_scope.assign', async (ctx, client, payload, actionId) => {
  const p = payload as { actor_id: string; permission_scope_definition_id: string }
  const id = randomUUID()
  await client.query(
    `INSERT INTO actor_scope_assignment (id, tenant_id, action_id, actor_id, permission_scope_definition_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, ctx.tenantId, actionId, p.actor_id, p.permission_scope_definition_id],
  )
  return { actorScopeAssignmentId: id }
})

registerActionHandler('trigger.define', async (ctx, client, payload, actionId) => {
  const p = payload as {
    kind_name: string
    display_name: string
    event_kind_name: string
    proposed_action_kind_name: string
    filter_expression?: Record<string, unknown>
    autonomy_tier_override?: string
  }
  const eventKindId = await lookupKind(
    client,
    'event_kind_definition',
    ctx.tenantId,
    p.event_kind_name,
  )
  const actionKindId = await lookupKind(
    client,
    'action_kind_definition',
    ctx.tenantId,
    p.proposed_action_kind_name,
  )
  const id = randomUUID()
  await client.query(
    `INSERT INTO trigger_definition (id, tenant_id, action_id, kind_name, display_name, event_kind_id, filter_expression, proposed_action_kind_id, autonomy_tier_override)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.kind_name,
      p.display_name,
      eventKindId,
      JSON.stringify(p.filter_expression ?? {}),
      actionKindId,
      p.autonomy_tier_override ?? null,
    ],
  )
  return { triggerDefinitionId: id }
})

registerActionHandler('notification_route.define', async (ctx, client, payload, actionId) => {
  const p = payload as {
    kind_name: string
    display_name: string
    channel: string
    trigger_definition_id?: string
    recipients?: unknown[]
    template_ref?: string
    config?: Record<string, unknown>
  }
  const id = randomUUID()
  await client.query(
    `INSERT INTO notification_route_definition (id, tenant_id, action_id, kind_name, display_name, trigger_definition_id, channel, recipients, template_ref, config)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.kind_name,
      p.display_name,
      p.trigger_definition_id ?? null,
      p.channel,
      JSON.stringify(p.recipients ?? []),
      p.template_ref ?? null,
      JSON.stringify(p.config ?? {}),
    ],
  )
  return { notificationRouteDefinitionId: id }
})

registerActionHandler('subscription.create', async (ctx, client, payload, actionId) => {
  const p = payload as {
    event_kind_name?: string
    entity_id?: string
    channel?: string
    filter_expression?: Record<string, unknown>
  }
  const eventKindId = p.event_kind_name
    ? await lookupKind(client, 'event_kind_definition', ctx.tenantId, p.event_kind_name)
    : null
  const id = randomUUID()
  await client.query(
    `INSERT INTO subscription (id, tenant_id, action_id, subscriber_actor_id, event_kind_id, entity_id, filter_expression, channel)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      id,
      ctx.tenantId,
      actionId,
      ctx.actorId,
      eventKindId,
      p.entity_id ?? null,
      JSON.stringify(p.filter_expression ?? {}),
      p.channel ?? 'in_app',
    ],
  )
  return { subscriptionId: id }
})
