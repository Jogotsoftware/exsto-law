import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEntity, lookupKindId } from './common.js'
import { normalizeJurisdiction } from '../api/jurisdictions.js'

// ───────────────────────────────────────────────────────────────────────────
// Firm profile fields (P13, + WP A1). The firm_profile singleton (migration 0053)
// holds firm-wide config; migration 0161 adds the identity attribute kinds
// (firm_name / firm_address / firm_phone / firm_email) that generated documents
// resolve as SYSTEM merge slots. Migration 0170 (WP A1) adds firm_jurisdiction /
// practice_areas / attorney_name — the firm's home jurisdiction (matter>firm>
// unset resolver fallback rung), practice areas, and lead attorney display name.
// legal.firm.set_profile creates the singleton on first write and supersedes its
// attributes append-only — the exact legal.firm.signature_set pattern
// (handlers/firmSignature.ts).
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
  // Each field: undefined leaves it unchanged; null/'' (null/[] for
  // practice_areas) clears it.
  firm_name?: string | null
  firm_address?: string | null
  firm_phone?: string | null
  firm_email?: string | null
  firm_jurisdiction?: string | null
  practice_areas?: unknown
  attorney_name?: string | null
}

const PROFILE_FIELDS = [
  'firm_name',
  'firm_address',
  'firm_phone',
  'firm_email',
  'firm_jurisdiction',
  'practice_areas',
  'attorney_name',
] as const

type ProfileField = (typeof PROFILE_FIELDS)[number]

// PURE validation/normalization, exported for unit tests (tests/vertical). Text
// fields are stored trimmed; '' means "cleared" (readers report it as null).
// firm_jurisdiction must normalize to a canonical US state code (or be empty, to
// clear) — an unrecognized value is rejected rather than silently stored garbage
// a resolver could never match. practice_areas is deduped, trimmed, empty-string
// entries dropped; a non-array input clears the field (fails safe, not silently
// keeps a stale array).
export function normalizeFirmProfileFieldValue(kind: ProfileField, raw: unknown): unknown {
  if (kind === 'practice_areas') {
    if (!Array.isArray(raw)) return []
    const seen = new Set<string>()
    const areas: string[] = []
    for (const entry of raw) {
      if (typeof entry !== 'string') continue
      const trimmed = entry.trim()
      if (!trimmed || seen.has(trimmed.toLowerCase())) continue
      seen.add(trimmed.toLowerCase())
      areas.push(trimmed)
    }
    return areas
  }
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (kind === 'firm_jurisdiction' && text) {
    const code = normalizeJurisdiction(text)
    if (!code) {
      throw new Error(
        `firm_jurisdiction must be a valid US state code or name (got "${text}"); leave empty to clear.`,
      )
    }
    return code
  }
  return text
}

registerActionHandler('legal.firm.set_profile', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as FirmProfileSetPayload
  const provided = PROFILE_FIELDS.filter((k) => p[k] !== undefined)
  if (provided.length === 0) {
    throw new Error(
      'Nothing to update: provide at least one of firm_name, firm_address, firm_phone, firm_email, firm_jurisdiction, practice_areas, attorney_name.',
    )
  }

  // Validate/normalize every field BEFORE any write — a rejected value (e.g. an
  // unrecognized jurisdiction) must leave every field in this call untouched, not
  // just the ones processed before it (the transaction rolls back either way, but
  // failing fast here keeps the intent obvious).
  const values = new Map<ProfileField, unknown>()
  for (const kind of provided) {
    values.set(kind, normalizeFirmProfileFieldValue(kind, p[kind]))
  }

  const firmProfileId = await getOrCreateFirmProfile(client, ctx.tenantId, actionId)

  const updated: string[] = []
  for (const kind of provided) {
    await setProfileAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: firmProfileId,
      kind,
      value: values.get(kind),
    })
    updated.push(kind)
  }

  return { firmProfileId, updated }
})
