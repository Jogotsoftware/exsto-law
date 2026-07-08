// Model-facing record of an assistant turn that spoke through cards (WP4.1).
// Tool-call turns (ask_build_question, propose_*) often carry no prose, so their
// committed `content` is '' — and a turn absent from history means the model
// forgets it ever asked or proposed.
//
// 1.1 REFRAME (the leak fix): these notes used to be BRACKETED PSEUDO-PROSE
// ("[You asked via ask_build_question (key …): <verbatim question>]") appended to
// the assistant's OWN reply. The model saw them as its own prior words and imitated
// them — typing the annotation as visible prose instead of calling the tool (real
// build transcripts showed exactly this). Two changes break the imitation:
//   • every note is wrapped in the ⟦…⟧ machinery sentinel (stripMachinery removes it
//     from any rendered text, and the prompt tells the model never to reproduce it),
//   • the notes are now TERSE and carry NO verbatim question text and NO field/token
//     dumps — the live BUILD BRIEF (injected fresh every turn) already carries the
//     artifact substance, so history only needs to say "a card was shown", not repeat
//     its contents. Less to imitate, nothing lost.
//
// Deliberately structural/defensive over loose shapes (no imports from the card
// components): history encoding must never crash a send over a missing field.
import { MACHINERY_OPEN, MACHINERY_CLOSE } from './assistantText'

interface BuildQuestionLike {
  key?: string
  question?: string
}
interface CardsLike {
  buildQuestions: BuildQuestionLike[]
  workflowProposals: Array<{
    serviceKey?: string
    summary?: string
    graph?: Array<{
      key?: string
      action?: { kind?: string }
      advances_to?: Array<{ gate?: string }>
    }>
  }>
  serviceProposals: Array<{
    displayName?: string
    derivedKey?: string
    route?: string
    generationMode?: string
    description?: string | null
  }>
  questionnaireProposals: Array<{
    serviceKey?: string
    schema?: {
      sections?: Array<{ fields?: Array<{ id?: string; memberFields?: Array<{ id?: string }> }> }>
    }
    missingForTokens?: string[]
    unusedFields?: string[]
  }>
  templateProposals: Array<{
    serviceKey?: string
    name?: string
    docKind?: string
    tokens?: string[]
    orphanTokens?: string[]
  }>
  costProposals: Array<{
    serviceKey?: string
    costType?: string
    amount?: string
    hours?: number | null
  }>
  enableProposals: Array<{ serviceKey?: string }>
  kindProposals: Array<{
    registry?: string
    kindName?: string
    onEntityKind?: string | null
    valueType?: string | null
  }>
  // Non-fatal warnings surfaced on this turn (e.g. the tool-round cap) — replayed
  // so the model knows a step was cut off and can resume it.
  notices?: string[]
}

// Wrap a terse state note in the machinery sentinel. stripMachinery removes it from
// any rendered text; the model is told (prompt rule) never to reproduce these
// characters or their content. Substance lives in the BUILD BRIEF, so notes stay short.
function machinery(text: string): string {
  return `${MACHINERY_OPEN}${text}${MACHINERY_CLOSE}`
}

export function assistantHistoryContent(reply: string, cards: CardsLike): string | undefined {
  const parts: string[] = []
  const n = cards.buildQuestions.length
  if (n) parts.push(`asked the attorney ${n === 1 ? 'a question' : `${n} questions`} via cards`)
  for (const p of cards.serviceProposals) {
    parts.push(`proposed the service shell "${p.derivedKey ?? p.displayName ?? '?'}"`)
  }
  for (const p of cards.templateProposals) {
    parts.push(`proposed a document template for "${p.serviceKey ?? '?'}"`)
  }
  for (const p of cards.questionnaireProposals) {
    parts.push(`proposed the intake questionnaire for "${p.serviceKey ?? '?'}"`)
  }
  for (const p of cards.workflowProposals) {
    parts.push(`proposed the workflow for "${p.serviceKey ?? '?'}"`)
  }
  for (const p of cards.costProposals) parts.push(`proposed billing for "${p.serviceKey ?? '?'}"`)
  for (const p of cards.kindProposals)
    parts.push(`proposed a new data field "${p.kindName ?? '?'}"`)
  for (const p of cards.enableProposals) parts.push(`proposed ENABLING "${p.serviceKey ?? '?'}"`)
  for (const _n of cards.notices ?? []) parts.push('a system notice was shown to the attorney')

  if (!parts.length) return undefined
  // The current build state (fields/tokens/steps) is in the injected BUILD BRIEF —
  // this note only records THAT cards were shown so a card-only turn isn't empty.
  // MUST NOT contain the sentinel characters itself (that would close the wrapper
  // early); describe them in words instead.
  const noteBody =
    `this turn spoke through approval/question cards (the attorney acts on them in the UI): ` +
    `${parts.join('; ')}. The live state is in the Current-build brief above — re-read it; ` +
    `never repeat this note or any internal marker to the attorney.`
  // Keep the model's own framing prose (real words), append the machinery note.
  return [reply, machinery(noteBody)].filter(Boolean).join('\n')
}
