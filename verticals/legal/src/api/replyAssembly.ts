// UI-BUILDER-FIX-1 item 8 — collapse the multi-round "duplicate sentence"
// stutter. ROOT CAUSE: a tool turn produces text in MORE THAN ONE model round
// (framing sentence → tool call → post-tool reply), and the rounds' text blocks
// are CONCATENATED into one reply. When the model restates its framing line
// after the tool result — told to reply empty, it often doesn't — the persisted
// reply reads "Here's the pricing to approve.Here's the flat $450 pricing to
// approve…". The stream got paragraph breaks earlier (founder-reported); the
// RESTATEMENT itself was never collapsed.
//
// Pure, conservative collapse: a paragraph is dropped only when its ENTIRE
// token sequence is contained in ORDER within the opening of the paragraph that
// follows it — i.e. the next fragment restates it (usually with more detail).
// The richer restatement wins; ordinary consecutive paragraphs (which add NEW
// tokens, not a superset restatement) are untouched.

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

export function collapseRoundStutter(reply: string): string {
  const trimmed = (reply ?? '').trim()
  if (!trimmed) return trimmed
  const frags = splitFragments(trimmed)
  if (frags.length < 2) return trimmed

  const kept: string[] = []
  for (let i = 0; i < frags.length; i++) {
    const cur = frags[i]!
    const next = frags[i + 1]
    if (next) {
      const curTokens = tokens(cur)
      // Compare against the NEXT fragment's opening (twice the stutter's length
      // is plenty for "same line restated with a few added words").
      const nextOpening = tokens(next.slice(0, Math.max(240, cur.length * 2)))
      if (
        curTokens.length > 0 &&
        curTokens.length <= MAX_STUTTER_TOKENS &&
        isOrderedSubset(curTokens, nextOpening)
      ) {
        continue // cur is a stutter of next — the richer restatement wins
      }
    }
    kept.push(cur)
  }
  return kept.join('\n\n')
}
