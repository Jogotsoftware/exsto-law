// legal.matter.set_governing_law (WP A1 — firm jurisdiction data model). Sets or
// clears ONE matter's governing-law override — the `governing_law` attribute
// kind that already exists (vertical seed 0001; matter.open / handlers/intake.ts
// writes an initial 'North Carolina' value at open). This action lets an
// attorney CORRECT it per-matter after the fact (the founder's doctrine:
// jurisdiction is a per-matter fact from intake, editable, with the firm's home
// jurisdiction as fallback — resolveMatterJurisdiction in api/matterJurisdiction.ts
// reads whatever this writes).
//
// Value is normalized to the canonical short code (api/jurisdictions.ts) before
// storage — new writes are always a code, even though older rows (and the
// intake.ts seed) hold the display string 'North Carolina'; the resolver
// normalizes both. Supersession is the established matterAccess.ts pattern:
// close the open row, then insert the new one (append-only fact history).
import { registerActionHandler } from '@exsto/substrate'
import { closeOpenAttribute, insertAttribute, lookupKindId } from './common.js'
import { normalizeJurisdiction } from '../api/jurisdictions.js'

interface MatterSetGoverningLawPayload {
  matter_entity_id?: string
  // '' / null clears the override (resolver falls through to the firm rung).
  governing_law?: string | null
}

// PURE validation/normalization, exported for unit tests (tests/vertical). ''
// clears; any other value must normalize to a canonical US state code or is
// rejected — never silently stored as text the resolver could never match.
export function normalizeGoverningLawValue(raw: string | null | undefined): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (!trimmed) return ''
  const code = normalizeJurisdiction(trimmed)
  if (!code) {
    throw new Error(
      `governing_law must be a valid US state code or name (got "${trimmed}"); leave empty to clear.`,
    )
  }
  return code
}

registerActionHandler('legal.matter.set_governing_law', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as MatterSetGoverningLawPayload
  if (!p.matter_entity_id) {
    throw new Error('matter_entity_id is required')
  }

  const value = normalizeGoverningLawValue(p.governing_law)

  const attrKindId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'governing_law',
  )
  await closeOpenAttribute(client, ctx.tenantId, p.matter_entity_id, attrKindId)
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: p.matter_entity_id,
    attributeKindId: attrKindId,
    value,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: ctx.actorId,
  })

  return { matterEntityId: p.matter_entity_id, governingLaw: value || null }
})
