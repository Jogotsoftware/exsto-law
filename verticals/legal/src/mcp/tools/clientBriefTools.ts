// Brief engine WP3 — the Client Brief tool surface (design:
// docs/design/briefs/DESIGN.md §5). Mirrors briefTools.ts's matter-scope pair
// exactly, one bright line:
//
//   legal.client.brief.get       READ ONLY. Returns the cached brief (or null)
//     plus the stale flag and the client's current watermark. NEVER calls the
//     model, NEVER runs research, NEVER writes.
//
//   legal.client.brief.generate  WRITE (AI operation). The getOrRefresh path:
//     returns the cached brief when it is fresh and force is not set;
//     otherwise assembles client-scope evidence (WP1), runs the
//     privacy-guarded external research leg (api/briefResearchGuard.ts, on by
//     default per founder decision 2 — pass researchBusiness/researchPerson:
//     false to opt out), synthesizes (one Claude call), and persists via
//     legal.brief.generate with a real reasoning trace.
//
// Attorney-only surface: registered here (the attorney door), deliberately NOT
// added to clientPolicy.ts allowlists — the portal never sees a brief (founder
// decision 3) — exactly like legal.matter.brief.*.
import { registerTool, type Tool } from '@exsto/mcp-tools'
import type { ActionContext } from '@exsto/substrate'
import {
  getClientBrief,
  getOrRefreshClientBrief,
  type ClientBriefGenerateResult,
  type ClientBriefReadResult,
} from '../../api/clientBriefEngine.js'
import type { EvidenceBudget } from '../../api/briefEvidence.js'

const getTool: Tool<{ clientEntityId: string }, ClientBriefReadResult> = {
  name: 'legal.client.brief.get',
  description:
    'The cached Client Brief for a client (or null when none has been generated): markdown + structured sections, generation metadata, the external-research record (exact queries + findings, or why research did not run), a `stale` flag (any of the client’s matters have activity newer than the brief), and the client’s current watermark. Read-only — never generates; use legal.client.brief.generate to (re)generate.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      clientEntityId: { type: 'string', description: 'The client entity id.' },
    },
    required: ['clientEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => getClientBrief(ctx, input.clientEntityId),
}

const generateTool: Tool<
  {
    clientEntityId: string
    depth?: EvidenceBudget
    force?: boolean
    researchBusiness?: boolean
    researchPerson?: boolean
  },
  ClientBriefGenerateResult
> = {
  name: 'legal.client.brief.generate',
  description:
    'Generate or refresh the Client Brief: assembles the client’s evidence (client profile, every matter, notes, transcripts, messages), runs a privacy-guarded quick external search (business — only when the client is identified as a business — plus a name-only person lookup on the primary contact, including LinkedIn; on by default), synthesizes an attorney-readable narrative (one Claude call, reasoning trace recorded), and persists it (one live brief per client, superseded history). Returns the cached brief without regenerating when it is still fresh, unless `force` is set. `researchBusiness`/`researchPerson` default to true; set false to opt out of either leg.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      clientEntityId: { type: 'string', description: 'The client entity id.' },
      depth: {
        type: 'string',
        enum: ['lean', 'balanced', 'generous'],
        description: 'Evidence budget for assembly (default balanced).',
      },
      force: {
        type: 'boolean',
        description: 'Regenerate even when the cached brief is fresh.',
      },
      researchBusiness: {
        type: 'boolean',
        description:
          'Run the external business-research leg (default true; only fires when the client is identified as a business).',
      },
      researchPerson: {
        type: 'boolean',
        description:
          'Run the quick, name-only person/LinkedIn lookup on the primary contact (default true).',
      },
    },
    required: ['clientEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => {
    const clientEntityId = (input.clientEntityId ?? '').trim()
    if (!clientEntityId) throw new Error('clientEntityId is required.')
    return getOrRefreshClientBrief(ctx, clientEntityId, {
      depth: input.depth,
      force: input.force === true,
      researchBusiness: input.researchBusiness,
      researchPerson: input.researchPerson,
    })
  },
}

registerTool(getTool as Tool)
registerTool(generateTool as Tool)
