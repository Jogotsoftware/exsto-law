import {
  submitAction,
  withActionContext,
  type ActionContext,
  type ActionResult,
} from '@exsto/substrate'
import { getTenantSettings, type TenantSettings } from './tenantSettings.js'

// ───────────────────────────────────────────────────────────────────────────
// Firm email signature (fix #10). Read/resolve/write the signature config that
// lives on the firm_profile singleton (migration 0053). resolveEmailSignature is
// the ONE function the central Contract B send path calls — manual sends,
// booking confirmations (S5) and invoice emails (S7) all inherit the result, so
// no consumer reimplements the signature.
//
// "Per-user-capable": the resolver reads the firm-level signature today; a future
// per-attorney override layers in here (read an actor-scoped signature first,
// fall back to the firm one) without a schema change.
// ───────────────────────────────────────────────────────────────────────────

export interface FirmSignature {
  // The stored signature text (null if none has ever been saved).
  signature: string | null
  // Whether the signature is appended to outbound mail.
  enabled: boolean
  // True when `resolved` is the firm-details-derived default (nothing stored yet).
  isDefault: boolean
  // The exact text the send path would append right now ('' when disabled).
  resolved: string
}

interface StoredSignature {
  signature: string | null
  enabled: boolean | null
}

// Latest signature attributes off the firm_profile singleton (null when unset /
// when no firm_profile exists yet).
async function readStored(ctx: ActionContext): Promise<StoredSignature> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ signature: string | null; enabled: string | null }>(
      `WITH fp AS (
         SELECT e.id
           FROM entity e
           JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
          WHERE e.tenant_id = $1 AND ekd.kind_name = 'firm_profile' AND e.status = 'active'
          ORDER BY e.recorded_at ASC
          LIMIT 1
       )
       SELECT
         (SELECT a.value #>> '{}'
            FROM attribute a
            JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
           WHERE a.tenant_id = $1 AND a.entity_id = (SELECT id FROM fp)
             AND akd.kind_name = 'email_signature'
             AND (a.valid_to IS NULL OR a.valid_to > now())
           ORDER BY a.valid_from DESC LIMIT 1) AS signature,
         (SELECT a.value #>> '{}'
            FROM attribute a
            JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
           WHERE a.tenant_id = $1 AND a.entity_id = (SELECT id FROM fp)
             AND akd.kind_name = 'email_signature_enabled'
             AND (a.valid_to IS NULL OR a.valid_to > now())
           ORDER BY a.valid_from DESC LIMIT 1) AS enabled`,
      [ctx.tenantId],
    )
    const row = res.rows[0]
    return {
      signature: row?.signature ?? null,
      enabled: row?.enabled == null ? null : row.enabled === 'true',
    }
  })
}

// A reasonable signature derived from firm contact details — used until the
// attorney saves their own, so outbound mail is signed out of the box.
function deriveDefault(s: TenantSettings): string {
  const lines: string[] = []
  if (s.attorneyName) lines.push(s.attorneyName)
  if (s.firmName) lines.push(s.firmName)
  const contact = [s.firmPhone, s.firmEmail].filter(Boolean).join(' · ')
  if (contact) lines.push(contact)
  if (s.firmAddress) lines.push(s.firmAddress)
  return lines.join('\n')
}

// The signature the send path appends right now. '' means append nothing.
export async function resolveEmailSignature(ctx: ActionContext): Promise<string> {
  const stored = await readStored(ctx)
  // Unset enabled defaults to ON (sign by default); explicit false suppresses.
  if (stored.enabled === false) return ''
  const sig = stored.signature?.trim()
  if (sig) return stored.signature as string
  return deriveDefault(await getTenantSettings(ctx))
}

// Full signature config for the settings editor (raw stored values + a preview
// of what would actually be sent).
export async function getFirmSignature(ctx: ActionContext): Promise<FirmSignature> {
  const stored = await readStored(ctx)
  const enabled = stored.enabled ?? true
  const hasStored = !!stored.signature?.trim()
  const resolved = !enabled
    ? ''
    : hasStored
      ? (stored.signature as string)
      : deriveDefault(await getTenantSettings(ctx))
  return {
    signature: stored.signature,
    enabled,
    isDefault: !hasStored,
    resolved,
  }
}

export interface SetFirmSignatureInput {
  // undefined leaves the text unchanged; '' clears it (falls back to the default).
  signature?: string | null
  // undefined leaves the toggle unchanged.
  enabled?: boolean
}

// Write the signature through the core (legal.firm.signature_set). Returns the
// fresh resolved config so the editor can re-render without a second read.
export async function setFirmSignature(
  ctx: ActionContext,
  input: SetFirmSignatureInput,
): Promise<{ action: ActionResult; signature: FirmSignature }> {
  const action = await submitAction(ctx, {
    actionKindName: 'legal.firm.signature_set',
    intentKind: 'adjustment',
    payload: {
      ...(input.signature !== undefined ? { signature: input.signature } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    },
  })
  return { action, signature: await getFirmSignature(ctx) }
}
