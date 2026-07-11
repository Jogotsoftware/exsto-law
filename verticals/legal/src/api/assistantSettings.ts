// HARDENING-RESIDUALS-1 (WP-D item 1) — assistant settings persisted through
// core, per attorney. One assistant_settings entity per (tenant, actor)
// (runtime kinds, see demo/seed-assistant-session-kinds.ts): the actor is an
// attribute (assistant_settings_actor), the settings ride as ONE JSON
// attribute (assistant_settings_payload) whose supersession history is the
// audit trail. Mirrors the firm_settings find-or-create singleton pattern,
// keyed per actor instead of per tenant (the migration-0016 per-attorney
// convention). Everything flows through EXISTING core actions — no new action
// kinds, no migration.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

const SETTINGS_KIND = 'assistant_settings'

// The persisted knobs. All optional: the client merges over its defaults, so
// adding a knob later never breaks an older stored payload.
export interface AssistantSettings {
  modelId?: string
  workRate?: 'quick' | 'balanced' | 'thorough'
  webSearch?: boolean
  // Research toggle: route research questions to the connected research
  // provider (Perplexity). Activation-gated client-side by the provider's
  // Contract-A connection status.
  research?: boolean
  contextDepth?: 'lean' | 'balanced' | 'generous'
}

function parseSettings(raw: string | null | undefined): AssistantSettings | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' ? (v as AssistantSettings) : null
  } catch {
    return null
  }
}

async function findSettingsEntity(ctx: ActionContext): Promise<string | null> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ id: string }>(
      `SELECT e.id
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = $2 AND e.status = 'active'
         AND EXISTS (
           SELECT 1 FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
           WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
             AND akd.kind_name = 'assistant_settings_actor'
             AND a.value #>> '{}' = $3
         )
       ORDER BY e.created_at ASC
       LIMIT 1`,
      [ctx.tenantId, SETTINGS_KIND, ctx.actorId],
    )
    return r.rows[0]?.id ?? null
  })
}

export async function getAssistantSettings(ctx: ActionContext): Promise<AssistantSettings | null> {
  const entityId = await findSettingsEntity(ctx)
  if (!entityId) return null
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ payload: string | null }>(
      `SELECT a.value #>> '{}' AS payload
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id = $1 AND a.entity_id = $2
         AND akd.kind_name = 'assistant_settings_payload'
       ORDER BY a.valid_from DESC LIMIT 1`,
      [ctx.tenantId, entityId],
    )
    return parseSettings(r.rows[0]?.payload)
  })
}

// Persist the attorney's assistant settings (whole-payload supersession: the
// client sends the full current settings object; each save is one attribute
// row, so the history reads as "settings at time T").
export async function setAssistantSettings(
  ctx: ActionContext,
  settings: AssistantSettings,
): Promise<{ settingsEntityId: string }> {
  const payload = JSON.stringify(settings ?? {})
  let entityId = await findSettingsEntity(ctx)
  if (!entityId) {
    const created = await submitAction(ctx, {
      actionKindName: 'entity.create',
      intentKind: 'adjustment',
      payload: {
        entity_kind_name: SETTINGS_KIND,
        name: 'Assistant settings',
        attributes: [
          {
            attributeKindName: 'assistant_settings_actor',
            value: ctx.actorId,
            confidence: 1.0,
            knowabilityState: 'observed',
            timePrecision: 'exact_instant',
            sourceType: 'human',
            sourceRef: ctx.actorId,
          },
          {
            attributeKindName: 'assistant_settings_payload',
            value: payload,
            confidence: 1.0,
            knowabilityState: 'observed',
            timePrecision: 'exact_instant',
            sourceType: 'human',
            sourceRef: ctx.actorId,
          },
        ],
      },
    })
    entityId = (created.effects[0] as { entityId?: string })?.entityId ?? null
    if (!entityId) throw new Error('entity.create returned no entityId for assistant settings.')
    return { settingsEntityId: entityId }
  }
  await submitAction(ctx, {
    actionKindName: 'attribute.set',
    intentKind: 'adjustment',
    payload: {
      entity_id: entityId,
      attribute_kind_name: 'assistant_settings_payload',
      value: payload,
      confidence: 1.0,
      knowability_state: 'observed',
      time_precision: 'exact_instant',
      source_type: 'human',
      source_ref: ctx.actorId,
    },
  })
  return { settingsEntityId: entityId }
}
