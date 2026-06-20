import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { KNOWN_FIELD_TYPES } from '../api/services.js'
import { insertAttribute, insertEntity, lookupKindId } from './common.js'

// ───────────────────────────────────────────────────────────────────────────
// Question library (migration 0077). A question_template entity is a single
// reusable intake question carrying a stable {{answer}} token. .create makes one;
// .update supersedes its attributes (append-only). Archival reuses the core
// entity.archive action. Mirrors the questionnaire-library handler exactly.
// ───────────────────────────────────────────────────────────────────────────

const QT_ENTITY_KIND = 'question_template'
const KNOWN_TYPES = new Set<string>(KNOWN_FIELD_TYPES)
// Answer types that carry a choice list (must be a non-empty string[]).
const OPTION_TYPES = new Set<string>(['select', 'checkbox'])

async function setAttr(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    actorId: string
    entityId: string
    kind: string
    value: unknown
  },
): Promise<void> {
  const akId = await lookupKindId(client, 'attribute_kind_definition', args.tenantId, args.kind)
  await insertAttribute(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    entityId: args.entityId,
    attributeKindId: akId,
    value: args.value,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: args.actorId,
  })
}

function assertType(type: unknown): asserts type is string {
  if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) {
    throw new Error(
      `Unsupported answer type "${String(type)}". Allowed: ${KNOWN_FIELD_TYPES.join(', ')}.`,
    )
  }
}

function assertOptions(type: string, options: unknown): void {
  if (!OPTION_TYPES.has(type)) return
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error(`A ${type} question needs a non-empty options list.`)
  }
  if (!options.every((o) => typeof o === 'string')) {
    throw new Error(`Options must all be strings.`)
  }
}

interface CreatePayload {
  label: string
  type: string
  token: string
  options?: string[] | null
}

registerActionHandler('legal.question_template.create', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as CreatePayload
  const label = (p.label ?? '').trim()
  if (!label) throw new Error('label is required.')
  assertType(p.type)
  assertOptions(p.type, p.options)
  const token = (p.token ?? '').trim()
  if (!token) throw new Error('token is required.')

  const kindId = await lookupKindId(client, 'entity_kind_definition', ctx.tenantId, QT_ENTITY_KIND)
  const questionTemplateId = await insertEntity(client, ctx.tenantId, actionId, kindId, label, {})

  const attrs: Array<{ kind: string; value: unknown }> = [
    { kind: 'question_template_label', value: label },
    { kind: 'question_template_type', value: p.type },
    { kind: 'question_template_token', value: token },
  ]
  if (OPTION_TYPES.has(p.type)) {
    attrs.push({ kind: 'question_template_options', value: p.options })
  }
  for (const a of attrs) {
    await setAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: questionTemplateId,
      kind: a.kind,
      value: a.value,
    })
  }

  return { questionTemplateId }
})

interface UpdatePayload {
  question_template_id: string
  label?: string
  type?: string
  token?: string
  options?: string[] | null
}

registerActionHandler('legal.question_template.update', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as UpdatePayload
  if (!p.question_template_id) throw new Error('question_template_id is required.')

  const updates: Array<{ kind: string; value: unknown }> = []
  if (p.label != null) {
    const label = p.label.trim()
    if (!label) throw new Error('label cannot be blank.')
    updates.push({ kind: 'question_template_label', value: label })
  }
  let typeChanged = false
  if (p.type != null) {
    assertType(p.type)
    updates.push({ kind: 'question_template_type', value: p.type })
    typeChanged = true
    if (OPTION_TYPES.has(p.type)) {
      // Switching to / staying an option type requires the choice list alongside.
      assertOptions(p.type, p.options)
      updates.push({ kind: 'question_template_options', value: p.options })
    } else {
      // Switching to a non-option type clears any stale choices.
      updates.push({ kind: 'question_template_options', value: null })
    }
  }
  if (p.token != null) {
    const token = p.token.trim()
    if (!token) throw new Error('token cannot be blank.')
    updates.push({ kind: 'question_template_token', value: token })
  }
  // Options-only update (no type change): store as given — the type is unchanged
  // so we can't re-validate it here; the type+options always travel together from
  // the editor and the create/upsert path.
  if (!typeChanged && p.options !== undefined) {
    updates.push({ kind: 'question_template_options', value: p.options })
  }

  for (const u of updates) {
    await setAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: p.question_template_id,
      kind: u.kind,
      value: u.value,
    })
  }

  return { questionTemplateId: p.question_template_id, updated: updates.map((u) => u.kind) }
})
