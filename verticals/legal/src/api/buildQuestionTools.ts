// Structured interview tool (Build-Wizard Phase 7, gated) — the headline UX fix that
// makes the guided build FEEL like a wizard instead of free chat. ONE capture-only
// ClientTool the orchestrator calls to ask the attorney a step question:
//   • buildAskQuestionTool — the model calls ask_build_question with a question, an
//     optional set of choices (value/label/hint), allowFreeText, multiSelect, and a
//     stable `key`. It is validated + CAPTURED into a per-turn array the caller
//     surfaces as a 'build_question' SSE event → a QuestionCard in the chat (choice
//     buttons + an input area). It writes NOTHING and asks NOTHING of the substrate —
//     it is pure UI orchestration: the attorney's click/typed answer comes back as a
//     HIDDEN continuation turn so the build proceeds without a fake user bubble.
//
// WHY a tool (not prose): the founder flagged that the interview read as a chat, not a
// wizard. Routing every interview question through this tool means the AI's questions
// always render as click-to-answer cards (single/multi choice, free text), so the
// attorney drives the build by clicking — the load-bearing "it feels like a wizard"
// change. Like the other propose_* tools it is capture-only and dormant unless the
// LEGAL_BUILD_WIZARD flag is on (see buildAttorneyClientTools), so flag-off the
// chatbot is byte-for-byte unchanged.
import type { ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'

// One choice on a structured question card. `value` is what the AI gets back (a stable
// token it asked to choose between); `label` is what the attorney sees; `hint` is an
// optional one-line clarifier under the label.
export interface BuildQuestionChoice {
  value: string
  label: string
  hint?: string
}

// A structured interview question captured this turn — surfaced as a QuestionCard. The
// attorney answers by clicking a choice (or submitting free text); the answer rides
// back as a HIDDEN continuation so the build advances with no fake user bubble.
export interface BuildQuestion {
  // Stable key for this question (e.g. 'route', 'generation_mode', 'step_3_gate') —
  // echoed back with the answer so the model knows which question was answered.
  key: string
  question: string
  // Optional clickable choices. Omit (with allowFreeText) for a pure free-text ask.
  choices: BuildQuestionChoice[]
  // Allow a free-text answer in addition to (or instead of) the choices.
  allowFreeText: boolean
  // Let the attorney pick more than one choice (e.g. "which documents does the client
  // get?"). The card collects a set and submits them together.
  multiSelect: boolean
}

const ASK_BUILD_QUESTION_TOOL_DEF = {
  name: 'ask_build_question',
  description:
    "Ask the attorney a structured interview question during a guided service build, rendered as a click-to-answer card (choice buttons and/or a text box) — NOT as free chat. One call = one question, but BATCH a related group by calling this several times in the SAME turn (keep a batch to ~4) — each call renders its own card and the attorney's answers come back TOGETHER, keyed by question, in the next message. Use this for EVERY interview question in the build — the process walkthrough, the derived-choice confirmations, prices, and per-step gates. PHRASE EVERY QUESTION IN ATTORNEY LANGUAGE — never platform vocabulary (no 'route', 'generation_mode', 'kind', 'gate', 'entity'): ask who does what and what the client gets ('Does the draft come to you before the client ever sees it?'), and translate to schema silently in the proposal. When a choice was DERIVED from the attorney's own walkthrough, present it as a confirmation ('Sounds like X — right?') with choices, not an open question — and never ask anything the walkthrough or a get_*_context read already answers. Provide `choices` whenever the answer is one of a known set (so the attorney clicks instead of typing), set `multiSelect: true` when several may apply, and set `allowFreeText: true` when a typed answer should also be allowed. After the batch, STOP and wait — the answers come back as the next message; do not also ask the questions in prose. Your chat reply alongside the batch should be a SINGLE short sentence framing it (or empty).",
  input_schema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description:
          "A stable identifier for this question, snake_case (e.g. 'route', 'generation_mode', 'documents', 'step_3_gate'). Echoed back with the answer.",
      },
      question: {
        type: 'string',
        description: 'The question to ask the attorney, in plain client-facing language.',
      },
      choices: {
        type: 'array',
        description:
          'Optional clickable answers. Provide whenever the answer is one of a known set so the attorney clicks rather than types.',
        items: {
          type: 'object',
          properties: {
            value: {
              type: 'string',
              description: 'The stable value handed back to you when this choice is picked.',
            },
            label: { type: 'string', description: 'What the attorney sees on the button.' },
            hint: {
              type: 'string',
              description: 'An optional one-line clarifier under the label.',
            },
          },
          required: ['value', 'label'],
          additionalProperties: false,
        },
      },
      allow_free_text: {
        type: 'boolean',
        description: 'Allow a typed answer in addition to (or instead of) the choices.',
      },
      multi_select: {
        type: 'boolean',
        description: 'Let the attorney pick more than one choice (the answers come back together).',
      },
    },
    required: ['key', 'question'],
    additionalProperties: false,
  },
}

// Build the ask_build_question tool for this turn. Capture-only: it validates the
// shape and CAPTURES the question into `captured` (read back by the caller to emit a
// 'build_question' event / render a QuestionCard) — it never reads or writes the
// substrate. The ack tells the model to STOP and wait for the attorney's answer so it
// doesn't also dump the question (and any choices) into prose. ctx is unused (pure UI
// orchestration) but kept for signature symmetry with the other build tools.
export function buildAskQuestionTool(ctx: ActionContext, captured: BuildQuestion[]): ClientTool {
  void ctx
  return {
    definition: ASK_BUILD_QUESTION_TOOL_DEF,
    name: 'ask_build_question',
    run: async (raw) => {
      const args = (raw ?? {}) as {
        key?: string
        question?: string
        choices?: Array<{ value?: string; label?: string; hint?: string }>
        allow_free_text?: boolean
        multi_select?: boolean
      }
      const key = (args.key ?? '').trim()
      const question = (args.question ?? '').trim()
      if (!key) return 'A key is required to ask a build question; nothing was captured.'
      if (!question) return 'A question is required to ask a build question; nothing was captured.'
      // Normalize choices: drop any without a value+label so a malformed choice never
      // renders a dead button.
      const choices: BuildQuestionChoice[] = (Array.isArray(args.choices) ? args.choices : [])
        .map((c) => ({
          value: (c.value ?? '').trim(),
          label: (c.label ?? '').trim(),
          hint: (c.hint ?? '').trim() || undefined,
        }))
        .filter((c) => c.value && c.label)
      // A question with no choices is implicitly free-text (otherwise it would be
      // unanswerable), so force allowFreeText on when there are no choices.
      const allowFreeText = choices.length === 0 ? true : args.allow_free_text === true
      const multiSelect = args.multi_select === true && choices.length > 0
      captured.push({ key, question, choices, allowFreeText, multiSelect })
      return `The question "${question}" is shown to the attorney as a click-to-answer card. If more questions belong in this same batch (related, ~4 max), call ask_build_question again NOW in this turn; otherwise STOP and WAIT — the answer(s) to every card in the batch arrive together as the next message. Do NOT repeat the questions or choices in your prose reply; reply with at most ONE short framing sentence (or nothing).`
    },
  }
}
