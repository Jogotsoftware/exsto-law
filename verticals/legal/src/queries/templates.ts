import { withActionContext, type ActionContext } from '@exsto/substrate'

// Standalone templates read layer (beta sprint Obj 9). A standalone template is a
// `template` entity (document or email) not bound to a service — the firm's
// reusable library. These reads back the Templates tab editor and feed the
// aggregate catalog (templatesCatalog.ts).

export type StandaloneTemplateCategory = 'document' | 'email'

// Typed metadata for a single {{token}}. Stored as part of the template_variables
// JSON attribute, keyed by token id (see migration 0076). Types align 1:1 with
// the intake questionnaire's field types so a template can generate a typed form.
export type TemplateVariableType =
  | 'text'
  | 'textarea'
  | 'date'
  | 'number'
  | 'currency'
  | 'boolean'
  | 'choice'

export interface TemplateVariableSpec {
  type: TemplateVariableType
  required?: boolean
  default?: string
  options?: string[] // for type 'choice'
}

// Keyed by lowercased token id, e.g. { client_name: { type: 'text', required: true } }.
export type TemplateVariables = Record<string, TemplateVariableSpec>

// ESIGN-BLOCK-1 (WP1) — a template's signability declaration (schema-as-data: the
// `template_signature` json attribute, defined via kind.define — no DDL). A template
// without the attribute means "not signed": read defensively everywhere.
export type SignerRole = 'client' | 'attorney' | 'witness' | 'notary'
export const SIGNER_ROLES: readonly SignerRole[] = ['client', 'attorney', 'witness', 'notary']

export interface TemplateSignature {
  required: boolean
  signer_roles: SignerRole[]
}

export const UNSIGNED: TemplateSignature = { required: false, signer_roles: [] }

// Coerce a raw attribute value to a well-formed declaration. Anything malformed
// (or absent) reads as UNSIGNED — a bad declaration must never make a document
// look signable.
export function parseTemplateSignature(raw: unknown): TemplateSignature {
  if (!raw || typeof raw !== 'object') return UNSIGNED
  const o = raw as { required?: unknown; signer_roles?: unknown }
  const roles = Array.isArray(o.signer_roles)
    ? o.signer_roles.filter((r): r is SignerRole => SIGNER_ROLES.includes(r as SignerRole))
    : []
  return { required: o.required === true, signer_roles: roles }
}

// ─────────────────────────────────────────────────────────────────────────
// ESIGN-UNIFY-1 ES-3 (0187 planned, §6.1) — template-embedded e-sign config.
// `template_esign_config` FORMALIZES and SUPERSEDES `template_signature` above:
// every role names the marker signer key it owns ({{sign:<key>}}), a recipient
// role (does it gate completion, view-only, or just receive the executed copy),
// a BIND (how the composer resolves that role to a real recipient at send/
// intake time), and a default signing order. The body still carries the anchor
// markers (SIG-BLOCK-1); this config carries roles/bindings/order.
// ─────────────────────────────────────────────────────────────────────────

// Mirrors the envelope model's signer_role (0186, ESIGN-UNIFY-1 §5): whether a
// role's recipient must sign to complete the envelope, only views, or receives
// the executed copy afterward.
export type EsignRecipientRole = 'needs_to_sign' | 'needs_to_view' | 'receives_copy'
export const ESIGN_RECIPIENT_ROLES: readonly EsignRecipientRole[] = [
  'needs_to_sign',
  'needs_to_view',
  'receives_copy',
]

// How the composer resolves a role to a real recipient after intake (§6.4,
// esignPrefill.ts): the matter's primary contact, the attorney handling the
// matter, a NAMED contact-role relationship (forward-compatible — no such
// relationship kind is defined yet; resolution degrades to an empty/manual row
// until one is), or a manual row the attorney fills in the composer.
export type EsignRoleBindKind =
  | 'matter_primary_contact'
  | 'attorney_of_record'
  | 'manual'
  | `contact_role:${string}`

const FIXED_BIND_KINDS: readonly string[] = [
  'matter_primary_contact',
  'attorney_of_record',
  'manual',
]

export function isEsignRoleBindKind(v: unknown): v is EsignRoleBindKind {
  if (typeof v !== 'string' || !v) return false
  if (FIXED_BIND_KINDS.includes(v)) return true
  return v.startsWith('contact_role:') && v.length > 'contact_role:'.length
}

