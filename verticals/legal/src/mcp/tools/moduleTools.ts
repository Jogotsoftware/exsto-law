// Firm-facing module tool: which feature modules are DISABLED for the calling
// firm, so the attorney app can hide their nav (ADR 0046 §5). RLS-scoped to the
// caller's tenant; NOT a control-plane tool (not in adminPolicy) — it reads only
// the caller's own enablement, never another tenant's. Modules are opt-OUT, so
// this returns the explicit enabled=false keys; the app maps them to nav areas.
import { registerTool, type Tool } from '@exsto/mcp-tools'
import type { ActionContext } from '@exsto/substrate'
import { listDisabledModulesForCaller } from '../../controlPlane/modules.js'

registerTool({
  name: 'legal.module.gating',
  description:
    'The feature modules explicitly DISABLED for the calling firm (module keys). Used by the app to hide nav for disabled modules; an empty list means everything is on (modules are opt-out).',
  mode: 'read',
  handler: async (ctx: ActionContext) => listDisabledModulesForCaller(ctx),
} satisfies Tool<Record<string, never>, { disabledModuleKeys: string[] }>)
