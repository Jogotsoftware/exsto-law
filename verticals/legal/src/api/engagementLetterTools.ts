// CHATBOT-CATCHUP-1 — chat wrappers over the engagement-letter LIBRARY
// (engagementLibrary.ts, ENGAGEMENT-TEMPLATES-1). Two tools:
//   • list_engagement_letters — READ-ONLY: the firm's letters, default first.
//   • set_default_engagement_letter — a firm-scoped, fully reversible pointer
//     write (the same op the Settings → Engagement Letters page performs), so
//     it is a Wave-1 direct write, not a proposal. The letter is resolved by
//     NAME server-side — the model never passes a templateId it could
//     hallucinate; ambiguity comes back as an instructive result.
// Removing/retiring a letter deliberately has NO chat verb (destructive-ish;
// stays on the Settings surface).
import type { ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'
import {
  listEngagementLetters,
  setDefaultEngagementLetter,
  type EngagementLetterSummary,
} from './engagementLibrary.js'

const LIST_ENGAGEMENT_LETTERS_TOOL_DEF = {
  name: 'list_engagement_letters',
  description:
    "List the firm's ENGAGEMENT LETTERS — the editable template library behind Settings → Engagement Letters. READ-ONLY. The one marked default is what the client portal's engagement gate shows clients to sign. Call it when the attorney asks about their engagement letters, which one is the default, or before changing the default. Each letter is an ordinary template editable at /attorney/templates. Report only what it returns; if the firm has none, say so plainly.",
  input_schema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
}

const SET_DEFAULT_ENGAGEMENT_LETTER_TOOL_DEF = {
  name: 'set_default_engagement_letter',
  description:
    "Make one of the firm's engagement letters the DEFAULT the client portal's engagement gate shows clients. Pass the letter as the attorney named it (name words) — the platform resolves it against the library; never pass or invent an id. If more than one letter matches, the result lists them: ask the attorney WHICH one, then call again. This changes which letter NEW clients sign — say which letter is now the default in your reply. Fully reversible (set another default any time).",
  input_schema: {
    type: 'object',
    properties: {
      letter_hint: {
        type: 'string',
        description:
          "The engagement letter as the attorney referred to it — name words (e.g. 'flat-fee LLC letter', 'litigation'). Matched case-insensitively against the library.",
      },
    },
    required: ['letter_hint'],
    additionalProperties: false,
  },
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function matches(candidate: string, query: string): boolean {
  const c = normalize(candidate)
  const q = normalize(query)
  if (!c || !q) return false
  return c === q || c.includes(q) || q.includes(c)
}

export function renderEngagementLettersForModel(letters: EngagementLetterSummary[]): string {
  if (letters.length === 0) {
    return 'The firm has no engagement letters in its library yet. The attorney can add one at Settings → Engagement Letters (the portal gate falls back to text-terms-only acceptance until then).'
  }
  const lines = letters.map(
    (l) => `- ${l.name}${l.isDefault ? ' — DEFAULT (what clients sign)' : ''}`,
  )
  return `The firm's engagement letters (editable at Settings → Engagement Letters):\n${lines.join('\n')}`
}

// Injectable seam so the unit test pins both tools with plain fakes — no DB.
export interface EngagementLetterToolDeps {
  listEngagementLetters: (ctx: ActionContext) => Promise<EngagementLetterSummary[]>
  setDefaultEngagementLetter: (
    ctx: ActionContext,
    templateId: string,
  ) => Promise<{ templateId: string | null }>
}

const DEFAULT_DEPS: EngagementLetterToolDeps = {
  listEngagementLetters,
  setDefaultEngagementLetter,
}

export function buildListEngagementLettersTool(
  ctx: ActionContext,
  deps: EngagementLetterToolDeps = DEFAULT_DEPS,
): ClientTool {
  return {
    definition: LIST_ENGAGEMENT_LETTERS_TOOL_DEF,
    name: 'list_engagement_letters',
    run: async () => {
      const letters = await deps.listEngagementLetters(ctx)
      return renderEngagementLettersForModel(letters)
    },
  }
}

export function buildSetDefaultEngagementLetterTool(
  ctx: ActionContext,
  deps: EngagementLetterToolDeps = DEFAULT_DEPS,
): ClientTool {
  return {
    definition: SET_DEFAULT_ENGAGEMENT_LETTER_TOOL_DEF,
    name: 'set_default_engagement_letter',
    run: async (raw) => {
      const args = (raw ?? {}) as { letter_hint?: string }
      const hint = (args.letter_hint ?? '').trim()
      if (!hint) return 'letter_hint is required; nothing was changed.'
      const letters = await deps.listEngagementLetters(ctx)
      if (letters.length === 0) {
        return 'The firm has no engagement letters yet, so there is nothing to set as default. The attorney can add one at Settings → Engagement Letters.'
      }
      const hits = letters.filter((l) => matches(l.name, hint))
      if (hits.length === 0) {
        return `No engagement letter matched "${hint}". The library: ${letters.map((l) => l.name).join('; ')}. Ask the attorney which one they mean.`
      }
      if (hits.length > 1) {
        return `More than one letter matches "${hint}": ${hits.map((l) => l.name).join('; ')}. Ask the attorney WHICH one, then call again.`
      }
      const letter = hits[0]!
      if (letter.isDefault) {
        return `"${letter.name}" is already the firm's default engagement letter — nothing changed.`
      }
      await deps.setDefaultEngagementLetter(ctx, letter.templateId)
      return `"${letter.name}" is now the firm's default engagement letter — this is what new clients sign at the portal gate. Tell the attorney exactly that in one short sentence; they can review it at Settings → Engagement Letters.`
    },
  }
}
