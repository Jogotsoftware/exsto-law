// Notification engine (Phase 0, WP6 — REQ-NOTIFY-01..03).
//
// Routes are notification_route_definition rows (configuration as data); this
// module resolves a route, renders its template, hands it to the channel
// driver, and records notification.send through the action layer. Adding SMS
// later = a new driver in DRIVERS + route rows — zero call-site changes
// (deliberately NO sms driver in Phase 0).
//
// Sends are enqueued (legal.notify worker job) so booking/drafting paths never
// block on the Gmail API; the runtime's retry/backoff covers transient failures.
// One exception: deliverNotification is exported so a caller that already
// holds bytes in memory (e.g. sendEnvelopeCompletionCopies, esign.ts, after
// Item 1's PDF stamping) can send an ATTACHMENT-bearing notification directly,
// synchronously, without enqueuing — the worker_job queue's JSONB payload is
// the wrong place for multi-MB PDF bytes. Same driver/audit-action seam
// either way; only the enqueue step is skipped.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { enqueueJob } from '@exsto/worker-runtime'
import { sendEmail, type EmailAttachment } from '../adapters/gmail.js'
import { getConnectionInfo, resolveFirmPrimaryActor } from '../adapters/connectionStore.js'
import { renderNotificationTemplate } from './notificationTemplates.js'
import { renderEmailHtml } from '../email/index.js'
import { withSignature } from './mailWorkspace.js'
import { resolveEmailSignature } from './firmSignature.js'

export interface NotificationRoute {
  kindName: string
  channel: string
  recipients: Record<string, unknown>
  templateRef: string | null
  config: Record<string, unknown>
}

async function getRoute(ctx: ActionContext, kindName: string): Promise<NotificationRoute | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      kind_name: string
      channel: string
      recipients: Record<string, unknown>
      template_ref: string | null
      config: Record<string, unknown>
    }>(
      `SELECT kind_name, channel, recipients, template_ref, config
       FROM notification_route_definition
       WHERE tenant_id = $1 AND kind_name = $2 AND status = 'active' AND valid_to IS NULL
       LIMIT 1`,
      [ctx.tenantId, kindName],
    )
    const r = res.rows[0]
    if (!r) return null
    return {
      kindName: r.kind_name,
      channel: r.channel,
      recipients: r.recipients ?? {},
      templateRef: r.template_ref,
      config: r.config ?? {},
    }
  })
}

// The attorney's address: env override first, else the connected Google
// account (his real Gmail — the same account the calendar lives on).
export async function attorneyEmail(tenantId: string): Promise<string | null> {
  if (process.env.ATTORNEY_EMAIL) return process.env.ATTORNEY_EMAIL
  // No specific attorney in a firm-level notification: use the firm's primary
  // (earliest-connected) Google attorney. Per-link sender attribution is track B.
  const actorId = await resolveFirmPrimaryActor(tenantId, 'google')
  const conn = await getConnectionInfo(tenantId, 'google', actorId)
  return conn?.accountEmail ?? null
}

type ChannelDriver = (
  ctx: ActionContext,
  args: {
    to: string
    subject: string
    bodyText: string
    bodyHtml?: string
    // esign-executed-copy-complete — optional file attachments (e.g. the
    // stamped executed PDF). Only the email driver honors these; a future sms
    // driver would ignore/reject them.
    attachments?: EmailAttachment[]
  },
) => Promise<{ providerMessageId: string | null }>

const DRIVERS: Record<string, ChannelDriver> = {
  email: async (ctx, args) => {
    // Automated mail goes out through the firm's primary connected Google
    // attorney (per-link sender attribution lands in track B).
    const actorId = await resolveFirmPrimaryActor(ctx.tenantId, 'google')
    const result = await sendEmail(
      ctx.tenantId,
      {
        to: args.to,
        subject: args.subject,
        body: args.bodyText,
        html: args.bodyHtml,
        attachments: args.attachments,
      },
      actorId,
    )
    return { providerMessageId: result.messageId || null }
  },
  // NO sms driver in Phase 0 (REQ-NOTIFY-01: interface is provider-agnostic;
  // an SMS route would fail loudly here rather than silently dropping).
}

export interface NotifyInput {
  routeKindName: string
  to?: string // resolved from the route's recipients role when omitted
  variables: Record<string, unknown>
  // esign-executed-copy-complete — file attachments for THIS send (e.g. the
  // stamped executed PDF). Deliberately NOT threaded through queueNotification
  // (the worker_job payload is a JSONB row; base64-inflating a multi-MB PDF
  // into it would bloat the queue table) — only deliverNotification, called
  // DIRECTLY (not enqueued) by callers that already hold the bytes in memory.
  attachments?: EmailAttachment[]
}

// Queue a notification (preferred entry — never blocks the caller's request).
export async function queueNotification(ctx: ActionContext, input: NotifyInput): Promise<string> {
  return enqueueJob({
    tenantId: ctx.tenantId,
    jobKind: 'legal.notify',
    payload: { route: input.routeKindName, to: input.to ?? null, variables: input.variables },
  })
}

// Worker-side delivery: resolve route → recipient → render → drive → record.
export async function deliverNotification(ctx: ActionContext, input: NotifyInput): Promise<void> {
  const route = await getRoute(ctx, input.routeKindName)
  if (!route) throw new Error(`Notification route not found: ${input.routeKindName}`)

  const driver = DRIVERS[route.channel]
  if (!driver) throw new Error(`No driver for channel '${route.channel}' (route ${route.kindName})`)

  let to = input.to ?? null
  if (!to && route.recipients.role === 'attorney') {
    to = await attorneyEmail(ctx.tenantId)
  }
  if (!to) {
    throw new Error(
      `No recipient for route ${route.kindName} (role=${String(route.recipients.role)}); connect Google or set ATTORNEY_EMAIL.`,
    )
  }

  const ref = route.templateRef ?? route.kindName
  const { subject, bodyText } = renderNotificationTemplate(ref, input.variables)
  // Branded HTML alternative when the kit has a matching template (ref keys mirror
  // the route template_refs); null → plaintext-only, unchanged behaviour.
  const branded = renderEmailHtml(ref, input.variables)
  // Sign client-facing mail with the configurable firm signature (Contract B
  // parity, fix #10) so every outbound client email carries ONE signature set in
  // Settings — templates no longer hardcode a closing. Internal attorney
  // notifications are left unsigned.
  let outText = bodyText
  let outHtml = branded?.html
  if (route.channel === 'email' && route.recipients.role !== 'attorney') {
    const signed = withSignature(
      { body: bodyText, html: branded?.html },
      await resolveEmailSignature(ctx),
    )
    outText = signed.body
    outHtml = signed.html
  }
  const sent = await driver(ctx, {
    to,
    subject,
    bodyText: outText,
    bodyHtml: outHtml,
    attachments: input.attachments,
  })

  await submitAction(ctx, {
    actionKindName: 'notification.send',
    intentKind: 'automatic_sync',
    payload: {
      route: route.kindName,
      channel: route.channel,
      to,
      subject,
      provider_message_id: sent.providerMessageId,
      matter_entity_id: (input.variables.matter_entity_id as string | undefined) ?? null,
    },
  })
}
