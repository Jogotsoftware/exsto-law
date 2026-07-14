import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

// ───────────────────────────────────────────────────────────────────────────
// Attorney standing signature (P15) — read/resolve/write around the per-actor
// attorney_profile singleton (migration 0161). The profile is bound to its
// actor by the profile_actor_id attribute (attributes cannot attach to actor
// rows); the signature itself is ONE `attorney_signature` jsonb attribute
// { mode, name, data }, superseded append-only through
// legal.attorney.signature_set (handlers/attorneySignature.ts). Mirrors
// api/firmSignature.ts, keyed per actor instead of per tenant.
// ───────────────────────────────────────────────────────────────────────────

export type AttorneySignatureMode = 'typed' | 'drawn' | 'uploaded'

export interface AttorneySignature {
  mode: AttorneySignatureMode
  // The signer's name as typed when the signature was saved ('' for image
  // signatures saved without one).
  name: string
  // PNG/JPEG base64 data URL for drawn/uploaded; null for typed.
  data: string | null
}

const MODES: AttorneySignatureMode[] = ['typed', 'drawn', 'uploaded']

// Defensive parse of the stored jsonb — a malformed value reads as "no saved
// signature" rather than crashing every consumer of the seam.
function parseSignature(raw: unknown): AttorneySignature | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { mode?: unknown; name?: unknown; data?: unknown }
  if (typeof o.mode !== 'string' || !MODES.includes(o.mode as AttorneySignatureMode)) return null
  return {
    mode: o.mode as AttorneySignatureMode,
    name: typeof o.name === 'string' ? o.name : '',
    data: typeof o.data === 'string' && o.data ? o.data : null,
  }
}

// The latest saved signature for an attorney actor (defaults to the signed-in
// one), or null when they have never saved one. Resolves the attorney_profile
// entity by its profile_actor_id binding, then reads the latest
// attorney_signature attribute.
export async function getAttorneySignature(
  ctx: ActionContext,
  actorId: string = ctx.actorId,
): Promise<AttorneySignature | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ value: unknown }>(
      `WITH ap AS (
         SELECT e.id
           FROM entity e
           JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
           JOIN attribute b ON b.entity_id = e.id AND b.tenant_id = e.tenant_id
           JOIN attribute_kind_definition bkd ON bkd.id = b.attribute_kind_id
          WHERE e.tenant_id = $1 AND ekd.kind_name = 'attorney_profile' AND e.status = 'active'
            AND bkd.kind_name = 'profile_actor_id'
            AND b.value #>> '{}' = $2
            AND (b.valid_to IS NULL OR b.valid_to > now())
          ORDER BY e.recorded_at ASC
          LIMIT 1
       )
       SELECT a.value
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
        WHERE a.tenant_id = $1 AND a.entity_id = (SELECT id FROM ap)
          AND akd.kind_name = 'attorney_signature'
          AND (a.valid_to IS NULL OR a.valid_to > now())
        ORDER BY a.valid_from DESC
        LIMIT 1`,
      [ctx.tenantId, actorId],
    )
    return parseSignature(res.rows[0]?.value ?? null)
  })
}

// The signed-in attorney's account email. A human actor's email IS its
// external_id (api/identity.ts) — the sign pages use this to prefill the saved
// signature only on the attorney's OWN signature request.
export async function getAttorneyActorEmail(ctx: ActionContext): Promise<string | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ external_id: string | null }>(
      `SELECT external_id FROM actor
        WHERE id = $1 AND tenant_id = $2 AND status = 'active'
        LIMIT 1`,
      [ctx.actorId, ctx.tenantId],
    )
    const email = res.rows[0]?.external_id ?? null
    // Client portal actors carry a synthetic 'client:<id>' external_id — never
    // report those as an email.
    return email && email.includes('@') ? email : null
  })
}

export interface SetAttorneySignatureInput {
  mode: AttorneySignatureMode
  // Required (non-empty) for typed; optional for drawn/uploaded.
  name?: string | null
  // PNG/JPEG base64 data URL, under 500 KB decoded, for drawn/uploaded.
  data?: string | null
}

// Write the signature through the core (legal.attorney.signature_set). Returns
// the fresh saved value so the editor re-renders without a second read.
export async function setAttorneySignature(
  ctx: ActionContext,
  input: SetAttorneySignatureInput,
): Promise<AttorneySignature | null> {
  await submitAction(ctx, {
    actionKindName: 'legal.attorney.signature_set',
    intentKind: 'adjustment',
    payload: {
      mode: input.mode,
      name: input.name ?? null,
      data: input.data ?? null,
    },
  })
  return getAttorneySignature(ctx)
}
