// CHATBOT-CATCHUP-1 — chat wrappers over the matter↔contact party link
// (MULTI-PARTY-1's matter_contact relationship). Two tools, matter-scoped:
//   • get_matter_parties — READ-ONLY: who is linked to THIS matter (the same
//     traversal the e-sign repeat-per-party expansion resolves recipients from).
//   • link_matter_contact — a pure, reversible relationship write (§3 Wave-1
//     "CRM links"): "add Maria as a party on this matter". The contact is
//     resolved by NAME/EMAIL server-side against the firm's contacts — the
//     model never passes an entity id it could hallucinate; ambiguity comes
//     back as an instructive result. The write goes through submitAction
//     ('matter.link_contact' — the same action the MCP tool and matter.open
//     use), never a raw substrate write.
import { submitAction, type ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'
import { listContacts, type ContactSummary } from '../queries/contacts.js'
import { listMatterPartyContacts } from './esignPrefill.js'

const GET_MATTER_PARTIES_TOOL_DEF = {
  name: 'get_matter_parties',
  description:
    'List the contacts linked as PARTIES on THIS matter (LLC members, counterparties, additional signers — everyone the e-sign flow can send a signature request to). READ-ONLY. Call it when the attorney asks who is on the matter, before adding a party (to avoid duplicates), or when reasoning about who will sign. Report only what it returns; an empty list means only the primary client is on the matter.',
  input_schema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
}

const LINK_MATTER_CONTACT_TOOL_DEF = {
  name: 'link_matter_contact',
  description:
    'Link an EXISTING firm contact to THIS matter as a party ("add Maria as a party/member on this matter"). Pass the contact as the attorney named them — name or email words; the platform resolves them against the firm\'s contacts, never an id you invent. If more than one contact matches, the result lists them: ask the attorney WHICH one, then call again. If NO contact matches, say so — this tool never creates a new contact (the attorney adds new people on the Contacts page or via intake). Linked parties show on the CRM record, count for repeat-per-party signature expansion, and can receive signature requests. Reversible from the matter page.',
  input_schema: {
    type: 'object',
    properties: {
      contact_hint: {
        type: 'string',
        description:
          "The contact as the attorney referred to them — name and/or email words (e.g. 'Maria Alvarez', 'maria@acme.com'). Matched case-insensitively against the firm's contacts.",
      },
    },
    required: ['contact_hint'],
    additionalProperties: false,
  },
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, ' ')
    .trim()
}

// A contact matches when every whitespace-separated hint word appears in the
// contact's name or email — so "maria alvarez" matches "Maria Alvarez-Reyes"
// but a bare "maria" surfaces every Maria for disambiguation.
export function contactMatchesHint(c: { fullName: string; email: string }, hint: string): boolean {
  const hay = normalize(`${c.fullName} ${c.email}`)
  const words = normalize(hint).split(' ').filter(Boolean)
  if (!hay || words.length === 0) return false
  return words.every((w) => hay.includes(w))
}

// Injectable seam so the unit test pins resolution/ambiguity with plain fakes.
export interface MatterPartyToolDeps {
  listContacts: (ctx: ActionContext) => Promise<ContactSummary[]>
  listMatterPartyContacts: (
    ctx: ActionContext,
    matterEntityId: string,
  ) => Promise<Array<{ id: string; fullName: string | null; email: string | null }>>
  linkContact: (
    ctx: ActionContext,
    matterEntityId: string,
    contactEntityId: string,
  ) => Promise<void>
}

const DEFAULT_DEPS: MatterPartyToolDeps = {
  listContacts,
  listMatterPartyContacts: async (ctx, matterEntityId) =>
    (await listMatterPartyContacts(ctx, matterEntityId)).map((p) => ({
      id: p.contactEntityId ?? '',
      fullName: p.name,
      email: p.email,
    })),
  linkContact: async (ctx, matterEntityId, contactEntityId) => {
    await submitAction(ctx, {
      actionKindName: 'matter.link_contact',
      intentKind: 'enforcement',
      payload: { matter_entity_id: matterEntityId, contact_entity_id: contactEntityId },
    })
  },
}

export function buildMatterPartiesTool(
  ctx: ActionContext,
  matterEntityId: string,
  deps: MatterPartyToolDeps = DEFAULT_DEPS,
): ClientTool {
  return {
    definition: GET_MATTER_PARTIES_TOOL_DEF,
    name: 'get_matter_parties',
    run: async () => {
      const parties = await deps.listMatterPartyContacts(ctx, matterEntityId)
      if (parties.length === 0) {
        return 'No additional parties are linked to this matter — only the primary client is on it. Tell the attorney that plainly.'
      }
      const lines = parties.map(
        (p) => `- ${p.fullName || '(no name on record)'}${p.email ? ` <${p.email}>` : ''}`,
      )
      return `The parties linked to this matter:\n${lines.join('\n')}`
    },
  }
}

export function buildLinkMatterContactTool(
  ctx: ActionContext,
  matterEntityId: string,
  deps: MatterPartyToolDeps = DEFAULT_DEPS,
): ClientTool {
  return {
    definition: LINK_MATTER_CONTACT_TOOL_DEF,
    name: 'link_matter_contact',
    run: async (raw) => {
      const args = (raw ?? {}) as { contact_hint?: string }
      const hint = (args.contact_hint ?? '').trim()
      if (!hint) return 'contact_hint is required; nothing was linked.'
      const contacts = await deps.listContacts(ctx)
      const hits = contacts.filter((c) => contactMatchesHint(c, hint))
      if (hits.length === 0) {
        return `No firm contact matched "${hint}", so nothing was linked. This tool never creates a new contact — if this is a new person, the attorney adds them on the Contacts page (or they arrive via intake) first.`
      }
      if (hits.length > 1) {
        const names = hits
          .slice(0, 6)
          .map((c) => `${c.fullName} <${c.email}>`)
          .join('; ')
        return `More than one contact matches "${hint}": ${names}${hits.length > 6 ? '; …' : ''}. Ask the attorney WHICH one, then call again.`
      }
      const contact = hits[0]!
      const existing = await deps.listMatterPartyContacts(ctx, matterEntityId)
      if (existing.some((p) => p.id === contact.contactEntityId)) {
        return `${contact.fullName} is already linked to this matter — nothing changed.`
      }
      await deps.linkContact(ctx, matterEntityId, contact.contactEntityId)
      return `${contact.fullName} is now linked to this matter as a party. Tell the attorney exactly that in one short sentence; the link shows on the matter and on the contact's CRM record.`
    },
  }
}
