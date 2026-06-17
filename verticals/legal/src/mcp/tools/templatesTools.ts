import { registerTool, type Tool } from '@exsto/mcp-tools'
import { listTemplatesCatalog, type TemplatesCatalog } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Templates nav tab (beta sprint Obj 9). One read that lists the firm's
// templates across all three categories — intake forms, document body templates,
// and email templates — aggregated over the existing library layer (no parallel
// store). Powers the Templates page; editing each kind still goes through its
// existing service-library / notification tools.
const tool: Tool<Record<string, never>, { catalog: TemplatesCatalog }> = {
  name: 'legal.templates.list',
  description:
    "List the firm's templates for the Templates tab: intake forms and document body templates per service, plus the email notification templates. Each entry flags where its content resolves from and whether it's authored yet.",
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ catalog: await listTemplatesCatalog(ctx) }),
}

registerTool(tool)
