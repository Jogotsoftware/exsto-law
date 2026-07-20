// Brief engine WP2 — the Matter Brief tool surface (design:
// docs/design/briefs/DESIGN.md §5). Three tools, one bright line:
//
//   legal.matter.brief.get       READ ONLY. Returns the cached brief (or null)
//     plus the stale flag and the matter's current watermark. NEVER calls the
//     model, NEVER writes — founder decision 1 (manual refresh only) depends on
//     the read path being provably inert. Pre-migration-safe: against a database
//     without the 0169 kinds it returns { brief: null } — not an error.
//
//   legal.matter.brief.generate  WRITE (AI operation), SYNCHRONOUS. The
//     getOrRefresh path: returns the cached brief when it is fresh and force is
//     not set; otherwise assembles evidence (WP1), synthesizes (one Claude
//     call), and persists via legal.brief.generate with a real reasoning trace
//     (exsto-ai-operation). Contract unchanged by B2.2 below — kept for callers
//     that want the result inline (e.g. the assistant's own tool use).
//
//   legal.matter.brief.request   WRITE, ENQUEUE-AND-RETURN (B2.2 — MATTER-
//     BRIEF-BACKGROUND-1). The BriefButton's page affordance uses THIS, not
//     .generate — a page click must never hold an HTTP request open for a
//     model call (the document-drafting lesson, PROD-DRAFT-OFFLOAD-1). Inserts
//     a `legal.brief.run` worker_job and returns its id immediately; the worker
//     calls getOrRefreshMatterBrief (the same engine .generate uses) off the
//     request. Callers poll legal.matter.brief.get afterward.
//
// Attorney-only surface: registered here (the attorney door), deliberately NOT
// added to clientPolicy.ts allowlists — the portal never sees a brief (founder
// decision 3).
import { registerTool, type Tool } from '@exsto/mcp-tools'
import type { ActionContext } from '@exsto/substrate'
import {
  enqueueBriefJob,
  getMatterBrief,
  getOrRefreshMatterBrief,
  type MatterBriefGenerateResult,
  type MatterBriefReadResult,
} from '../../api/briefEngine.js'
import type { EvidenceBudget } from '../../api/briefEvidence.js'

const getTool: Tool<{ matterEntityId: string }, MatterBriefReadResult> = {
  name: 'legal.matter.brief.get',
  description:
    'The cached Matter Brief for a matter (or null when none has been generated): markdown + structured sections, generation metadata, a `stale` flag (matter activity newer than the brief), and the matter’s current watermark. Read-only — never generates; use legal.matter.brief.generate to (re)generate.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string', description: 'The matter entity id.' },
    },
    required: ['matterEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => getMatterBrief(ctx, input.matterEntityId),
}

const generateTool: Tool<
  { matterEntityId: string; depth?: EvidenceBudget; force?: boolean },
  MatterBriefGenerateResult
> = {
  name: 'legal.matter.brief.generate',
  description:
    'Generate or refresh the Matter Brief: assembles the matter’s evidence, synthesizes an attorney-readable narrative (one Claude call, reasoning trace recorded), and persists it (one live brief per matter, superseded history). Returns the cached brief without regenerating when it is still fresh, unless `force` is set.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string', description: 'The matter entity id.' },
      depth: {
        type: 'string',
        enum: ['lean', 'balanced', 'generous'],
        description: 'Evidence budget for assembly (default balanced).',
      },
      force: {
        type: 'boolean',
        description: 'Regenerate even when the cached brief is fresh.',
      },
    },
    required: ['matterEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => {
    const matterEntityId = (input.matterEntityId ?? '').trim()
    if (!matterEntityId) throw new Error('matterEntityId is required.')
    return getOrRefreshMatterBrief(ctx, matterEntityId, {
      depth: input.depth,
      force: input.force === true,
    })
  },
}

const requestTool: Tool<
  { matterEntityId: string; depth?: EvidenceBudget; force?: boolean },
  { jobId: string }
> = {
  name: 'legal.matter.brief.request',
  description:
    'Enqueue a Matter Brief (re)generation on the worker and return immediately — the non-blocking sibling of legal.matter.brief.generate for a page affordance that must not hold the request open for a model call. Poll legal.matter.brief.get afterward; a changed generatedAt means the new brief has landed.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string', description: 'The matter entity id.' },
      depth: {
        type: 'string',
        enum: ['lean', 'balanced', 'generous'],
        description: 'Evidence budget for assembly (default balanced).',
      },
      force: {
        type: 'boolean',
        description: 'Regenerate even when the cached brief is fresh.',
      },
    },
    required: ['matterEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => {
    const matterEntityId = (input.matterEntityId ?? '').trim()
    if (!matterEntityId) throw new Error('matterEntityId is required.')
    const jobId = await enqueueBriefJob(ctx, matterEntityId, {
      depth: input.depth,
      force: input.force === true,
    })
    return { jobId }
  },
}

registerTool(getTool as Tool)
registerTool(generateTool as Tool)
registerTool(requestTool as Tool)
