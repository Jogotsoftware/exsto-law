// CLIENT-PORTAL-UI-1 (WP-6, migration 0161) — the firm-level engagement
// agreement, founder-decided model: ONE agreement per client (standard hourly
// rate + the firm's terms), signed once; client-initiated messaging and booking
// unlock and stay unlocked. The existing PER-QUOTE fee consent (0135) is
// untouched — it covers service fees; this covers hourly messaging/booking.
//
// The acceptance echoes the CURRENT firm rate + terms version, both resolved
// server-side inside the handler's transaction — the client never supplies
// either (same trust rule as the fee-quote decision handler). Enforcement is
// api/engagement.ts assertEngagementAccepted at the operation core, not the UI.
//
// portal.notification.read (WP-3) is the append-only read-state watermark: the
// action row IS the fact; unread = feed items newer than the latest watermark.
import { registerActionHandler, type ActionEffectHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEvent, lookupKindId, getLatestAttributeValue } from './common.js'
import { ensureFirmSettings, readFirmDefaultRate } from './firmSettings.js'

export interface EngagementTermsValue {
  text: string
  version: number
  published_at: string
}

const TERMS_MAX_CHARS = 20_000

// Handler-side read of the current terms, within an open transaction. The api
// reader (api/engagement.ts) wraps this in withActionContext.
export async function readEngagementTerms(
  client: DbClient,
  tenantId: string,
): Promise<EngagementTermsValue | null> {
  const res = await client.query<{ value: EngagementTermsValue | null }>(
    `SELECT a.value
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       JOIN entity e ON e.id = a.entity_id
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
      WHERE a.tenant_id = $1
        AND akd.kind_name = 'engagement_terms'
        AND ekd.kind_name = 'firm_settings'
        AND (a.valid_to IS NULL OR a.valid_to > now())
      ORDER BY a.valid_from DESC
      LIMIT 1`,
    [tenantId],
  )
  const v = res.rows[0]?.value
  if (!v || typeof v.text !== 'string' || !v.text.trim()) return null
  return { text: v.text, version: Number(v.version) || 1, published_at: String(v.published_at) }
}

registerActionHandler('legal.firm.set_engagement_terms', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as { text?: string }
  const text = (p.text ?? '').trim()
  if (!text) throw new Error('Engagement terms text is required.')
  if (text.length > TERMS_MAX_CHARS) {
    throw new Error(`Engagement terms are too long (max ${TERMS_MAX_CHARS} characters).`)
  }

  const prior = await readEngagementTerms(client, ctx.tenantId)
  const version = (prior?.version ?? 0) + 1
  const firmSettingsId = await ensureFirmSettings(client, ctx.tenantId, actionId)
  const akId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'engagement_terms',
  )
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: firmSettingsId,
    attributeKindId: akId,
    value: { text, version, published_at: new Date().toISOString() },
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: ctx.actorId,
  })
  return { firm_settings_id: firmSettingsId, version }
})

interface EngagementDecisionPayload {
  client_contact_id: string
}

async function assertActiveClientContact(
  client: DbClient,
  tenantId: string,
  clientContactId: string,
): Promise<void> {
  const res = await client.query(
    `SELECT 1 FROM entity e
     JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
     WHERE e.id = $1 AND e.tenant_id = $2
       AND ekd.kind_name = 'client_contact' AND e.status = 'active'`,
    [clientContactId, tenantId],
  )
  if (res.rowCount === 0) throw new Error('Unknown client contact.')
}

function engagementDecisionHandler(
  eventKindName: 'engagement.accepted' | 'engagement.declined',
): ActionEffectHandler {
  return async (ctx, client, payload, actionId) => {
    const p = payload as unknown as EngagementDecisionPayload
    if (!p.client_contact_id) throw new Error('client_contact_id is required.')
    await assertActiveClientContact(client, ctx.tenantId, p.client_contact_id)

    // The decision binds to the CURRENT firm config, resolved server-side in
    // this transaction — never to values the client sent. Accepting with no
    // published terms or no configured rate is refused: there is nothing real
    // to consent to, and a rate-less acceptance would be an empty receipt.
    const rate = await readFirmDefaultRate(client, ctx.tenantId)
    const terms = await readEngagementTerms(client, ctx.tenantId)
    if (eventKindName === 'engagement.accepted') {
      if (!rate) throw new Error('The firm has no standard hourly rate configured yet.')
      if (!terms) throw new Error('The firm has not published engagement terms yet.')
    }

    const consentEventId = await insertEvent(client, {
      tenantId: ctx.tenantId,
      actionId,
      eventKindName,
      primaryEntityId: p.client_contact_id,
      data: {
        client_contact_id: p.client_contact_id,
        rate: rate ?? null,
        currency: 'USD',
        terms_version: terms?.version ?? null,
      },
      sourceType: 'human',
      sourceRef: `client_contact:${p.client_contact_id}`,
    })
    return {
      consentEventId,
      decision: eventKindName,
      rate: rate ?? null,
      termsVersion: terms?.version ?? null,
    }
  }
}

registerActionHandler('legal.engagement.accept', engagementDecisionHandler('engagement.accepted'))
registerActionHandler('legal.engagement.decline', engagementDecisionHandler('engagement.declined'))

// WP-3 — the read-state watermark. The action row itself is the fact the badge
// reads (payload.read_at); no event, no UPDATE, no DELETE.
registerActionHandler('portal.notification.read', async (ctx, client, payload) => {
  const p = payload as unknown as { client_contact_id?: string; read_at?: string }
  if (!p.client_contact_id) throw new Error('client_contact_id is required.')
  await assertActiveClientContact(client, ctx.tenantId, p.client_contact_id)
  const readAt = p.read_at && Number.isFinite(Date.parse(p.read_at)) ? p.read_at : null
  if (!readAt) throw new Error('read_at (ISO timestamp) is required.')
  return { readAt }
})

// WP-7 — the per-client assistant flag reader used by the portal shell. Lives
// here (not a new module) because it is the same firm-config read discipline.
export async function readPortalAssistantEnabled(
  client: DbClient,
  tenantId: string,
  clientEntityId: string,
): Promise<boolean> {
  const v = await getLatestAttributeValue<boolean>(
    client,
    tenantId,
    clientEntityId,
    'portal_assistant_enabled',
  )
  return v === true
}
