// ESIGN-UNIFY-1 ES-3 (§6.4) — intake → auto-bind. Generation already merges
// {{tokens}} and emits the SIG-BLOCK-1 markers; buildExecutionBlock already
// prints resolved names. The NEW piece is ENVELOPE ASSEMBLY: given a matter and
// a template's e-sign config, resolve each role's `bind` to a real recipient so
// a generated signable document opens the composer with recipients resolved AND
// fields pre-placed — e-sign-ready with zero manual setup (the 15.20d bar).
//
// Resolution per bind kind:
//   • matter_primary_contact — the matter's client contact (client_of source →
//     matter target, latest open relationship — the same traversal
//     capabilityRuntime/clientMessaging use), then its full_name/email/title.
//   • attorney_of_record — the matter's OWNER (matter_owner attribute via
//     getMatterAccess), falling back to the firm's default matter owner
//     (resolveDefaultMatterOwner — the practicing attorney), read as an actor
//     row (display_name + external_id email). Never a FIRM_DEFAULTS identity:
//     an unresolvable attorney yields an EMPTY row the attorney fills, exactly
//     like the anti-forgery rule in tenantSettings.ts:244 — we never invent.
//   • contact_role:<name> — forward-compatible: resolves through a relationship
//     of that kind_name pointing AT the matter, if the firm has defined one; no
//     such kind is seeded today, so this degrades to an empty/manual row.
//   • manual — always an empty row the attorney fills in the composer.
//
// Pure READ layer: writes nothing; the composer submits the ONE esign.send when
// the attorney confirms (§2 principle 4 — no draft envelopes).
import { withActionContext, type ActionContext } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { getMatterAccess, resolveDefaultMatterOwner } from './matterAccess.js'
import type { TemplateEsignConfig, EsignRecipientRole } from '../queries/templates.js'

// One resolved recipient row for the composer. `signerKey` ties the row back to
// the body's {{type:key}} markers (and the placements derived from them);
// `resolved` is the honesty flag — false means the bind found nobody and the
// attorney must fill the row before Send (the composer's per-step validation
// already blocks a needs_to_sign row without an email).
export interface ResolvedEsignRecipient {
  signerKey: string
  label: string
  role: EsignRecipientRole
  order: number
  bind: string
  resolved: boolean
  name: string | null
  email: string | null
  title: string | null
  // Set when the recipient is a known CRM contact — lets the composer attach
  // the envelope (document_of_contact) and the typeahead show the match.
  contactEntityId: string | null
}

export interface ResolvedIdentity {
  name: string | null
  email: string | null
  title: string | null
  contactEntityId: string | null
}

const EMPTY_IDENTITY: ResolvedIdentity = {
  name: null,
  email: null,
  title: null,
  contactEntityId: null,
}

// Latest open value of one attribute on one entity (bitemporal read discipline).
async function attrValue(
  client: DbClient,
  tenantId: string,
  entityId: string,
  kindName: string,
): Promise<string | null> {
  const res = await client.query<{ value: string | null }>(
    `SELECT a.value #>> '{}' AS value
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
      WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = $3
      ORDER BY a.valid_from DESC LIMIT 1`,
    [tenantId, entityId, kindName],
  )
  return res.rows[0]?.value ?? null
}

// The matter's client contact: the source of the latest open client_of
// relationship targeting the matter (same query capabilityRuntime.ts:619 uses).
async function resolvePrimaryContactId(
  client: DbClient,
  tenantId: string,
  matterEntityId: string,
): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    `SELECT r.source_entity_id AS id
       FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
      WHERE r.tenant_id = $1 AND r.target_entity_id = $2
        AND rkd.kind_name = 'client_of'
        AND (r.valid_to IS NULL OR r.valid_to > now())
      ORDER BY r.recorded_at DESC LIMIT 1`,
    [tenantId, matterEntityId],
  )
  return res.rows[0]?.id ?? null
}

async function contactIdentity(
  client: DbClient,
  tenantId: string,
  contactEntityId: string,
): Promise<ResolvedIdentity> {
  const [name, email, title] = await Promise.all([
    attrValue(client, tenantId, contactEntityId, 'full_name'),
    attrValue(client, tenantId, contactEntityId, 'email'),
    attrValue(client, tenantId, contactEntityId, 'title'),
  ])
  return { name, email, title, contactEntityId }
}

// A named contact-role relationship pointing at the matter (contact_role:<name>
// binds). No such kind is seeded today; when a firm defines one (kind.define /
// a future migration), this resolves it with no code change — configuration as
// data. Unknown kind name simply finds no rows → empty identity.
async function resolveContactByRole(
  client: DbClient,
  tenantId: string,
  matterEntityId: string,
  roleKindName: string,
): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    `SELECT r.source_entity_id AS id
       FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
      WHERE r.tenant_id = $1 AND r.target_entity_id = $2
        AND rkd.kind_name = $3
        AND (r.valid_to IS NULL OR r.valid_to > now())
      ORDER BY r.recorded_at DESC LIMIT 1`,
    [tenantId, matterEntityId, roleKindName],
  )
  return res.rows[0]?.id ?? null
}

