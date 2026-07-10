import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEntity, lookupKindId } from './common.js'

// ───────────────────────────────────────────────────────────────────────────
// Standalone templates (beta sprint Objective 9). A template entity is a
// reusable document/email template NOT bound to a service. legal.template.create
// makes one; legal.template.update supersedes its attributes (append-only).
// Archival reuses the core entity.archive action. All writes flow through here.
// ───────────────────────────────────────────────────────────────────────────

const TEMPLATE_ENTITY_KIND = 'template'
type TemplateCategory = 'document' | 'email'

async function setTemplateAttr(
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

// Typed {{token}} metadata, keyed by token id (see migration 0076). Stored as a
// single structured attribute on the template entity.
type TemplateVariables = Record<string, unknown>

// ESIGN-BLOCK-1 (WP1) — the signability declaration, stored as one structured
// `template_signature` attribute (attribute kind defined via kind.define — data,
// not DDL). Normalized on write so a malformed declaration can never be persisted;
// reads coerce defensively anyway (queries/templates.parseTemplateSignature).
const SIGNER_ROLES = ['client', 'attorney', 'witness', 'notary'] as const

function normalizeSignature(raw: unknown): { required: boolean; signer_roles: string[] } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as {
    required?: unknown
    signer_roles?: unknown
  }
  const roles = Array.isArray(o.signer_roles)
    ? [...new Set(o.signer_roles.filter((r) => SIGNER_ROLES.includes(r)))]
    : []
  const required = o.required === true
  if (required && roles.length === 0) {
    throw new Error(
      `signature.required is true but signer_roles is empty — declare who signs (${SIGNER_ROLES.join(', ')}).`,
    )
  }
  return { required, signer_roles: roles as string[] }
}

interface TemplateCreatePayload {
  name: string
  category: TemplateCategory
  body: string
  doc_kind?: string | null
  variables?: TemplateVariables
  signature?: unknown
}

registerActionHandler('legal.template.create', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as TemplateCreatePayload
  const name = (p.name ?? '').trim()
  if (!name) throw new Error('name is required.')
  if (p.category !== 'document' && p.category !== 'email') {
    throw new Error("category must be 'document' or 'email'.")
  }
  if (typeof p.body !== 'string' || !p.body.trim()) throw new Error('body is required.')

  const kindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    TEMPLATE_ENTITY_KIND,
  )
  const templateEntityId = await insertEntity(client, ctx.tenantId, actionId, kindId, name, {})

  const attrs: Array<{ kind: string; value: unknown }> = [
    { kind: 'template_name', value: name },
    { kind: 'template_category', value: p.category },
    { kind: 'template_body', value: p.body },
  ]
  if (p.category === 'document' && p.doc_kind) {
    attrs.push({ kind: 'template_doc_kind', value: p.doc_kind })
  }
  if (p.variables && typeof p.variables === 'object' && Object.keys(p.variables).length > 0) {
    attrs.push({ kind: 'template_variables', value: p.variables })
  }
  // Absent signature = unsigned (no attribute row) — the read default carries it.
  if (p.signature != null) {
    attrs.push({ kind: 'template_signature', value: normalizeSignature(p.signature) })
  }
  for (const a of attrs) {
    await setTemplateAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: templateEntityId,
      kind: a.kind,
      value: a.value,
    })
  }

  return { templateEntityId }
})

interface TemplateUpdatePayload {
  template_entity_id: string
  name?: string
  body?: string
  doc_kind?: string | null
  variables?: TemplateVariables
  signature?: unknown
}

registerActionHandler('legal.template.update', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as TemplateUpdatePayload
  if (!p.template_entity_id) throw new Error('template_entity_id is required.')

  const updates: Array<{ kind: string; value: unknown }> = []
  if (p.name != null) {
    const name = p.name.trim()
    if (!name) throw new Error('name cannot be blank.')
    updates.push({ kind: 'template_name', value: name })
  }
  if (p.body != null) {
    if (!p.body.trim()) throw new Error('body cannot be blank.')
    updates.push({ kind: 'template_body', value: p.body })
  }
  if (p.doc_kind != null) updates.push({ kind: 'template_doc_kind', value: p.doc_kind })
  // A non-null variables map (including {}) supersedes the prior — lets the editor
  // clear all field metadata as well as set it.
  if (p.variables != null && typeof p.variables === 'object') {
    updates.push({ kind: 'template_variables', value: p.variables })
  }
  // A non-null signature supersedes the prior declaration; {required:false} unsigns.
  if (p.signature != null) {
    updates.push({ kind: 'template_signature', value: normalizeSignature(p.signature) })
  }

  for (const u of updates) {
    await setTemplateAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: p.template_entity_id,
      kind: u.kind,
      value: u.value,
    })
  }

  return { templateEntityId: p.template_entity_id, updated: updates.map((u) => u.kind) }
})