// ESIGN-FIELDS-1 — per-role merge-field bindings. A signer's identity (printed
// name / delivery email / title) can be pulled from named {{merge fields}} the
// document already collects — e.g. a second LLC member or an NDA counterparty
// whose email lives in an intake answer ({{member_2_email}}), not in the CRM.
// Each value is a merge-field TOKEN name (the {{token}} without braces); the
// send-time resolver reads its merged VALUE for the matter (esignPrefill.ts).
// A bound field OVERRIDES the coarse `bind`-resolved value for that slot; an
// empty/unresolvable field falls back to the bind. Absent → bind-only (the
// pre-ESIGN-FIELDS-1 behavior), so old configs read unchanged.
export interface TemplateEsignRoleFields {
  /** Token whose merged value supplies this signer's printed name. */
  name?: string
  /** Token whose merged value supplies this signer's delivery email. */
  email?: string
  /** Token whose merged value supplies this signer's title. */
  title?: string
}

export interface TemplateEsignRole {
  /** The marker signer key this role owns ({{sign:<key>}}, {{name:<key>}}, …). */
  key: string
  /** Human label shown in the editor and the composer ("Client", "Managing Member"). */
  label: string
  recipientRole: EsignRecipientRole
  bind: EsignRoleBindKind
  /** Signing-order default; equal orders route in parallel. */
  order: number
  /** ESIGN-FIELDS-1 — merge-field-sourced identity slots (override `bind`). */
  fields?: TemplateEsignRoleFields
}

// A merge-field token reference on a role, normalized to the token grammar
// tokens use everywhere else ([a-z0-9_], lower-cased). Empty → undefined.
function parseRoleFieldToken(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
  return t || undefined
}

export function parseTemplateEsignRoleFields(raw: unknown): TemplateEsignRoleFields | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const name = parseRoleFieldToken(o.name)
  const email = parseRoleFieldToken(o.email)
  const title = parseRoleFieldToken(o.title)
  if (!name && !email && !title) return undefined
  return { ...(name ? { name } : {}), ...(email ? { email } : {}), ...(title ? { title } : {}) }
}

export interface TemplateEsignConfig {
  signable: boolean
  roles: TemplateEsignRole[]
}

export const EMPTY_ESIGN_CONFIG: TemplateEsignConfig = { signable: false, roles: [] }

// Coerce one raw role entry defensively. A role missing its `key` is dropped —
// it can never anchor to a marker, so it is not a role at all.
export function parseTemplateEsignRole(raw: unknown): TemplateEsignRole | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const key = typeof o.key === 'string' ? o.key.trim() : ''
  if (!key) return null
  const recipientRole: EsignRecipientRole = ESIGN_RECIPIENT_ROLES.includes(
    o.recipientRole as EsignRecipientRole,
  )
    ? (o.recipientRole as EsignRecipientRole)
    : 'needs_to_sign'
  const bind: EsignRoleBindKind = isEsignRoleBindKind(o.bind) ? o.bind : 'manual'
  const order = typeof o.order === 'number' && Number.isFinite(o.order) ? o.order : 1
  const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : key
  const fields = parseTemplateEsignRoleFields(o.fields)
  return { key, label, recipientRole, bind, order, ...(fields ? { fields } : {}) }
}

// ESIGN-FIELDS-1 — signable-document email coverage (§ warn+one-click) lives in
// the CLIENT-SAFE esign module (esign/fields.ts, re-exported from
// '@exsto/legal/esign') so the template-editor panel can import it without
// pulling this server-adjacent queries barrel (which imports @exsto/substrate)
// into the browser bundle. See computeSignerEmailGaps there.

// Defensive parser (UNSIGNED-style, mirrors parseTemplateSignature above):
// anything malformed or absent reads as the empty/unsignable config — a bad
// declaration must never make a document look signable. Duplicate role keys
// are collapsed to the LAST occurrence (a save always writes the full array,
// so "last wins" matches "what the editor currently shows").
export function parseTemplateEsignConfig(raw: unknown): TemplateEsignConfig {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_ESIGN_CONFIG }
  const o = raw as { signable?: unknown; roles?: unknown }
  const byKey = new Map<string, TemplateEsignRole>()
  if (Array.isArray(o.roles)) {
    for (const entry of o.roles) {
      const role = parseTemplateEsignRole(entry)
      if (role) byKey.set(role.key, role)
    }
  }
  return { signable: o.signable === true, roles: [...byKey.values()] }
}

