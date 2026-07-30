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
  // FB-B — this attorney's own standing instructions for the assistant, folded
  // into the STABLE half of their chat's system prompt (assistantPrompt.ts
  // buildCustomInstructionsBlock) alongside the firm-wide block. Clipped to
  // 2,000 chars at injection time; stored as-is here (the editor enforces the
  // cap client-side).
  // ITEM-12 WP-2 — the Settings → Assistant editor now saves this as pills
  // (an array, one instruction per Enter-to-add pill) instead of one free-text
  // blob. Widened to `string | string[]` rather than migrated outright: a
  // payload saved before this change is still a plain string, and
  // parseSettings below returns it as-is (JSON.parse doesn't care which shape
  // it finds) — every reader (assistantPrompt.ts's block builders) accepts
  // both, so an old string value keeps rendering correctly with zero backfill.
  customInstructions?: string | string[]
  // CONTEXT-SETTINGS-1 — this user's PERSISTENT CONTEXT FILE: free-form
  // markdown they keep about how they work, the user-level analogue of a
  // user-scope memory file (the firm-level twin is firm_context_md on the
  // firm_settings ai_context_config attribute, api/aiContextConfig.ts).
  //
  // Distinct from customInstructions above, which are short imperative pills
  // ("keep drafts short"). This is BACKGROUND — longer, prose, and read as
  // context rather than as commands. Riding the existing per-actor payload
  // rather than a new store keeps the AI-context program's "one store per
  // scope" shape and needs no migration: the payload is a single JSON
  // attribute, so a new key is additive and an older stored payload simply
  // has none.
  contextMd?: string | null
}

// Tolerant of both payload shapes (see the customInstructions comment above):
// a settings row written before ITEM-12 WP-2 has customInstructions as a plain
// string; one written after has it as string[]. JSON.parse doesn't care which
// it finds, and every downstream reader (assistantPrompt.ts) already accepts
// `string | string[]`, so no reshaping happens here — this function's job is
// only "is this valid JSON that looks like a settings object", not migrating
// the shape of any one field.
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

// CONTEXT-SETTINGS-1 — merge a partial change into THIS actor's settings
// without clobbering knobs another surface set. Every caller that only wants to
// touch one field (the chat's save_ai_instruction tool, the Context Settings
// page) goes through here rather than composing a whole payload itself.
export async function patchAssistantSettings(
  ctx: ActionContext,
  patch: Partial<AssistantSettings>,
): Promise<AssistantSettings> {
  const current = (await getAssistantSettings(ctx)) ?? {}
  const next: AssistantSettings = { ...current, ...patch }
  await setAssistantSettings(ctx, next)
  return next
}

// The user-level persistent context file, capped so a runaway paste can never
// dominate a prompt (same cap as the firm-level file).
export const USER_CONTEXT_MD_CHAR_CAP = 8000

function clampContextMd(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > USER_CONTEXT_MD_CHAR_CAP
    ? trimmed.slice(0, USER_CONTEXT_MD_CHAR_CAP)
    : trimmed
}

// Append one line/paragraph to this user's context file. Append, not replace:
// "also, I always…" said in chat must never wipe what is already there.
export async function appendUserContextMd(
  ctx: ActionContext,
  addition: string,
): Promise<{ contextMd: string | null }> {
  const add = addition.trim()
  if (!add) throw new Error('Nothing to append to your context file.')
  const current = (await getAssistantSettings(ctx)) ?? {}
  const existing = typeof current.contextMd === 'string' ? current.contextMd.trim() : ''
  const contextMd = clampContextMd(existing ? `${existing}\n${add}` : add)
  await setAssistantSettings(ctx, { ...current, contextMd })
  return { contextMd: contextMd || null }
}
