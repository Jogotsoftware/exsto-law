import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEntity, lookupKindId } from './common.js'

// ───────────────────────────────────────────────────────────────────────────
// Firm profile fields (P13). The firm_profile singleton (migration 0053) holds
// firm-wide config; migration 0161 adds the identity attribute kinds
// (firm_name / firm_address / firm_phone / firm_email) that generated documents
// resolve as SYSTEM merge slots. legal.firm.set_profile creates the singleton on
// first write and supersedes its attributes append-only — the exact
// legal.firm.signature_set pattern (handlers/firmSignature.ts).
// ───────────────────────────────────────────────────────────────────────────

const FIRM_PROFILE_ENTITY_KIND = 'firm_profile'

// The per-tenant firm_profile is a singleton: find the existing one, or create it.
async function getOrCreateFirmProfile(
  client: DbClient,
  tenantId: string,
  actionId: string,
): Promise<string> {
  // Serialize concurrent first-writes: two parallel saves would both see no
  // profile and mint two singletons (one save's attributes land on the row no
  // reader picks). Xact-scoped, so the lock releases at the action's commit.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${tenantId}:firm_profile`])
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

interface FirmProfileSetPayload {
  // Each field: undefined leaves it unchanged; null/'' clears it.
  firm_name?: string | null
  firm_address?: string | null
  firm_phone?: string | null
  firm_email?: string | null
}

const PROFILE_FIELDS = ['firm_name', 'firm_address', 'firm_phone', 'firm_email'] as const

registerActionHandler('legal.firm.set_profile', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as FirmProfileSetPayload
  const provided = PROFILE_FIELDS.filter((k) => p[k] !== undefined)
  if (provided.length === 0) {
    throw new Error(
      'Nothing to update: provide at least one of firm_name, firm_address, firm_phone, firm_email.',
    )
  }

  const firmProfileId = await getOrCreateFirmProfile(client, ctx.tenantId, actionId)

  const updated: string[] = []
  for (const kind of provided) {
    // Stored as a trimmed string; '' means "cleared" (readers report it as null).
    await setProfileAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: firmProfileId,
      kind,
      value: (p[kind] ?? '').trim(),
    })
    updated.push(kind)
  }

  return { firmProfileId, updated }
})
