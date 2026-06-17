// Context assembly for the unified assistant chat. The attorney wants the chat
// to "pick up all the context from the client/matter you are currently on", so
// when a turn is scoped to a matter or contact we build a compact briefing and
// inject it into the system prompt.
//
// PRIVACY BOUNDARY (critical): two views are produced.
//   • `full`    — rich, includes client name/email and matter specifics. Safe
//                 ONLY for the firm's own model (Claude/Anthropic), which already
//                 sees full matter content during drafting.
//   • `framing` — short, NON-confidential (practice area + jurisdiction only, no
//                 names, emails, or matter numbers). This is all that may go to an
//                 EXTERNAL research provider (Perplexity), mirroring the existing
//                 research adapter's discipline: the matter scopes WHERE the answer
//                 is recorded, not what leaves the firm.
// The chat layer picks the view by provider, so client PII never leaves the firm
// through a third-party research call.
import type { ActionContext } from '@exsto/substrate'
import { getMatter } from '../queries/matters.js'
import { getContact } from '../queries/contacts.js'
import { matterCommunications } from './mailWorkspace.js'

export interface AssistantContext {
  full: string
  framing: string
  // Human label for the UI ("Matter 2025-014" / "Acme LLC").
  label: string
}

const JURISDICTION = 'U.S. North Carolina business-law firm'

export async function buildMatterAssistantContext(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<AssistantContext | null> {
  const matter = await getMatter(ctx, matterEntityId)
  if (!matter) return null

  // Recent client communications (subjects only) give the model situational
  // awareness without dumping full email bodies into the prompt.
  let recentSubjects: string[] = []
  try {
    const comms = await matterCommunications(ctx, matterEntityId)
    recentSubjects = comms.slice(0, 5).map((c) => c.subject)
  } catch {
    // Communications are best-effort context; never block the chat on them.
  }

  const lines = [
    `You are helping with matter ${matter.matterNumber} (practice area: ${matter.serviceKey || 'unspecified'}, status: ${matter.status}).`,
    `Client: ${matter.clientName || 'unknown'}${matter.clientEmail ? ` <${matter.clientEmail}>` : ''}.`,
  ]
  if (matter.summary) lines.push(`Summary: ${matter.summary}`)
  if (recentSubjects.length) {
    lines.push(`Recent client communications: ${recentSubjects.join('; ')}.`)
  }

  return {
    full: lines.join('\n'),
    framing: `Context: ${JURISDICTION}; practice area ${matter.serviceKey || 'business law'}.`,
    label: `Matter ${matter.matterNumber}`,
  }
}

export async function buildContactAssistantContext(
  ctx: ActionContext,
  contactEntityId: string,
): Promise<AssistantContext | null> {
  const contact = await getContact(ctx, contactEntityId)
  if (!contact) return null

  const lines = [
    `You are helping with client contact ${contact.fullName || 'unknown'}${contact.email ? ` <${contact.email}>` : ''}${contact.companyName ? `, ${contact.companyName}` : ''}.`,
  ]
  if (contact.matters.length) {
    lines.push(`Their matters: ${contact.matters.map((m) => m.matterNumber).join(', ')}.`)
  }

  return {
    full: lines.join('\n'),
    framing: `Context: ${JURISDICTION}; a business-law client contact.`,
    label: contact.fullName || contact.companyName || 'Contact',
  }
}
