import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEntity, lookupKindId } from './common.js'
import { isSignatureImageDataUrl } from '../esign/fields.js'

// ───────────────────────────────────────────────────────────────────────────
// Attorney standing signature (P15). Attributes can only attach to entities —
// never actor rows — so the signature lives on a per-attorney `attorney_profile`
// entity (migration 0161) bound to its actor by the `profile_actor_id`
// attribute, the exact client_contact↔portal_actor_id precedent
// (handlers/clientPortalActor.ts). legal.attorney.signature_set creates the
// profile on first write and supersedes the `attorney_signature` attribute
// append-only — the legal.firm.signature_set pattern (handlers/firmSignature.ts)
// made per-actor instead of per-tenant.
// ───────────────────────────────────────────────────────────────────────────

const ATTORNEY_PROFILE_ENTITY_KIND = 'attorney_profile'

// The attribute table is append-only: every oversized re-save would live there
// forever, so drawn/uploaded images are capped at the invoice-logo limit
// (500 KB of decoded image bytes — settings/page.tsx caps the file the same way
// before encoding).
const MAX_SIGNATURE_IMAGE_BYTES = 500_000

export type AttorneySignatureMode = 'typed' | 'drawn' | 'uploaded'

const MODES: AttorneySignatureMode[] = ['typed', 'drawn', 'uploaded']

// Decoded byte length of a base64 payload (¾ of the char count, minus padding).
function base64DecodedBytes(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - padding
}

// The per-actor attorney_profile is a singleton: find the profile bound to this
// actor via the profile_actor_id attribute, or create it through this action.
async function getOrCreateAttorneyProfile(
  client: DbClient,
  tenantId: string,
  actionId: string,
  actorId: string,
): Promise<string> {
  // Serialize concurrent first-writes for one actor: two parallel saves would both
  // see no profile and mint two singletons, silently stranding one signature on
  // the row no reader picks. The xact-scoped lock is held on the action's own
  // transaction, so it releases at commit with no unlock bookkeeping.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `${tenantId}:attorney_profile:${actorId}`,
  ])
  const existing = await client.query<{ id: string }>(
    `SELECT e.id
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       JOIN attribute b ON b.entity_id = e.id AND b.tenant_id = e.tenant_id
       JOIN attribute_kind_definition bkd ON bkd.id = b.attribute_kind_id
      WHERE e.tenant_id = $1 AND ekd.kind_name = $2 AND e.status = 'active'
        AND bkd.kind_name = 'profile_actor_id'
        AND b.value #>> '{}' = $3
        AND (b.valid_to IS NULL OR b.valid_to > now())
      ORDER BY e.recorded_at ASC LIMIT 1`,
    [tenantId, ATTORNEY_PROFILE_ENTITY_KIND, actorId],
  )
  if (existing.rows[0]) return existing.rows[0].id

  const kindId = await lookupKindId(
    client,
    'entity_kind_definition',
    tenantId,
    ATTORNEY_PROFILE_ENTITY_KIND,
  )
  const actor = await client.query<{ display_name: string | null }>(
    `SELECT display_name FROM actor WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [actorId, tenantId],
  )
  const displayName = actor.rows[0]?.display_name?.trim()
  const entityId = await insertEntity(
    client,
    tenantId,
    actionId,
    kindId,
    displayName ? `Attorney profile (${displayName})` : 'Attorney profile',
    {},
  )
  const bindKindId = await lookupKindId(
    client,
    'attribute_kind_definition',
    tenantId,
    'profile_actor_id',
  )
  await insertAttribute(client, {
    tenantId,
    actionId,
    entityId,
    attributeKindId: bindKindId,
    value: actorId,
    confidence: 1.0,
    sourceType: 'system',
    sourceRef: 'system:attorney_profile_provisioning',
  })
  return entityId
}

interface AttorneySignatureSetPayload {
  mode?: string
  // Required (non-empty) for typed; optional label for drawn/uploaded.
  name?: string | null
  // PNG/JPEG base64 data URL for drawn/uploaded; ignored (stored null) for typed.
  data?: string | null
}

registerActionHandler('legal.attorney.signature_set', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as AttorneySignatureSetPayload

  const mode = p.mode as AttorneySignatureMode
  if (!MODES.includes(mode)) {
    throw new Error(`mode must be one of ${MODES.join(', ')}.`)
  }
  const name = typeof p.name === 'string' ? p.name.trim() : ''
  let data: string | null = null
  if (mode === 'typed') {
    if (!name) throw new Error('A typed signature needs a non-empty name.')
  } else {
    if (typeof p.data !== 'string' || !isSignatureImageDataUrl(p.data)) {
      throw new Error(`A ${mode} signature needs a PNG or JPEG base64 data URL.`)
    }
    const b64 = p.data.slice(p.data.indexOf(',') + 1)
    if (base64DecodedBytes(b64) > MAX_SIGNATURE_IMAGE_BYTES) {
      throw new Error('Signature image is too large — use an image under 500 KB.')
    }
    data = p.data
  }

  const attorneyProfileId = await getOrCreateAttorneyProfile(
    client,
    ctx.tenantId,
    actionId,
    ctx.actorId,
  )

  const sigKindId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'attorney_signature',
  )
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: attorneyProfileId,
    attributeKindId: sigKindId,
    value: { mode, name, data },
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: ctx.actorId,
  })

  return { attorneyProfileId, mode }
})
