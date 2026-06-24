// Platform admin-console MCP tools — the control-plane surface (ADR 0046). Thin
// adapters over the controlPlane operation core; the platform-admin gate lives in
// that core (assertPlatformAdmin) so it holds for any adapter. These tools are
// reachable ONLY from /admin/api/mcp (default-deny via adminPolicy.ts) and never
// from the attorney/client routes.
import { registerTool, type Tool } from '@exsto/mcp-tools'
import type { ActionContext } from '@exsto/substrate'
import {
  listTenants,
  getTenant,
  bootstrapTenant,
  setTenantStatus,
  controlPlaneAuditLog,
  listCatalog,
  tenantModuleStates,
  enableModule,
  disableModule,
  listPromotableServices,
  diffServices,
  promoteServices,
  listPromotableTemplates,
  diffTemplates,
  promoteTemplates,
  listTenantUsers,
  listTenantRoles,
  inviteTenantUser,
  assignTenantUserRole,
  deactivateTenantUser,
  type TenantSummary,
  type TenantDetail,
  type ControlPlaneAuditEntry,
  type ModuleCatalogEntry,
  type TenantModuleState,
  type ServiceDef,
  type ServiceDiff,
  type PromoteResult,
  type TemplateDef,
  type TemplateDiff,
  type TemplatePromoteResult,
} from '../../controlPlane/index.js'
import type { FirmUser, FirmRole } from '../../api/users.js'

registerTool({
  name: 'admin.tenant.list',
  description: 'List every tenant (firm) in the platform registry. Platform admin only.',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ tenants: await listTenants(ctx) }),
} satisfies Tool<Record<string, never>, { tenants: TenantSummary[] }>)

registerTool({
  name: 'admin.tenant.get',
  description: 'Get one tenant with actor counts. Platform admin only.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { tenantId: { type: 'string', description: 'Tenant UUID' } },
    required: ['tenantId'],
  },
  handler: async (ctx: ActionContext, input: { tenantId: string }) => ({
    tenant: await getTenant(ctx, input.tenantId),
  }),
} satisfies Tool<{ tenantId: string }, { tenant: TenantDetail | null }>)

registerTool({
  name: 'admin.tenant.bootstrap',
  description:
    'Stand up a new tenant (firm): tenant row, actors, cloned core kinds, RBAC, and an owner who signs in with the given email. Platform admin only.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Firm / tenant display name' },
      ownerEmail: { type: 'string', description: "The owner's Google sign-in email" },
      ownerDisplayName: { type: 'string', description: "The owner's display name (optional)" },
    },
    required: ['name', 'ownerEmail'],
  },
  handler: async (
    ctx: ActionContext,
    input: { name: string; ownerEmail: string; ownerDisplayName?: string },
  ) => bootstrapTenant(ctx, input),
} satisfies Tool<
  { name: string; ownerEmail: string; ownerDisplayName?: string },
  { tenantId: string; ownerActorId: string }
>)

registerTool({
  name: 'admin.tenant.set_status',
  description:
    'Set a tenant status to active, suspended, or archived. The platform tenant cannot be changed. Platform admin only.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      tenantId: { type: 'string' },
      status: { type: 'string', enum: ['active', 'suspended', 'archived'] },
    },
    required: ['tenantId', 'status'],
  },
  handler: async (ctx: ActionContext, input: { tenantId: string; status: string }) =>
    setTenantStatus(ctx, input),
} satisfies Tool<{ tenantId: string; status: string }, { ok: true }>)

registerTool({
  name: 'admin.module.catalog',
  description: 'List the master module catalog (feature bundles). Platform admin only.',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ modules: await listCatalog(ctx) }),
} satisfies Tool<Record<string, never>, { modules: ModuleCatalogEntry[] }>)

registerTool({
  name: 'admin.module.enablement',
  description:
    'For one tenant, the catalog joined with which modules are enabled. Platform admin only.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { tenantId: { type: 'string' } },
    required: ['tenantId'],
  },
  handler: async (ctx: ActionContext, input: { tenantId: string }) => ({
    modules: await tenantModuleStates(ctx, input.tenantId),
  }),
} satisfies Tool<{ tenantId: string }, { modules: TenantModuleState[] }>)

