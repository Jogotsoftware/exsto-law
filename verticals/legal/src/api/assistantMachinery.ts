// HARDENING-RESIDUALS-1 (WP-D6) — the ledger must never hold orchestration text
// as anyone's words. The app injects hidden driver turns (card-approval
// continuations, stage directions) wrapped in the ⟦…⟧ machinery sentinel; the
// RENDER layer already strips them (apps/legal-demo/lib/assistantText.ts), but
// pre-this-change they were PERSISTED verbatim inside assistant.turn messages
// and build-session messages, so any new reader of the ledger re-leaked them.
// This is the server-side mirror of the client sanitizer: persistence strips
// the sentinel spans and records `synthetic_driver: true` instead, so history
// stays honest ("this turn was app orchestration") without storing the
// machinery as the attorney's or the assistant's prose.
//
// The ledger is append-only — rows written before this change keep their ⟦…⟧
// text; the render layer remains the guarantee for those.

export const MACHINERY_OPEN = '⟦'
export const MACHINERY_CLOSE = '⟧'

export function containsMachinery(text: string | null | undefined): boolean {
  return !!text && (text.includes(MACHINERY_OPEN) || text.includes(MACHINERY_CLOSE))
}

// Remove every ⟦…⟧ span (multi-line), plus a trailing unclosed ⟦…, then tidy
// the blank runs a removed span leaves behind. Mirrors the client's
// stripMachinery exactly so persisted text and rendered text agree.
export function stripMachinerySpans(text: string): string {
  if (!text) return text
  let out = ''
  let i = 0
  while (i < text.length) {
    const open = text.indexOf(MACHINERY_OPEN, i)
    if (open === -1) {
      out += text.slice(i)
      break
    }
    out += text.slice(i, open)
    const close = text.indexOf(MACHINERY_CLOSE, open + 1)
    if (close === -1) break // unclosed sentinel: drop to end
    i = close + MACHINERY_CLOSE.length
  }
  return out
    .replace(/\n{3,}/g, '\n\n')
    .split(MACHINERY_CLOSE)
    .join('') // a stray close with no open is machinery too
    .trim()
}
