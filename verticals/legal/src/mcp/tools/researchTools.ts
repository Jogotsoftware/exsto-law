import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  runMatterResearch,
  listMatterResearch,
  type MatterResearchInput,
  type MatterResearchEntry,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Matter-scoped Perplexity research. The answer is returned to the caller AND
// recorded on the matter timeline (research.recorded, provenance
// integration:perplexity). Write-mode: it appends a substrate event.
registerTool({
  name: 'legal.research.ask',
  description:
    'Run a Perplexity research query scoped to a matter. Returns the answer + citations and records it on the matter timeline. Uses the firm’s Settings-managed Perplexity key.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => ({ research: await runMatterResearch(ctx, input) }),
} satisfies Tool<MatterResearchInput, { research: MatterResearchEntry }>)

registerTool({
  name: 'legal.research.list',
  description: 'List prior Perplexity research recorded against a matter, newest first.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    research: await listMatterResearch(ctx, input.matterEntityId),
  }),
} satisfies Tool<{ matterEntityId: string }, { research: MatterResearchEntry[] }>)