registerTool({
  name: 'admin.module.enable',
  description: 'Enable a feature module for a tenant. Platform admin only.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { tenantId: { type: 'string' }, moduleKey: { type: 'string' } },
    required: ['tenantId', 'moduleKey'],
  },
  handler: async (ctx: ActionContext, input: { tenantId: string; moduleKey: string }) =>
    enableModule(ctx, input),
} satisfies Tool<{ tenantId: string; moduleKey: string }, { ok: true }>)

registerTool({
  name: 'admin.module.disable',
  description: 'Disable a feature module for a tenant (data is kept). Platform admin only.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { tenantId: { type: 'string' }, moduleKey: { type: 'string' } },
    required: ['tenantId', 'moduleKey'],
  },
  handler: async (ctx: ActionContext, input: { tenantId: string; moduleKey: string }) =>
    disableModule(ctx, input),
} satisfies Tool<{ tenantId: string; moduleKey: string }, { ok: true }>)

registerTool({
  name: 'admin.promote.export',
  description:
    'List the services (workflow definitions) available to promote from a source tenant (default: the sandbox). Platform admin only.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      sourceTenantId: { type: 'string', description: 'Defaults to the sandbox tenant' },
    },
  },
  handler: async (ctx: ActionContext, input: { sourceTenantId?: string }) => ({
    services: await listPromotableServices(ctx, input?.sourceTenantId),
  }),
} satisfies Tool<{ sourceTenantId?: string }, { services: ServiceDef[] }>)

registerTool({
  name: 'admin.promote.diff',
  description:
    'Dry-run: classify each source service as new / changed / identical against a target tenant. Platform admin only.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { sourceTenantId: { type: 'string' }, targetTenantId: { type: 'string' } },
    required: ['sourceTenantId', 'targetTenantId'],
  },
  handler: async (
    ctx: ActionContext,
    input: { sourceTenantId: string; targetTenantId: string },
  ) => ({ diff: await diffServices(ctx, input.sourceTenantId, input.targetTenantId) }),
} satisfies Tool<{ sourceTenantId: string; targetTenantId: string }, { diff: ServiceDiff[] }>)

registerTool({
  name: 'admin.promote.run',
  description:
    'Promote selected services from a source tenant (default: sandbox) into one or more target tenants, replaying each as a new version. Platform admin only.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      sourceTenantId: { type: 'string' },
      targetTenantIds: { type: 'array', items: { type: 'string' } },
      kindNames: { type: 'array', items: { type: 'string' } },
    },
    required: ['targetTenantIds', 'kindNames'],
  },
  handler: async (
    ctx: ActionContext,
    input: { sourceTenantId?: string; targetTenantIds: string[]; kindNames: string[] },
  ) => ({ results: await promoteServices(ctx, input) }),
} satisfies Tool<
  { sourceTenantId?: string; targetTenantIds: string[]; kindNames: string[] },
  { results: PromoteResult[] }
>)

registerTool({
  name: 'admin.promote.templates.export',
  description:
    'List the document/email templates available to promote from a source tenant (default: the sandbox). Platform admin only.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      sourceTenantId: { type: 'string', description: 'Defaults to the sandbox tenant' },
    },
  },
  handler: async (ctx: ActionContext, input: { sourceTenantId?: string }) => ({
    templates: await listPromotableTemplates(ctx, input?.sourceTenantId),
  }),
} satisfies Tool<{ sourceTenantId?: string }, { templates: TemplateDef[] }>)

registerTool({
  name: 'admin.promote.templates.diff',
  description:
    'Dry-run: classify each source template as new / changed / identical against a target tenant. Platform admin only.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { sourceTenantId: { type: 'string' }, targetTenantId: { type: 'string' } },
    required: ['sourceTenantId', 'targetTenantId'],
  },
  handler: async (
    ctx: ActionContext,
    input: { sourceTenantId: string; targetTenantId: string },
  ) => ({ diff: await diffTemplates(ctx, input.sourceTenantId, input.targetTenantId) }),
} satisfies Tool<{ sourceTenantId: string; targetTenantId: string }, { diff: TemplateDiff[] }>)

