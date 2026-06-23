// Which legal MCP tools the PLATFORM ADMIN console (/admin/api/mcp) may call.
//
// All legal tools register into one flat @exsto/mcp-tools registry. The admin
// route resolves names against it just like the attorney/client routes do — so
// without this allowlist, the admin surface could reach any registered tool, and
// (more importantly) the attorney/client routes must NOT be able to reach these
// cross-tenant admin tools. Default-deny, in BOTH directions: a tool is
// admin-callable only if it is in this set, and the attorney/client allowlists
// never contain an `admin.*` tool.
//
// This is a security boundary, not a convenience. Keep it to the control-plane
// surface. The operation-core functions behind every admin tool independently
// re-assert platform-admin (assertPlatformAdmin), so this list governs only WHICH
// tools are reachable, not WHO may use them.
export const ADMIN_CONSOLE_TOOLS: ReadonlySet<string> = new Set([
  // Tenants (control plane)
  'admin.tenant.list',
  'admin.tenant.get',
  'admin.tenant.bootstrap',
  'admin.tenant.set_status',
  // Modules (per-tenant feature bundles)
  'admin.module.catalog',
  'admin.module.enablement',
  'admin.module.enable',
  'admin.module.disable',
  // Sandbox / promotion
  'admin.promote.export',
  'admin.promote.diff',
  'admin.promote.run',
  // Access (per target tenant)
  'admin.access.users',
  'admin.access.roles',
  'admin.access.invite',
  'admin.access.assign_role',
  'admin.access.deactivate',
  // Audit
  'admin.audit.control_plane',
])

export function isAdminConsoleTool(toolName: string): boolean {
  return ADMIN_CONSOLE_TOOLS.has(toolName)
}
