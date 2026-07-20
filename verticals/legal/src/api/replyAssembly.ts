// UI-BUILDER-FIX-1 item 8 — collapse the multi-round "duplicate sentence"
// stutter. ROOT CAUSE: a tool turn produces text in MORE THAN ONE model round
// (framing sentence → tool call → post-tool reply), and the rounds' text blocks
// are CONCATENATED into one reply. When the model restates its framing line
// after the tool result — told to reply empty, it often doesn't — the persisted
// reply reads "Here's the pricing to approve.Here's the flat $450 pricing to
// approve…". The stream got paragraph breaks earlier (founder-reported); the
// RESTATEMENT itself was never collapsed.
//
// Pure, conservative collapse, two passes (AI-CONTEXT A4 added pass 2 and
// widened pass 1 past adjacency — see collapseRoundStutter for both):
//   1. A short fragment is dropped when SOME later, strictly richer fragment
//      restates it — ordered-subset match against that later fragment's
//      opening. Scans every later fragment, not only the immediate next one,
//      so a restatement separated by other text (a tool-result aside,
//      reasoning narration) is still caught. The richer restatement wins.
//   2. A short TRAILING fragment is dropped when it duplicates content an
//      EARLIER fragment already said — ordered-subset match against that
//      earlier fragment, also allowing other text in between. Direction is
//      mirrored from pass 1: the earlier fragment wins and the redundant
//      verbatim tail repeat is dropped.
// Both passes are bounded by MAX_STUTTER_TOKENS and conservative by
// construction: an ordered-subset match requires every token of the dropped
// fragment to appear, in order, inside the surviving one, so ordinary
// consecutive paragraphs that add NEW tokens (not a superset/subset
// restatement) are untouched.

function tokens(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9$&%]+/g) ?? []
}

// True when `needle`'s tokens all appear IN ORDER within `hay` (subsequence).
function isOrderedSubset(needle: string[], hay: string[]): boolean {
  if (needle.length === 0) return false
  let i = 0
  for (const t of hay) {
    if (t === needle[i]) i++
    if (i === needle.length) return true
  }
  return false
}

