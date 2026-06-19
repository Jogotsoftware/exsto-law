import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEntity, lookupKindId } from './common.js'

// ───────────────────────────────────────────────────────────────────────────
// Questionnaire library (migration 0067). A questionnaire_template entity is a
// reusable intake form NOT bound to a service. legal.questionnaire_template.create
// makes one; .update supersedes its attributes (append-only). Archival reuses the
// core entity.archive action. Mirrors the standalone template handler exactly.
// ───────────────────────────────────────────────────────────────────────────

const QT_ENTITY_KIND = 'questionnaire_template'

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

// The intake schema must be { sections: [...] } — the same shape the service
// builder and renderer consume. Field-level validation lives in the service
// questionnaire path; here we only guard the envelope.
function assertSchema(schema: unknown): void {
  const sections = (schema as { sections?: unknown } | null)?.sections
  if (!schema || typeof schema !== 'object' || !Array.isArray(sections)) {
    throw new Error('schema must be an object with a sections array.')
  }
}

interface CreatePayload {
  name: string
  description?: string | null
  schema: unknown
}

registerActionHandler(
  'legal.questionnaire_template.create',
  async (ctx, client, payload, actionId) => {
    const p = payload as unknown as CreatePayload
    const name = (p.name ?? '').trim()
    if (!name) throw new Error('name is required.')
    assertSchema(p.schema)

    const kindId = await lookupKindId(
      client,
      'entity_kind_definition',
      ctx.tenantId,
      QT_ENTITY_KIND,
    )
    const questionnaireTemplateId = await insertEntity(
      client,
      ctx.tenantId,
      actionId,
      kindId,
      name,
      {},
    )

    const attrs: Array<{ kind: string; value: unknown }> = [
      { kind: 'questionnaire_template_name', value: name },
      { kind: 'questionnaire_template_schema', value: p.schema },
    ]
    if (p.description != null && p.description.trim()) {
      attrs.push({ kind: 'questionnaire_template_description', value: p.description.trim() })
    }
    for (const a of attrs) {
      await setAttr(client, {
        tenantId: ctx.tenantId,
        actionId,
        actorId: ctx.actorId,
        entityId: questionnaireTemplateId,
        kind: a.kind,
        value: a.value,
      })
    }

    return { questionnaireTemplateId }
  },
)

interface UpdatePayload {
  questionnaire_template_id: string
  name?: string
  description?: string | null
  schema?: unknown
}

registerActionHandler(
  'legal.questionnaire_template.update',
  async (ctx, client, payload, actionId) => {
    const p = payload as unknown as UpdatePayload
    if (!p.questionnaire_template_id) throw new Error('questionnaire_template_id is required.')

    const updates: Array<{ kind: string; value: unknown }> = []
    if (p.name != null) {
      const name = p.name.trim()
      if (!name) throw new Error('name cannot be blank.')
      updates.push({ kind: 'questionnaire_template_name', value: name })
    }
    if (p.description != null) {
      updates.push({ kind: 'questionnaire_template_description', value: p.description })
    }
    if (p.schema != null) {
      assertSchema(p.schema)
      updates.push({ kind: 'questionnaire_template_schema', value: p.schema })
    }

    for (const u of updates) {
      await setAttr(client, {
        tenantId: ctx.tenantId,
        actionId,
        actorId: ctx.actorId,
        entityId: p.questionnaire_template_id,
        kind: u.kind,
        value: u.value,
      })
    }

    return {
      questionnaireTemplateId: p.questionnaire_template_id,
      updated: updates.map((u) => u.kind),
    }
  },
)
