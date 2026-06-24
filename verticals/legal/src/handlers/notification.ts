import { registerActionHandler } from '@exsto/substrate'

// notification.send — the audit record of a notification the worker just delivered.
//
// The legal.notify worker (api/notifications.ts deliverNotification) sends the email
// through the channel driver and THEN submits this action as the substrate record of
// the send. The action kind is defined in the vertical seed (migration 0001) but had
// no handler — so submitAction('notification.send') always threw "No registered
// action handler", which made EVERY notification job fail AFTER the email went out
// (the send happens first), dead-lettering it and re-sending on each retry (duplicate
// emails). This handler closes that gap.
//
// The action row itself is the audit record (actor, intent, payload: route/channel/
// to/subject/provider_message_id/matter_entity_id). The substrate refuses to record
// an effect-less action, so we return a small non-empty effect echoing the delivery.
interface NotificationSendPayload {
  route?: string
  channel?: string
  to?: string | null
  subject?: string | null
  provider_message_id?: string | null
  matter_entity_id?: string | null
}

registerActionHandler('notification.send', async (_ctx, _client, payload) => {
  const p = payload as unknown as NotificationSendPayload
  return {
    route: p.route ?? null,
    channel: p.channel ?? null,
    to: p.to ?? null,
    providerMessageId: p.provider_message_id ?? null,
    matterEntityId: p.matter_entity_id ?? null,
  }
})
