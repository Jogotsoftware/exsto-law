import { registerTool, type Tool } from '@exsto/mcp-tools'
import { setMatterGoverningLaw } from '../../index.js'
import type { ActionContext, ActionResult } from '@exsto/substrate'

// Set (or clear) a matter's governing-law override (WP A1). The handler
// normalizes to the canonical US state code and validates it; an empty value
// clears the override so resolveMatterJurisdiction falls through to the firm's
// home jurisdiction.
registerTool({
  name: 'legal.matter.set_governing_law',
  description:
    'Set or clear a matter\'s governing-law override (a US state code or name, e.g. "NC" or "North Carolina"). Empty clears it, falling back to the firm\'s home jurisdiction.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string' },
      governingLaw: { type: 'string', description: 'US state code or name; empty clears.' },
    },
    required: ['matterEntityId'],
    additionalProperties: false,
  },
  handler: (ctx: ActionContext, input) => {
    const i = input as { matterEntityId: string; governingLaw?: string | null }
    return setMatterGoverningLaw(ctx, {
      matterEntityId: i.matterEntityId,
      governingLaw: i.governingLaw ?? null,
    })
  },
} satisfies Tool<{ matterEntityId: string; governingLaw?: string | null }, ActionResult>)
