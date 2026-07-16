// Which legal MCP tools the PUBLIC client portal (/api/client/mcp) may call.
//
// All legal tools register into one flat @exsto/mcp-tools registry, and BOTH
// the authenticated attorney route and the UNAUTHENTICATED client route resolve
// names against it. The client route runs as a fixed public-intake actor in the
// firm's own tenant with no caller auth — so without this allowlist, anyone who
// can POST to /api/client/mcp could invoke ANY registered tool (read attorney
// research, settings, matter history; trigger billable AI calls; write to the
// substrate). The vertical, which owns the tools, therefore owns the policy of
// which are safe to expose publicly. Default-deny: a tool is client-callable
// only if it is in this set.
//
// Keep this list MINIMAL and intentional — it is a security boundary, not a
// convenience. Everything the public booking page + shared-draft view need:
export const CLIENT_PORTAL_TOOLS: ReadonlySet<string> = new Set([
  'legal.service.list', // booking page: list bookable services
  'legal.public.firm_branding', // booking page: resolved firm's name + attorney (branding, client-safe)
  'legal.calendar.availability', // booking page: open consultation slots
  'legal.booking.submit', // booking page: book a consultation (public intake)
  'legal.intake.something_else', // "Something else" tile: free-text client_request for attorney triage
  'legal.draft.get_shared', // /d/[versionId]: client-safe shared-draft view (body only; no reasoning/model/notes)
])

// NOTE: the full-detail `legal.draft.get` is intentionally NOT here — it returns
// the internal reasoning trace, model identity, confidence, and review notes and
// is attorney-only. The public path uses the client-safe `legal.draft.get_shared`.

export function isClientPortalTool(toolName: string): boolean {
  return CLIENT_PORTAL_TOOLS.has(toolName)
}

// Which legal MCP tools the AUTHENTICATED client portal (/api/client/portal/mcp)
// may call. This is a SEPARATE, additional security boundary from the public
// CLIENT_PORTAL_TOOLS above: the authed route runs only after a signed client
// session cookie is verified, but it STILL default-denies against this list so
// that an authenticated client can never invoke attorney research, settings,
// matter history, billable AI calls, or any write — only the read-only,
// client-safe portal tools belong here.
//
// Authorization to a SPECIFIC matter (this client may see THIS matter) is a
// further check done in the route against the session's matterIds; this list
// only governs WHICH tools are reachable at all. Keep it MINIMAL — every entry
// must return a client-safe projection. All entries are read-mode.
export const CLIENT_PORTAL_AUTHED_TOOLS: ReadonlySet<string> = new Set([
  'legal.client.home_summary', // the portal home in one read (matters, attention, previews, badge, gate state)
  'legal.client.notifications', // the notifications feed + unread watermark
  'legal.client.notifications_read', // mark notifications read (append-only watermark)
  'legal.client.engagement', // engagement-gate state + current firm rate/terms
  'legal.client.engagement_accept', // accept the firm-level engagement agreement (the client's own actor)
  'legal.client.engagement_decline', // decline it
  'legal.client.matters', // matter switcher: the signed-in client's own matters
  'legal.client.matter_timeline', // status + whitelisted milestone timeline for one matter
  'legal.client.thread_get', // read the client↔attorney portal thread for one matter
  'legal.client.message_post', // post a message to the attorney on one of the client's matters
  'legal.client.billing_summary', // invoices + accrued fees + running total (one truth with the attorney panel)
  'legal.client.schedule_availability', // open slots on the firm's live calendar
  'legal.client.schedule_quote', // the fee for billable portal-scheduled time (null = free)
  'legal.client.schedule_time', // book a slot as the client (consent-gated when billable)
  'legal.client.intake_prefill', // most recent intake answers for prefilled repeat booking
  'legal.client.todos', // sign / pay / materials-requested, in one list
  'legal.client.invoices', // list the signed-in client's own invoices (client-safe fields)
  'legal.client.invoice_get', // one of the client's own invoices by number, with line items
  'legal.client.invoice_pdf', // branded PDF of the client's own invoice (no rates/notes/source events)
  'legal.client.invoice_payment_intent', // begin an online payment for the client's own invoice (Stripe client secret; no substrate write)
  'legal.client.request_quote', // price a request type before submitting (no write)
  'legal.client.request_create', // submit a cost-accepted request on one of the client's matters
  'legal.client.request_list', // list the signed-in client's own requests + status
  'legal.client.documents', // attorney-approved documents on the client's matters (view via /d shared-draft)
  'legal.client.uploads', // the documents the signed-in client has uploaded (metadata only)
  'legal.client.feedback_submit', // the portal chat widget: client feedback about the portal
  'legal.client.payment_methods', // the firm's Zelle/crypto payment options for the pay page (read)
  'legal.client.report_payment', // report a Zelle/crypto payment made on the client's own invoice
  'legal.draft.get_shared', // the portal door of the shared-draft view (scoped in-tool to the client's matters)
  'legal.esign.portal.list', // the client's documents awaiting their signature
  'legal.esign.portal.documents', // ALL of the client's documents (to-sign + signed)
  'legal.esign.portal.load', // load one of the client's signing requests (+ their fields)
  'legal.esign.portal.sign', // record the client's signature on their own request
  'legal.esign.portal.decline', // record the client declining their own request
])

export function isClientPortalAuthedTool(toolName: string): boolean {
  return CLIENT_PORTAL_AUTHED_TOOLS.has(toolName)
}
