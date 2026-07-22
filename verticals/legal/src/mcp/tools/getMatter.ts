import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  getMatter,
  getMatterEngagementOverride,
  setMatterEngagementLetter,
  listEngagementLetters,
  type MatterDetail,
  type EngagementLetterSummary,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

interface Input {
  matterEntityId: string
}

const tool: Tool<Input, { matter: MatterDetail | null }> = {
  name: 'legal.matter.get',
  description: 'Fetch a matter with its attributes, questionnaire, transcript, and latest draft.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => {
    const matter = await getMatter(ctx, input.matterEntityId)
    return { matter }
  },
}

registerTool(tool)

// ── ENGAGEMENT-TEMPLATES-1 Phase 3 — per-matter engagement-letter override ──
// Which engagement letter applies to THIS matter, chosen from the firm's library;
// empty = defer to the contact override / firm default. Read returns the current
// override + the library options so the matter record renders one selector.
const engagementGetTool: Tool<
  Input,
  { overrideTemplateId: string | null; letters: EngagementLetterSummary[] }
> = {
  name: 'legal.matter.engagement_letter.get',
  description:
    "The matter's engagement-letter override (the template id used for this matter instead of the contact override / firm default, or null) plus the firm's engagement-letter library to choose from. Empty override = the matter defers to the contact override / firm default.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    overrideTemplateId: await getMatterEngagementOverride(ctx, input.matterEntityId),
    letters: await listEngagementLetters(ctx),
  }),
}

const engagementSetTool: Tool<
  { matterEntityId: string; templateId: string | null },
  { templateId: string | null }
> = {
  name: 'legal.matter.set_engagement_letter',
  description:
    'Choose which engagement letter applies to a specific matter (a template id from the firm library), or pass null to clear it back to the contact override / firm default. Attorney-only.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) =>
    await setMatterEngagementLetter(ctx, input.matterEntityId, input.templateId ?? null),
}

registerTool(engagementGetTool)
registerTool(engagementSetTool)