// A "paragraph" here is a fragment the round-stitcher joined: split on blank
// lines AND on sentence boundaries glued without whitespace ("approve.Here's"),
// which is exactly how the non-streaming path concatenates rounds.
function splitFragments(reply: string): string[] {
  return reply
    .replace(/([.!?])(?=[A-Z"“])/g, '$1\n\n') // unglue "….Here's" seams
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
}

const MAX_STUTTER_TOKENS = 40 // framing lines are short; never collapse real content

// HARDENING-RESIDUALS-1 (WP-D4) — card turns speak ONE framing sentence.
// AI-CONTEXT A4 extended collapseRoundStutter (below) to also catch the
// reasoning-paragraph-then-restate turn and the verbatim tail repeat
// separated by other text (both previously missed — see its own comment for
// how). Wizard-mode card turns still bypass it, not because it can't dedupe
// them, but because a card turn needs exactly ONE deterministic framing
// sentence naming the card — not "whichever fragments survive a dedup pass."
// So turns that rendered a card stay collapsed DETERMINISTICALLY: the
// persisted reply is the first sentence of the first text round (the
// pre-tool framing — "what the card is"), and every post-tool text round is
// dropped. Reasoning narration belongs in the thinking channel; the cards
// carry the substance.
export function framingSentenceForCardTurn(roundTexts: string[]): string {
  const first = roundTexts.map((t) => (t ?? '').trim()).find(Boolean)
  if (!first) return ''
  // First sentence of the first non-empty round. Sentence end = ./!/? followed
  // by whitespace or end-of-text; markdown links and abbreviations survive
  // because we only split on terminator+whitespace.
  const m = first.match(/^[\s\S]*?[.!?](?=\s|$)/)
  return (m ? m[0] : first.split(/\n/, 1)[0]!).trim()
}

// BUILDER-UX-3 (P5) — the framing sentence must MATCH the card the turn actually
// emitted. The model speaks its framing BEFORE the tool call, so a failed compose
// that recovers with a different card ("Here's the workflow to approve." → workflow
// rejected → cost card captured) leaves a stale line above the wrong card. Derive
// the framing from WHICH capture arrays are non-empty: keep the model's sentence
// only when it plausibly names an emitted card kind; otherwise substitute the
// card's own deterministic label. Pure — both collapse sites (stream + non-stream)
// call it with their captured counts.
export type WizardCardKind =
  | 'question'
  | 'kind'
  | 'service'
  | 'template'
  | 'questionnaire'
  | 'cost'
  | 'workflow'
  | 'enable'

// Doctrine build order (shell → documents → questionnaire → billing → workflow →
// enable), with interview questions and data-kind cards ahead of any proposal. A
// multi-kind turn frames the doctrine-order-LAST card — the furthest step reached.
const CARD_KIND_ORDER: WizardCardKind[] = [
  'question',
  'kind',
  'service',
  'template',
  'questionnaire',
  'cost',
  'workflow',
  'enable',
]

// Per-kind "plausibly names this card" checks — deliberately loose keyword hits,
// not exact copy matching, so any honest model framing survives.
const CARD_KIND_HINTS: Record<WizardCardKind, RegExp> = {
  question: /question|confirm/i,
  kind: /field|track/i,
  service: /service|offering/i,
  template: /template|document/i,
  questionnaire: /questionnaire|intake|form/i,
  cost: /pric|fee|billing|cost/i,
  workflow: /workflow|steps/i,
  enable: /enable|live|bookable|publish/i,
}

const CARD_KIND_LABELS: Record<WizardCardKind, string> = {
  question: 'A few quick questions.',
  kind: "Here's the new field to approve.",
  service: "Here's the service to approve.",
  template: "Here's the document template to approve.",
  questionnaire: "Here's the questionnaire to approve.",
  cost: "Here's the pricing to approve.",
  workflow: "Here's the workflow to approve.",
  enable: 'Approve to make the service live.',
}

export function framingSentenceForCards(
  roundTexts: string[],
  captured: Partial<Record<WizardCardKind, number>>,
): string {
  const kinds = CARD_KIND_ORDER.filter((k) => (captured[k] ?? 0) > 0)
  const sentence = framingSentenceForCardTurn(roundTexts)
  if (kinds.length === 0) return sentence
  const last = kinds[kinds.length - 1]!
  if (sentence && kinds.some((k) => CARD_KIND_HINTS[k].test(sentence))) return sentence
  // A question-only turn is conversational — whatever the model wrote frames it
  // ("Tell me how this works in your practice…") — unless the sentence names a
  // DIFFERENT card kind: a stale "Here's the workflow to approve." left over from
  // a redirected compose must not sit above a question card.
  if (
    sentence &&
    last === 'question' &&
    !CARD_KIND_ORDER.some((k) => k !== 'question' && CARD_KIND_HINTS[k].test(sentence))
  ) {
    return sentence
  }
  return CARD_KIND_LABELS[last]
}

export function collapseRoundStutter(reply: string): string {
  const trimmed = (reply ?? '').trim()
  if (!trimmed) return trimmed
  const frags = splitFragments(trimmed)
  if (frags.length < 2) return trimmed

  const fragTokens = frags.map(tokens)
  const dropped: boolean[] = frags.map(() => false)

  // Pass 1 — short fragment restated by a LATER, richer fragment. Scans every
  // subsequent fragment (not just the immediate next one), so a restatement
  // separated by other text (a tool-result aside, reasoning narration) is
  // still caught. "Richer" is a strict token-count comparison so an exact
  // duplicate (a tie) is left for pass 2, which drops the trailing copy
  // instead of the leading one.
  for (let i = 0; i < frags.length; i++) {
    const curTokens = fragTokens[i]!
    if (curTokens.length === 0 || curTokens.length > MAX_STUTTER_TOKENS) continue
    for (let j = i + 1; j < frags.length; j++) {
      if (dropped[j]) continue
      const nextTokens = fragTokens[j]!
      if (nextTokens.length <= curTokens.length) continue // not richer — pass 2's shape
      // Compare against the LATER fragment's opening (twice the stutter's
      // length is plenty for "same line restated with a few added words").
      const nextOpening = tokens(frags[j]!.slice(0, Math.max(240, frags[i]!.length * 2)))
      if (isOrderedSubset(curTokens, nextOpening)) {
        dropped[i] = true // cur is a stutter of a later fragment — the richer restatement wins
        break
      }
    }
  }

  // Pass 2 — a TRAILING fragment that verbatim-repeats an EARLIER fragment,
  // possibly separated by other text. Mirror direction of pass 1: the earlier
  // fragment (equal or richer, since it must contain every token of the
  // trailing one, in order) wins and the redundant repeat is dropped.
  for (let j = 1; j < frags.length; j++) {
    if (dropped[j]) continue
    const curTokens = fragTokens[j]!
    if (curTokens.length === 0 || curTokens.length > MAX_STUTTER_TOKENS) continue
    for (let i = 0; i < j; i++) {
      if (dropped[i]) continue
      if (isOrderedSubset(curTokens, fragTokens[i]!)) {
        dropped[j] = true // cur repeats an earlier fragment — the earlier original wins
        break
      }
    }
  }

  return frags.filter((_, idx) => !dropped[idx]).join('\n\n')
}
