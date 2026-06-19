import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEntity, lookupKindId } from './common.js'

// ───────────────────────────────────────────────────────────────────────────
// Firm email signature (fix #10). The firm_profile singleton (migration 0053)
// holds firm-wide config; here it holds the outbound-email signature + an enabled
// flag. legal.firm.signature_set creates the singleton on first write and
// supersedes its attributes append-only. The signature is applied centrally in
// the Contract B send path (api/mailWorkspace.ts) so every consumer inherits it.
// ───────────────────────────────────────────────────────────────────────────

const FIRM_PROFILE_ENTITY_KIND = 'firm_profile'

// The per-tenant firm_profile is a singleton: find the existing one, or create it.
async function getOrCreateFirmProfile(
  client: DbClient,
  tenantId: string,
  actionId: string,
): Promise<string> {
  const kindId = await lookupKindId(
    client,
    'entity_kind_definition',
    tenantId,
    FIRM_PROFILE_ENTITY_KIND,
  )
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM entity
       WHERE tenant_id = $1 AND entity_kind_id = $2 AND status = 'active'
       ORDER BY recorded_at ASC LIMIT 1`,
    [tenantId, kindId],
  )
  if (existing.rows[0]) return existing.rows[0].id
  return insertEntity(client, tenantId, actionId, kindId, 'Firm profile', {})
}

async function setProfileAttr(
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

interface SignatureSetPayload {
  // The signature text. Empty string clears it; undefined leaves it unchanged.
  signature?: string | null
  // Toggle whether the signature is appended. undefined leaves it unchanged.
  enabled?: boolean
}

registerActionHandler('legal.firm.signature_set', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as SignatureSetPayload
  if (p.signature === undefined && p.enabled === undefined) {
    throw new Error('Nothing to update: provide signature and/or enabled.')
  }

  const firmProfileId = await getOrCreateFirmProfile(client, ctx.tenantId, actionId)

  const updated: string[] = []
  if (p.signature !== undefined) {
    await setProfileAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: firmProfileId,
      kind: 'email_signature',
      value: p.signature ?? '',
    })
    updated.push('email_signature')
  }
  if (p.enabled !== undefined) {
    await setProfileAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: firmProfileId,
      kind: 'email_signature_enabled',
      value: p.enabled,
    })
    updated.push('email_signature_enabled')
  }

  return { firmProfileId, updated }
})