// §6.1 forward migration: a legacy `template_signature` declaration read as a
// TemplateEsignConfig — one `needs_to_sign` role per legacy signer_role, in the
// order given (index+1 — first-declared signs first). 'attorney' binds to
// attorney_of_record; client/witness/notary all bind to the matter's primary
// contact (the only bind the legacy shape can honestly imply — witness/notary
// were never separately captured). This is a READ-TIME shim, not a data
// migration: the next save under the new editor persists a real
// template_esign_config and this function is bypassed for that template.
export function templateSignatureToEsignConfig(sig: TemplateSignature): TemplateEsignConfig {
  if (!sig.required || sig.signer_roles.length === 0) return { ...EMPTY_ESIGN_CONFIG }
  return {
    signable: true,
    roles: sig.signer_roles.map((r, i) => ({
      key: r,
      label: r.charAt(0).toUpperCase() + r.slice(1),
      recipientRole: 'needs_to_sign' as const,
      bind:
        r === 'attorney' ? ('attorney_of_record' as const) : ('matter_primary_contact' as const),
      order: i + 1,
    })),
  }
}

export interface StandaloneTemplate {
  templateEntityId: string
  name: string
  category: StandaloneTemplateCategory
  body: string
  docKind: string | null
  variables: TemplateVariables
  signature: TemplateSignature
  // ESIGN-UNIFY-1 ES-3 (0187 planned) — resolved from template_esign_config when
  // present; else the legacy template_signature declaration read forward
  // (templateSignatureToEsignConfig, §6.1). Never both at once from the reader's
  // point of view: a template that has been saved under the new editor carries
  // its own template_esign_config row, which always wins.
  esignConfig: TemplateEsignConfig
  updatedAt: string
}

type TemplateRow = {
  template_entity_id: string
  name: string | null
  category: string | null
  body: string | null
  doc_kind: string | null
  variables: TemplateVariables | null
  signature: unknown
  esign_config: unknown
  updated_at: Date
}

const TEMPLATE_SELECT = `
  SELECT
    e.id AS template_entity_id,
    (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'template_name' ORDER BY a.valid_from DESC LIMIT 1)     AS name,
    (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'template_category' ORDER BY a.valid_from DESC LIMIT 1) AS category,
    (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'template_body' ORDER BY a.valid_from DESC LIMIT 1)     AS body,
    (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'template_doc_kind' ORDER BY a.valid_from DESC LIMIT 1) AS doc_kind,
    -- json attribute: take the value as-is (the pg driver parses jsonb to an object).
    (SELECT a.value FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'template_variables' ORDER BY a.valid_from DESC LIMIT 1)         AS variables,
    (SELECT a.value FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'template_signature' ORDER BY a.valid_from DESC LIMIT 1)         AS signature,
    (SELECT a.value FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'template_esign_config' ORDER BY a.valid_from DESC LIMIT 1)      AS esign_config,
    e.created_at AS updated_at
  FROM entity e
  JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'template'
  WHERE e.tenant_id = $1 AND e.status = 'active'`

function mapTemplate(r: TemplateRow): StandaloneTemplate {
  const signature = parseTemplateSignature(r.signature)
  return {
    templateEntityId: r.template_entity_id,
    name: r.name ?? '',
    category: r.category === 'email' ? 'email' : 'document',
    body: r.body ?? '',
    docKind: r.doc_kind,
    variables: r.variables ?? {},
    signature,
    esignConfig:
      r.esign_config != null
        ? parseTemplateEsignConfig(r.esign_config)
        : templateSignatureToEsignConfig(signature),
    updatedAt: r.updated_at.toISOString(),
  }
}

export async function listStandaloneTemplates(ctx: ActionContext): Promise<StandaloneTemplate[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<TemplateRow>(`${TEMPLATE_SELECT} ORDER BY name`, [ctx.tenantId])
    return res.rows.map(mapTemplate)
  })
}

export async function getStandaloneTemplate(
  ctx: ActionContext,
  templateEntityId: string,
): Promise<StandaloneTemplate | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<TemplateRow>(`${TEMPLATE_SELECT} AND e.id = $2`, [
      ctx.tenantId,
      templateEntityId,
    ])
    return res.rows[0] ? mapTemplate(res.rows[0]) : null
  })
}
