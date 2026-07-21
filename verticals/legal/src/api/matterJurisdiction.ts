// Matter jurisdiction resolver (WP A1 — firm jurisdiction data model).
//
// Founder doctrine: jurisdiction is a PER-MATTER fact (from the client's intake),
// with the firm's home jurisdiction as fallback, honest-unset otherwise. Services
// stay jurisdiction-agnostic — there is deliberately NO service rung. This module
// is DATA MODEL + READ ONLY: it resolves what the jurisdiction IS. De-hardcoding
// the AI generation consumers (generateDraft / generateEmail / reviewDocument /
// reviseDraft / assistantChat, all still hardcode 'NC') is a later WP — nothing
// here changes their behavior.
//
// Resolution order:
//   1. the matter's latest `governing_law` attribute (matter.open / intake.ts
//      already writes this — historically the display string 'North Carolina';
//      new writes via legal.matter.set_governing_law store the short code).
//   2. the matter's PRIMARY CLIENT CONTACT's on-file `address` — the state parsed
//      deterministically from the address tail (WF-FIX-2 #3, founder: "still
//      defaulting everything to NC law instead of the client's address"). No
//      model call: parseUsStateFromAddress matches an exact code/full name at the
//      standard position, else this rung is silent.
//   3. the firm_profile singleton's `firm_jurisdiction` attribute.
//   4. null — an honest "not set", never a guessed default.
//
// All rungs are read directly (not through lookupKindId, which THROWS when a
// kind is missing): a plain kind_name join naturally returns zero rows when the
// attribute kind doesn't exist yet, which is exactly the "migration not applied"
// degrade-to-next-rung case this must tolerate without throwing.
import {
  submitAction,
  withActionContext,
  type ActionContext,
  type ActionResult,
} from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import {
  normalizeJurisdiction,
  jurisdictionDisplayName,
  parseUsStateFromAddress,
} from './jurisdictions.js'

export interface ResolvedJurisdiction {
  code: string
  displayName: string
  source: 'matter' | 'client_address' | 'firm'
}

async function readLatestAttributeText(
  client: DbClient,
  tenantId: string,
  entityId: string,
  attributeKindName: string,
): Promise<string | null> {
  const res = await client.query<{ value: string | null }>(
    `SELECT a.value #>> '{}' AS value
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
      WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = $3
        AND (a.valid_to IS NULL OR a.valid_to > now())
      ORDER BY a.valid_from DESC
      LIMIT 1`,
    [tenantId, entityId, attributeKindName],
  )
  return res.rows[0]?.value ?? null
}

// The firm_profile singleton's firm_jurisdiction, or null when either the
// singleton doesn't exist yet or the attribute was never set (or the
// firm_jurisdiction attribute kind itself doesn't exist yet — pre-migration).
async function readFirmJurisdiction(client: DbClient, tenantId: string): Promise<string | null> {
  const res = await client.query<{ value: string | null }>(
    `WITH fp AS (
       SELECT e.id
         FROM entity e
         JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
        WHERE e.tenant_id = $1 AND ekd.kind_name = 'firm_profile' AND e.status = 'active'
        ORDER BY e.recorded_at ASC
        LIMIT 1
     )
     SELECT a.value #>> '{}' AS value
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
      WHERE a.tenant_id = $1 AND a.entity_id = (SELECT id FROM fp)
        AND akd.kind_name = 'firm_jurisdiction'
        AND (a.valid_to IS NULL OR a.valid_to > now())
      ORDER BY a.valid_from DESC
      LIMIT 1`,
    [tenantId],
  )
  return res.rows[0]?.value ?? null
}

// The matter's primary client contact's on-file `address` (latest open value), or
// null. The primary contact is the other end of the matter's client link, written
// under either historical direction — `client_of` (contact → matter, the
// intake/booking path) or `matter_has_client` (matter → contact, matter.open) — so
// resolve both, newest link first (mirrors queries/contacts.ts). Read directly by
// kind_name: a missing `address` attribute kind returns zero rows, not a throw.
async function readClientAddress(
  client: DbClient,
  tenantId: string,
  matterEntityId: string,
): Promise<string | null> {
  const res = await client.query<{ value: string | null }>(
    `WITH contact AS (
       SELECT CASE WHEN r.source_entity_id = $2 THEN r.target_entity_id
                   ELSE r.source_entity_id END AS id
         FROM relationship r
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
        WHERE r.tenant_id = $1
          AND rkd.kind_name IN ('client_of', 'matter_has_client')
          AND (r.valid_to IS NULL OR r.valid_to > now())
          AND (r.source_entity_id = $2 OR r.target_entity_id = $2)
        ORDER BY r.recorded_at DESC
        LIMIT 1
     )
     SELECT a.value #>> '{}' AS value
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
      WHERE a.tenant_id = $1 AND a.entity_id = (SELECT id FROM contact)
        AND akd.kind_name = 'address'
        AND (a.valid_to IS NULL OR a.valid_to > now())
      ORDER BY a.valid_from DESC
      LIMIT 1`,
    [tenantId, matterEntityId],
  )
  return res.rows[0]?.value ?? null
}

