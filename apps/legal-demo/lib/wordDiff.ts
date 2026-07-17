// Word-level redline for the WP-C tracked-changes flagship. The reader diffs the
// current version's markdown against the AI-revised markdown and renders the
// result inline: deletions red + strikethrough, insertions green + underline,
// unchanged text plain — the comp's run-level "AI revision — tracked changes"
// view (docs/design/legal-instruments, buildRedline interaction model).
//
// Strategy: align paragraphs (lines) with the existing line LCS, then within each
// changed hunk pair removed/added lines and diff them WORD by word. A line changed
// in place reads as a tight in-line redline; a line only removed/added shows as a
// whole struck/inserted paragraph. Dependency-free; O(n·m) over words per hunk —
// fine for legal drafts.

import { lineDiff, type DiffOp } from './lineDiff'

export type RedlineRunKind = 'same' | 'del' | 'ins'
export interface RedlineRun {
  text: string
  kind: RedlineRunKind
}
export interface RedlineParagraph {
  runs: RedlineRun[]
}

// Coalesce adjacent runs of the same kind so the DOM stays small and selections
// read naturally.
function coalesce(runs: RedlineRun[]): RedlineRun[] {
  const out: RedlineRun[] = []
  for (const run of runs) {
    if (run.text === '') continue
    const last = out[out.length - 1]
    if (last && last.kind === run.kind) last.text += run.text
    else out.push({ ...run })
  }
  return out
}

// Word-level LCS diff of two single lines → runs. Tokens keep their trailing
// whitespace (split on the boundary) so reconstruction preserves spacing.
function wordRuns(a: string, b: string): RedlineRun[] {
  const at = a.split(/(\s+)/).filter((t) => t !== '')
  const bt = b.split(/(\s+)/).filter((t) => t !== '')
  const n = at.length
  const m = bt.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        at[i] === bt[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const runs: RedlineRun[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (at[i] === bt[j]) {
      runs.push({ text: at[i]!, kind: 'same' })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      runs.push({ text: at[i]!, kind: 'del' })
      i++
    } else {
      runs.push({ text: bt[j]!, kind: 'ins' })
      j++
    }
  }
  while (i < n) runs.push({ text: at[i++]!, kind: 'del' })
  while (j < m) runs.push({ text: bt[j++]!, kind: 'ins' })
  return coalesce(runs)
}

// Flush a run of consecutive removed + added lines: pair them up (a changed line),
// word-diff each pair, and emit any leftover as whole del / ins paragraphs.
function flushHunk(dels: string[], adds: string[], out: RedlineParagraph[]): void {
  const paired = Math.min(dels.length, adds.length)
  for (let k = 0; k < paired; k++) out.push({ runs: wordRuns(dels[k]!, adds[k]!) })
  for (let k = paired; k < dels.length; k++)
    out.push({ runs: coalesce([{ text: dels[k]!, kind: 'del' }]) })
  for (let k = paired; k < adds.length; k++)
    out.push({ runs: coalesce([{ text: adds[k]!, kind: 'ins' }]) })
}

// The whole redline as an ordered list of paragraphs (one per source line). An
// empty paragraph (no runs) preserves a blank line's spacing.
export function buildRedline(base: string, revised: string): RedlineParagraph[] {
  const ops: DiffOp[] = lineDiff(base, revised)
  const out: RedlineParagraph[] = []
  let dels: string[] = []
  let adds: string[] = []
  const flush = (): void => {
    if (dels.length || adds.length) {
      flushHunk(dels, adds, out)
      dels = []
      adds = []
    }
  }
  for (const op of ops) {
    if (op.type === 'del') dels.push(op.line)
    else if (op.type === 'add') adds.push(op.line)
    else {
      flush()
      out.push({ runs: op.line === '' ? [] : [{ text: op.line, kind: 'same' }] })
    }
  }
  flush()
  return out
}

// Strip common markdown markers so the tracked-changes view reads as clean prose
// (the comp's redline is rendered text, not source). Display-only: the accepted
// version always persists the FULL markdown, never this readable form.
export function toReadableText(md: string): string {
  return md
    .split('\n')
    .map((line) => {
      const t = line
        .replace(/^\s{0,3}#{1,6}\s+/, '') // ATX headings
        .replace(/^\s{0,3}>\s?/, '') // blockquote
        .replace(/^\s{0,3}[-*+]\s+/, '') // bullet lists
        .replace(/^\s{0,3}\d+\.\s+/, '') // ordered lists
        .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
        .replace(/__([^_]+)__/g, '$1')
        .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '$1') // italic *
        .replace(/(?<![\w_])_(?!_)([^_]+)_(?![\w_])/g, '$1') // italic _
        .replace(/`([^`]+)`/g, '$1') // inline code
        .replace(/\\([\\`*_{}[\]()#+.!~>-])/g, '$1') // markdown-escaped punctuation
      // Horizontal rules collapse to a blank line.
      return /^\s{0,3}([-*_]\s?){3,}$/.test(line) ? '' : t.trimEnd()
    })
    .join('\n')
}

// Counts of changed word-runs — powers the redline banner's summary if wanted.
export function redlineStats(paras: RedlineParagraph[]): { insertions: number; deletions: number } {
  let insertions = 0
  let deletions = 0
  for (const p of paras)
    for (const r of p.runs) {
      if (r.kind === 'ins') insertions++
      else if (r.kind === 'del') deletions++
    }
  return { insertions, deletions }
}
