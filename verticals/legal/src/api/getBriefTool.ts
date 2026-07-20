// WP B5 — brief fan-out: a READ-ONLY get_brief ClientTool for the attorney
// chat. Registered only on scoped turns (matter or contact) — same guard as
// compose_email (ASSISTANT-ACTS-1, composeEmailTool.ts). This tool NEVER
// generates or refreshes a brief: it reads the stored one (getMatterBrief for
// a matter turn; getClientBrief for a contact turn, resolved via the contact's
// client parent) and hands the model the markdown + generatedAt + an honest
// stale flag — the exact cache contract briefEngine.ts/clientBriefEngine.ts
// already enforce (design decision 1: regeneration is always an explicit,
// separate act, never something a chat turn can trigger mid-stream). When no
// brief exists yet, or the stored one is stale, the ack says so plainly and
// points the attorney at the Brief button (BriefButton/BriefModal, already
// live on the matter page and the CRM client detail) to generate or refresh
// it themselves.
import { withActionContext, type ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'
import { getMatterBrief, type MatterBriefReadResult } from './briefEngine.js'
import { getClientBrief, type ClientBriefReadResult } from './clientBriefEngine.js'

const GET_BRIEF_TOOL_DEF = {
  name: 'get_brief',
  description:
    "Read the firm's already-generated brief for this matter or client — a synthesized narrative of status, commitments, deadlines, and open items. READ-ONLY: this NEVER generates or refreshes a brief, it only returns what is already on file (or says honestly that none exists, or that it is out of date). Call it for background before answering questions about this matter's or client's status, history, or open items — treat the brief as background to inform your answer and cite it in your own words, do NOT paste it wholesale into your reply. If none exists yet, or it is stale, tell the attorney and point them to the Brief button on this page to generate or refresh it — never claim to have generated one yourself.",
  input_schema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
}

// Injectable seams (mirrors MatterBriefEngineDeps/ClientBriefEngineDeps in
// briefEngine.ts/clientBriefEngine.ts) so the unit test pins the three read
// shapes — present, absent, stale — with plain fakes: no DB, no model.
export interface GetBriefToolDeps {
  getMatterBrief: (ctx: ActionContext, matterEntityId: string) => Promise<MatterBriefReadResult>
  getClientBrief: (ctx: ActionContext, clientEntityId: string) => Promise<ClientBriefReadResult>
  resolveClientForContact: (ctx: ActionContext, contactEntityId: string) => Promise<string | null>
}

// The client-parent for a CRM contact (contact_of) — the same relationship
// walk portalScheduling.ts's resolveClientParent and portalBooking.ts use, so
// a contact-scoped chat turn reads the CLIENT brief (client_entity), not a
// (nonexistent) per-contact one.
async function resolveClientForContact(
  ctx: ActionContext,
  contactEntityId: string,
): Promise<string | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT r.target_entity_id AS id
       FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1 AND r.source_entity_id = $2
         AND rkd.kind_name = 'contact_of'
         AND (r.valid_to IS NULL OR r.valid_to > now())
       ORDER BY r.recorded_at DESC LIMIT 1`,
      [ctx.tenantId, contactEntityId],
    )
    return res.rows[0]?.id ?? null
  })
}

const DEFAULT_DEPS: GetBriefToolDeps = {
  getMatterBrief,
  getClientBrief,
  resolveClientForContact,
}

// Pure formatter for the ack text (exported for tests): present / absent /
// stale are three genuinely different messages — never blurred into a
// paraphrase that could read as "the brief says there is nothing".
export function formatBriefAck(
  noun: 'matter' | 'client',
  read: { brief: { markdown: string; generatedAt: string | null } | null; stale: boolean },
): string {
  if (!read.brief) {
    return `No brief has been generated for this ${noun} yet. Tell the attorney and point them to the Brief button on this page to generate one — do not claim to have generated it yourself.`
  }
  const staleNote = read.stale
    ? ` This brief is OUT OF DATE — the ${noun} has activity since it was generated. Mention that, and point the attorney to the Brief button's Refresh action if it matters to their question.`
    : ''
  return (
    `Stored ${noun} brief (generated ${read.brief.generatedAt ?? 'at an unknown time'}).${staleNote} ` +
    `Use it as background — cite it in your own words, do NOT paste it wholesale into your reply:\n\n${read.brief.markdown}`
  )
}

// Build the get_brief ClientTool for this turn. `input` is the same scope the
// caller already resolved (matterEntityId / contactEntityId on
// AssistantChatInput) — a matter turn reads the matter brief directly; a
// contact turn resolves the contact's client parent first and reads the
// CLIENT brief (contacts have no brief of their own).
export function buildGetBriefTool(
  ctx: ActionContext,
  input: { matterEntityId?: string; contactEntityId?: string },
  deps: GetBriefToolDeps = DEFAULT_DEPS,
): ClientTool {
  return {
    definition: GET_BRIEF_TOOL_DEF,
    name: 'get_brief',
    run: async () => {
      if (input.matterEntityId) {
        const r = await deps.getMatterBrief(ctx, input.matterEntityId)
        return formatBriefAck('matter', r)
      }
      if (input.contactEntityId) {
        const clientEntityId = await deps.resolveClientForContact(ctx, input.contactEntityId)
        if (!clientEntityId) {
          return 'This contact has no client account on file, so there is no client brief to read.'
        }
        const r = await deps.getClientBrief(ctx, clientEntityId)
        return formatBriefAck('client', r)
      }
      return 'No matter or client is in scope for this conversation, so there is no brief to read.'
    },
  }
}
