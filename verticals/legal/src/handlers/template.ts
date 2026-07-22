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

// ESIGN-UNIFY-1 ES-3 (0187 planned, §6.1) — the SHAPE-ONLY write-side guard for
// template_esign_config, mirroring normalizeSignature's discipline exactly
// (structural validity + the one hard invariant that must never reach the
// substrate malformed). Marker↔role DRIFT (does every needs_to_sign role
// actually have a {{sign:key}} marker in the body?) is NOT checked here — the
// handler does not reliably see the current body on a partial update. That
// check lives at the API layer with body context: validateProposedTemplate
// (the AI-proposal gate, hard) and the editor panel's live warning (soft, via
// esign/fields.js computeMarkerRoleDrift) — see templateAuthoring.ts.
const ESIGN_RECIPIENT_ROLES = ['needs_to_sign', 'needs_to_view', 'receives_copy'] as const
type EsignRecipientRoleLiteral = (typeof ESIGN_RECIPIENT_ROLES)[number]

interface RawEsignRole {
  key?: unknown
  label?: unknown
  recipientRole?: unknown
  bind?: unknown
  order?: unknown
  presigned?: unknown
}

function isValidBind(v: unknown): boolean {
  if (typeof v !== 'string' || !v) return false
  if (v === 'matter_primary_contact' || v === 'attorney_of_record' || v === 'manual') return true
  return v.startsWith('contact_role:') && v.length > 'contact_role:'.length
}

function normalizeEsignConfig(raw: unknown): {
  signable: boolean
  roles: Array<{
    key: string
    label: string
    recipientRole: EsignRecipientRoleLiteral
    bind: string
    order: number
    presigned?: boolean
  }>
} {
  const o = (raw && typeof raw === 'object' ? raw : {}) as {
    signable?: unknown
    roles?: unknown
  }
  const seen = new Set<string>()
  const roles: Array<{
    key: string
    label: string
    recipientRole: EsignRecipientRoleLiteral
    bind: string
    order: number
    presigned?: boolean
  }> = []
  if (Array.isArray(o.roles)) {
    for (const entry of o.roles as RawEsignRole[]) {
      const key = typeof entry?.key === 'string' ? entry.key.trim() : ''
      if (!key) throw new Error('Every e-sign role needs a key (the marker signer key it owns).')
      if (seen.has(key)) throw new Error(`Duplicate e-sign role key "${key}".`)
      seen.add(key)
      const recipientRole: EsignRecipientRoleLiteral = ESIGN_RECIPIENT_ROLES.includes(
        entry.recipientRole as EsignRecipientRoleLiteral,
      )
        ? (entry.recipientRole as EsignRecipientRoleLiteral)
        : 'needs_to_sign'
      const bind = isValidBind(entry.bind) ? (entry.bind as string) : 'manual'
      const order =
        typeof entry.order === 'number' && Number.isFinite(entry.order) ? entry.order : 1
      const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : key
      // PRESIGN-1 — pre-signing is the attorney auto-applying their OWN standing
      // signature; honor it only for attorney_of_record (dropped elsewhere).
      const presigned = entry.presigned === true && bind === 'attorney_of_record'
      roles.push({ key, label, recipientRole, bind, order, ...(presigned ? { presigned } : {}) })
    }
  }
  const signable = o.signable === true
  if (signable && !roles.some((r) => r.recipientRole === 'needs_to_sign')) {
    throw new Error(
      'esignConfig.signable is true but no role is set to "needs_to_sign" — declare at least one signer.',
    )
  }
  return { signable, roles }
}

interface TemplateCreatePayload {
  name: string
  category: TemplateCategory
  body: string
  doc_kind?: string | null
  variables?: TemplateVariables
  signature?: unknown
  esign_config?: unknown
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
  // Absent esign_config = the read layer falls back to legacy template_signature
  // (or unsignable, if that's absent too) — see parseTemplateEsignConfig.
  if (p.esign_config != null) {
    attrs.push({ kind: 'template_esign_config', value: normalizeEsignConfig(p.esign_config) })
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
  esign_config?: unknown
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
  // A non-null esign_config supersedes the prior config; {signable:false} unsigns.
  if (p.esign_config != null) {
    updates.push({ kind: 'template_esign_config', value: normalizeEsignConfig(p.esign_config) })
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

// ───────────────────────────────────────────────────────────────────────────
// legal.template.retire (HARDENING-RESIDUALS-1 WP-F, migration 0150) — soft
// retire, mirroring legal.service.retire one shelf over. The entity's status
// flips to 'archived' (all library/picker reads filter status = 'active'), its
// history stays immutable, and document_drafts already generated from it are
// untouched (they reference their own content, not the template row).
//
// BLOCKED while the template is in use: attached to an ACTIVE service's
// workflow (a stage.documents[].templateEntityId in a current
// workflow_definition) or fed by a questionnaire (an open
// questionnaire_feeds_template relationship). The error names what holds it —
// "in use by X" — so the attorney detaches there first, then retires.
// ───────────────────────────────────────────────────────────────────────────

interface TemplateRetirePayload {
  template_entity_id: string
}

registerActionHandler('legal.template.retire', async (ctx, client, payload) => {
  const p = payload as unknown as TemplateRetirePayload
  if (!p.template_entity_id) throw new Error('template_entity_id is required')

  const found = await client.query<{ id: string; name: string; status: string }>(
    `SELECT e.id, e.name, e.status
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
      WHERE e.tenant_id = $1 AND e.id = $2 AND ekd.kind_name = $3`,
    [ctx.tenantId, p.template_entity_id, TEMPLATE_ENTITY_KIND],
  )
  const tpl = found.rows[0]
  if (!tpl) throw new Error('Template not found.')
  if (tpl.status !== 'active') throw new Error(`Template is already ${tpl.status}.`)

  // In-use check A: current service workflows referencing this template.
  const services = await client.query<{ kind_name: string }>(
    `SELECT wd.kind_name
       FROM workflow_definition wd
      WHERE wd.tenant_id = $1
        AND wd.valid_to IS NULL
        AND wd.states::text LIKE '%' || $2 || '%'`,
    [ctx.tenantId, p.template_entity_id],
  )
  // In-use check B: questionnaires that feed this template (open relationships).
  const questionnaires = await client.query<{ name: string }>(
    `SELECT src.name
       FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       JOIN entity src ON src.id = r.source_entity_id
      WHERE r.tenant_id = $1
        AND rkd.kind_name = 'questionnaire_feeds_template'
        AND r.target_entity_id = $2
        AND r.valid_to IS NULL
        AND src.status = 'active'`,
    [ctx.tenantId, p.template_entity_id],
  )
  const holders = [
    ...services.rows.map((r) => `service "${r.kind_name}"`),
    ...questionnaires.rows.map((r) => `questionnaire "${r.name}"`),
  ]
  if (holders.length > 0) {
    throw new Error(
      `Template "${tpl.name}" is in use by ${holders.join(', ')} — detach it there first, then retire.`,
    )
  }

  // Same soft mechanics as core entity.archive (primitives/handlers/core.ts) —
  // run here so the block-if-in-use gate and the archive land in ONE action.
  await client.query(`UPDATE entity SET status = 'archived' WHERE tenant_id = $1 AND id = $2`, [
    ctx.tenantId,
    p.template_entity_id,
  ])

  return { templateEntityId: p.template_entity_id, retired: true }
})