function toResolved(
  raw: string | null,
  source: ResolvedJurisdiction['source'],
): ResolvedJurisdiction | null {
  const code = normalizeJurisdiction(raw)
  if (!code) return null
  return { code, displayName: jurisdictionDisplayName(code) ?? code, source }
}

// The client-address rung: the raw is a full postal address, so parse the state
// from its tail first (never a bare code like the matter/firm rungs). Unparseable
// ⇒ null ⇒ the chain falls through to firm.
function toResolvedFromAddress(rawAddress: string | null): ResolvedJurisdiction | null {
  const code = parseUsStateFromAddress(rawAddress)
  if (!code) return null
  return { code, displayName: jurisdictionDisplayName(code) ?? code, source: 'client_address' }
}

// PURE resolution chain — matter beats client address beats firm beats honest
// null — over already-fetched raw values. Split out from the DB read so it is
// unit-testable with zero fixtures (tests/vertical/jurisdiction-resolver.test.ts):
// a raw value that doesn't normalize/parse (garbage, or simply null because
// nothing was found — kind missing, singleton missing, no contact, or genuinely
// never set) falls through to the next rung exactly like an honest "not set"
// would. `clientAddressRaw` is a FULL address string (parsed here), not a bare
// state code like the matter/firm rungs.
export function resolveJurisdictionChain(
  matterRaw: string | null,
  clientAddressRaw: string | null,
  firmRaw: string | null,
): ResolvedJurisdiction | null {
  return (
    toResolved(matterRaw, 'matter') ??
    toResolvedFromAddress(clientAddressRaw) ??
    toResolved(firmRaw, 'firm')
  )
}

// Client-scoped variant — for callers (e.g. getMatter) that already hold an
// open, tenant-bound client. Short-circuits the firm read when the matter's own
// fact already resolves (one round trip, not two, in the common case).
export async function resolveMatterJurisdictionWithClient(
  client: DbClient,
  tenantId: string,
  matterEntityId: string | null,
): Promise<ResolvedJurisdiction | null> {
  const matterRaw = matterEntityId
    ? await readLatestAttributeText(client, tenantId, matterEntityId, 'governing_law')
    : null
  const fromMatter = resolveJurisdictionChain(matterRaw, null, null)
  if (fromMatter) return fromMatter
  // Client-address rung before firm (founder directive): the client's on-file
  // state governs before the firm's home jurisdiction. Only read when the matter
  // fact didn't already resolve (keeps the common case to one round trip).
  const clientAddressRaw = matterEntityId
    ? await readClientAddress(client, tenantId, matterEntityId)
    : null
  const fromAddress = resolveJurisdictionChain(null, clientAddressRaw, null)
  if (fromAddress) return fromAddress
  const firmRaw = await readFirmJurisdiction(client, tenantId)
  return resolveJurisdictionChain(null, null, firmRaw)
}

// Public ctx-based resolver (the shape later WPs de-hardcoding the AI consumers
// will call): matter fact beats firm fact beats honest null. No service rung.
export async function resolveMatterJurisdiction(
  ctx: ActionContext,
  matterEntityId: string | null,
): Promise<ResolvedJurisdiction | null> {
  return withActionContext(ctx, (client) =>
    resolveMatterJurisdictionWithClient(client, ctx.tenantId, matterEntityId),
  )
}

// Set (or clear, with an empty/whitespace value) ONE matter's governing_law
// override. Normalizes to the canonical code in the handler
// (handlers/matterJurisdiction.ts) — the established matterAccess.ts
// closeOpen-then-insert supersession pattern.
export async function setMatterGoverningLaw(
  ctx: ActionContext,
  input: { matterEntityId: string; governingLaw: string | null },
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'legal.matter.set_governing_law',
    intentKind: 'adjustment',
    payload: { matter_entity_id: input.matterEntityId, governing_law: input.governingLaw },
  })
}