// The attorney handling the matter, as a recipient identity: the matter owner
// actor when set, else the firm's default matter owner. Actor rows carry
// display_name + external_id (the login email). NEVER FIRM_DEFAULTS.
async function attorneyIdentity(
  ctx: ActionContext,
  client: DbClient,
  matterEntityId: string,
): Promise<ResolvedIdentity> {
  const access = await getMatterAccess(ctx, matterEntityId)
  const actorId = access.ownerActorId ?? (await resolveDefaultMatterOwner(ctx.tenantId))
  if (!actorId) return { ...EMPTY_IDENTITY }
  const res = await client.query<{ display_name: string | null; external_id: string | null }>(
    `SELECT display_name, external_id
       FROM actor
      WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
    [ctx.tenantId, actorId],
  )
  const row = res.rows[0]
  if (!row) return { ...EMPTY_IDENTITY }
  return {
    name: row.display_name ?? null,
    email: row.external_id ?? null,
    title: null,
    contactEntityId: null,
  }
}

// A bind resolver: given a role's bind kind, produce the identity (or the empty
// one). The DB-backed resolver lives in resolveTemplateRecipients below;
// injecting it keeps the per-rule assembly PURE and unit-testable without a DB.
export type EsignBindResolver = (bind: string) => Promise<ResolvedIdentity>

// The pure assembly core: role rows → recipient rows via the injected resolver,
// then a STABLE ascending-order sort (ties keep config order — parallel groups
// stay adjacent). 'manual' never consults the resolver; a bind that resolves
// nothing degrades to an unresolved (attorney-fillable) row — never invented.
export async function assembleRecipientRows(
  roles: TemplateEsignConfig['roles'],
  resolveBind: EsignBindResolver,
): Promise<ResolvedEsignRecipient[]> {
  const out: ResolvedEsignRecipient[] = []
  for (const role of roles) {
    const identity: ResolvedIdentity =
      role.bind === 'manual' ? { ...EMPTY_IDENTITY } : await resolveBind(role.bind)
    out.push({
      signerKey: role.key,
      label: role.label,
      role: role.recipientRole,
      order: role.order,
      bind: role.bind,
      // An email is what delivery needs; a name alone isn't a deliverable
      // recipient, so `resolved` demands the email.
      resolved: !!identity.email,
      name: identity.name,
      email: identity.email,
      title: identity.title,
      contactEntityId: identity.contactEntityId,
    })
  }
  // Stable sort: ascending order, ties keep config order.
  return out
    .map((r, i) => [r, i] as const)
    .sort(([a, ai], [b, bi]) => a.order - b.order || ai - bi)
    .map(([r]) => r)
}

export interface ResolveTemplateRecipientsInput {
  matterEntityId: string
  config: TemplateEsignConfig
}

// §6.4 — the envelope-assembly resolver. Per role, resolve `bind` against the
// matter. An unsignable config resolves to [] — the caller (composer /
// workflow e-sign step) treats that as "nothing to pre-fill".
export async function resolveTemplateRecipients(
  ctx: ActionContext,
  input: ResolveTemplateRecipientsInput,
): Promise<ResolvedEsignRecipient[]> {
  const { matterEntityId, config } = input
  if (!config.signable || config.roles.length === 0) return []
  return withActionContext(ctx, async (client) => {
    // The primary contact resolves once and serves every role bound to it.
    let primaryContact: ResolvedIdentity | null = null
    const getPrimaryContact = async (): Promise<ResolvedIdentity> => {
      if (primaryContact) return primaryContact
      const id = await resolvePrimaryContactId(client, ctx.tenantId, matterEntityId)
      primaryContact = id ? await contactIdentity(client, ctx.tenantId, id) : { ...EMPTY_IDENTITY }
      return primaryContact
    }
    const resolveBind: EsignBindResolver = async (bind) => {
      if (bind === 'matter_primary_contact') return getPrimaryContact()
      if (bind === 'attorney_of_record') return attorneyIdentity(ctx, client, matterEntityId)
      if (bind.startsWith('contact_role:')) {
        const kindName = bind.slice('contact_role:'.length)
        const id = kindName
          ? await resolveContactByRole(client, ctx.tenantId, matterEntityId, kindName)
          : null
        return id ? contactIdentity(client, ctx.tenantId, id) : { ...EMPTY_IDENTITY }
      }
      return { ...EMPTY_IDENTITY }
    }
    return assembleRecipientRows(config.roles, resolveBind)
  })
}
