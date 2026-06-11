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
  'legal.calendar.availability', // booking page: open consultation slots
  'legal.booking.submit', // booking page: book a consultation (public intake)
  'legal.draft.get', // /d/[versionId]: view a draft shared with the client
])

export function isClientPortalTool(toolName: string): boolean {
  return CLIENT_PORTAL_TOOLS.has(toolName)
}