registerTool({
  name: 'admin.promote.templates.run',
  description:
    'Promote selected templates (by "category::name" key) from a source tenant (default: sandbox) into one or more target tenants — create/update/skip-identical. Platform admin only.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      sourceTenantId: { type: 'string' },
      targetTenantIds: { type: 'array', items: { type: 'string' } },
      keys: { type: 'array', items: { type: 'string' } },
    },
    required: ['targetTenantIds', 'keys'],
  },
  handler: async (
    ctx: ActionContext,
    input: { sourceTenantId?: string; targetTenantIds: string[]; keys: string[] },
  ) => ({ results: await promoteTemplates(ctx, input) }),
} satisfies Tool<
  { sourceTenantId?: string; targetTenantIds: string[]; keys: string[] },
  { results: TemplatePromoteResult[] }
>)

registerTool({
  name: 'admin.access.users',
  description: "List a tenant's users (with roles) and the tenant's roles. Platform admin only.",
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { tenantId: { type: 'string' } },
    required: ['tenantId'],
  },
  handler: async (ctx: ActionContext, input: { tenantId: string }) =>
    listTenantUsers(ctx, input.tenantId),
} satisfies Tool<{ tenantId: string }, { users: FirmUser[]; roles: FirmRole[] }>)

registerTool({
  name: 'admin.access.roles',
  description: "List a tenant's roles. Platform admin only.",
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { tenantId: { type: 'string' } },
    required: ['tenantId'],
  },
  handler: async (ctx: ActionContext, input: { tenantId: string }) => ({
    roles: await listTenantRoles(ctx, input.tenantId),
  }),
} satisfies Tool<{ tenantId: string }, { roles: FirmRole[] }>)

registerTool({
  name: 'admin.access.invite',
  description: 'Invite or re-activate a user in a tenant and assign a role. Platform admin only.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      tenantId: { type: 'string' },
      email: { type: 'string' },
      displayName: { type: 'string' },
      roleName: { type: 'string' },
    },
    required: ['tenantId', 'email'],
  },
  handler: async (
    ctx: ActionContext,
    input: { tenantId: string; email: string; displayName?: string; roleName?: string },
  ) => inviteTenantUser(ctx, input.tenantId, input),
} satisfies Tool<
  { tenantId: string; email: string; displayName?: string; roleName?: string },
  { ok: true }
>)

registerTool({
  name: 'admin.access.assign_role',
  description: "Set a tenant user's role. Platform admin only.",
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      tenantId: { type: 'string' },
      actorId: { type: 'string' },
      roleName: { type: 'string' },
    },
    required: ['tenantId', 'actorId', 'roleName'],
  },
  handler: async (
    ctx: ActionContext,
    input: { tenantId: string; actorId: string; roleName: string },
  ) =>
    assignTenantUserRole(ctx, input.tenantId, { actorId: input.actorId, roleName: input.roleName }),
} satisfies Tool<{ tenantId: string; actorId: string; roleName: string }, { ok: true }>)

registerTool({
  name: 'admin.access.deactivate',
  description: 'Deactivate a tenant user. Platform admin only.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { tenantId: { type: 'string' }, actorId: { type: 'string' } },
    required: ['tenantId', 'actorId'],
  },
  handler: async (ctx: ActionContext, input: { tenantId: string; actorId: string }) =>
    deactivateTenantUser(ctx, input.tenantId, { actorId: input.actorId }),
} satisfies Tool<{ tenantId: string; actorId: string }, { ok: true }>)

registerTool({
  name: 'admin.audit.control_plane',
  description:
    'Read the control-plane audit log (who did what across tenants). Platform admin only.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'number', description: 'Max rows (1–500, default 100)' } },
  },
  handler: async (ctx: ActionContext, input: { limit?: number }) => ({
    entries: await controlPlaneAuditLog(ctx, input?.limit ?? 100),
  }),
} satisfies Tool<{ limit?: number }, { entries: ControlPlaneAuditEntry[] }>)
