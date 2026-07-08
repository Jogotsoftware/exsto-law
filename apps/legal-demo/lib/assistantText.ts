// Render-layer guarantee (BUILDER-HARDENING-1.1, governing principle): the
// transcript shows ONLY the assistant's own words + cards. MACHINERY — tool-call
// annotations, history-replay state notes, injected continuation/stage-direction
// instructions — must NEVER appear as visible message text.
//
// Root cause we are defending against: the build's model-facing history used to
// append bracketed pseudo-prose ("[You asked via ask_build_question (key …): …]")
// to the assistant's OWN turn, so the model saw it as something it had said and
// imitated it — typing the annotation as prose instead of calling the tool. Three
// layers now stop that: (1) history notes are wrapped in the ⟦…⟧ sentinel and kept
// terse (buildHistoryContent), (2) this sanitizer strips any machinery that still
// reaches rendered text — the last-line guarantee, (3) a prompt rule tells the model
// never to reproduce it. This helper is layer 2 and runs on every rendered assistant
// string (committed replies AND the live stream), so a leak can never be shown even
// if the model emits one.

// Internal-machinery sentinel. Anything wrapped in these characters is a note FOR
// the model, never for the attorney; the model is told never to reproduce them.
export const MACHINERY_OPEN = '⟦'
export const MACHINERY_CLOSE = '⟧'

// Legacy bracketed machinery forms that may still sit in a stored conversation's
// history (pre-1.1) or that a model might parrot. A line beginning with any of these
// is a state note, never attorney-facing prose — safe to drop wholesale (no genuine
// reply opens this way).
const LEGACY_LINE_PREFIXES = [
  '[You asked via ask_build_question',
  '[You proposed',
  '[You presented',
  '[The attorney approves cards',
  '[Notice shown to the attorney',
  "[I'll continue",
  '[I need your next answer',
  '[build-state]',
]

// Strip all machinery from a piece of assistant text before it is rendered.
// - Removes every ⟦…⟧ span (the sentinel form), including multi-line.
// - Removes a trailing UNCLOSED ⟦… (a sentinel half-streamed token-by-token) so a
//   marker never flashes mid-stream before its close arrives.
// - Drops any line that opens with a legacy bracketed state note.
// Conservative by construction: it only touches the sentinel and an explicit
// allowlist of machinery prefixes, so ordinary prose (including legitimate square
// brackets like markdown links) is never altered.
export function stripMachinery(text: string): string {
  if (!text) return text
  let out = ''
  let i = 0
  // Remove complete ⟦…⟧ spans.
  while (i < text.length) {
    const open = text.indexOf(MACHINERY_OPEN, i)
    if (open === -1) {
      out += text.slice(i)
      break
    }
    out += text.slice(i, open)
    const close = text.indexOf(MACHINERY_CLOSE, open + 1)
    if (close === -1) {
      // Unclosed sentinel (mid-stream): hide from here to the end.
      break
    }
    i = close + MACHINERY_CLOSE.length
  }
  // Drop legacy machinery lines.
  const kept = out
    .split('\n')
    .filter((line) => {
      const t = line.trimStart()
      return !LEGACY_LINE_PREFIXES.some((p) => t.startsWith(p))
    })
    .join('\n')
  // Collapse the blank runs a removed line can leave behind, and trim the edges.
  return kept.replace(/\n{3,}/g, '\n\n').trim()
}
