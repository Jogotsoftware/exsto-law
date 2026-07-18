// The tracked-changes hunk model for the li-edtr document editor (the reader's
// Edit / AI-revision flagship). PURE string functions — no DOM, no ProseMirror —
// so the whole state machine is unit-testable (tests/vertical/tracked-changes).
//
// Model in one paragraph: `baseText` is the ACCEPTED state of the document (the
// last saved version plus every change the attorney has accepted this session).
// The editor's live text is the PROPOSED state. Pending changes are not stored —
// they are COMPUTED as the diff between the two (reusing lineDiff + wordDiff's
// word-level runs), then grouped into discrete hunks the attorney accepts or
// rejects one by one. Accepting folds a hunk into `baseText` (and remembers it in
// the accepted log, so the rail can show an "Accepted · Undo" card and the body a
// light-green highlight); rejecting reverts the hunk in the editor text, so the
// next diff simply no longer reports it. Undoing an accept splices the hunk back
// out of `baseText`, and the diff re-reports it as pending. Nothing here touches
// the substrate — persistence happens once, on Save, through the append-only
// `legal.draft.edit`.

import { lineDiff, type DiffOp } from './lineDiff'
import { wordRuns } from './wordDiff'

export type RunKind = 'same' | 'del' | 'ins'

// A flat run with offsets into BOTH texts. Invariants (unit-tested):
//   concat(text of same+del runs) === base
//   concat(text of same+ins runs) === current
export interface TrackRun {
  kind: RunKind
  text: string
  baseStart: number
  curStart: number
}

export type HunkKind = 'replace' | 'insertion' | 'deletion'
export type ChangeOrigin = 'manual' | 'ai'

export interface PendingHunk {
  id: string
  kind: HunkKind
  // Exact texts (whitespace included) — materialization uses these verbatim; the
  // `kind` label is presentational only.
  oldText: string
  newText: string
  baseStart: number
  baseEnd: number
  curStart: number
  curEnd: number
  origin: ChangeOrigin
  prompt?: string
}

export interface AcceptedChange {
  id: string
  kind: HunkKind
  oldText: string
  newText: string
  // Offset of newText inside the CURRENT baseText (kept adjusted as later
  // accepts/undos splice around it).
  start: number
  origin: ChangeOrigin
  prompt?: string
}

export interface AcceptState {
  baseText: string
  accepted: AcceptedChange[]
}

let hunkSeq = 0
function nextId(): string {
  hunkSeq += 1
  return `h${hunkSeq}`
}

// ── Diff → flat runs ─────────────────────────────────────────────────────────

// Line-level LCS first (lineDiff), word-level runs inside changed line pairs
// (wordDiff.wordRuns) — same strategy as buildRedline, but emitting a FLAT run
// stream with offsets, because accept/reject needs to splice exact ranges.
//
// Newline bookkeeping: the '\n' separating two lines is emitted as its own run
// BEFORE each line's content, attributed to the side(s) that actually carry it —
// `same` when both sides continue, `ins` when only the current text gains a line,
// `del` when only the base loses one. (A naive `line + '\n'` scheme mis-shares
// the separator when the two texts end at different lines.)
export function diffRuns(base: string, current: string): TrackRun[] {
  const ops: DiffOp[] = lineDiff(base, current)
  const raw: Array<{ kind: RunKind; text: string }> = []
  // True once any base-side / current-side content has been emitted, meaning the
  // next content on that side is preceded by a newline.
  let needBase = false
  let needCur = false
  const beforeBoth = (): void => {
    if (needBase && needCur) raw.push({ kind: 'same', text: '\n' })
    else if (needCur) raw.push({ kind: 'ins', text: '\n' })
    else if (needBase) raw.push({ kind: 'del', text: '\n' })
    needBase = true
    needCur = true
  }
  const beforeDel = (): void => {
    if (needBase) raw.push({ kind: 'del', text: '\n' })
    needBase = true
  }
  const beforeIns = (): void => {
    if (needCur) raw.push({ kind: 'ins', text: '\n' })
    needCur = true
  }
  let dels: string[] = []
  let adds: string[] = []
  const flush = (): void => {
    const paired = Math.min(dels.length, adds.length)
    for (let k = 0; k < paired; k++) {
      beforeBoth()
      for (const r of wordRuns(dels[k]!, adds[k]!)) raw.push({ kind: r.kind, text: r.text })
    }
    for (let k = paired; k < dels.length; k++) {
      beforeDel()
      if (dels[k] !== '') raw.push({ kind: 'del', text: dels[k]! })
    }
    for (let k = paired; k < adds.length; k++) {
      beforeIns()
      if (adds[k] !== '') raw.push({ kind: 'ins', text: adds[k]! })
    }
    dels = []
    adds = []
  }
  for (const op of ops) {
    if (op.type === 'del') dels.push(op.line)
    else if (op.type === 'add') adds.push(op.line)
    else {
      flush()
      beforeBoth()
      if (op.line !== '') raw.push({ kind: 'same', text: op.line })
    }
  }
  flush()

  // Coalesce adjacent same-kind runs, drop empties, then assign offsets.
  const runs: TrackRun[] = []
  let baseOff = 0
  let curOff = 0
  for (const r of raw) {
    if (r.text === '') continue
    const prev = runs[runs.length - 1]
    if (prev && prev.kind === r.kind) {
      prev.text += r.text
    } else {
      runs.push({ kind: r.kind, text: r.text, baseStart: baseOff, curStart: curOff })
    }
    if (r.kind !== 'ins') baseOff += r.text.length
    if (r.kind !== 'del') curOff += r.text.length
  }
  return runs
}

// ── Runs → discrete hunks ────────────────────────────────────────────────────

// Whitespace-only same-run (no newline) that may be absorbed into a hunk so a
// two-word replacement separated by a surviving space reads as ONE change card,
// not two. Newlines never bridge — changes in different paragraphs stay
// separate hunks.
function isBridge(run: TrackRun): boolean {
  return run.kind === 'same' && run.text.trim() === '' && !run.text.includes('\n')
}

export function groupHunks(runs: TrackRun[]): PendingHunk[] {
  const hunks: PendingHunk[] = []
  let open: PendingHunk | null = null
  const close = (): void => {
    if (!open) return
    open.baseEnd = open.baseStart + open.oldText.length
    open.curEnd = open.curStart + open.newText.length
    open.kind = classify(open.oldText, open.newText)
    hunks.push(open)
    open = null
  }
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!
    if (run.kind === 'same') {
      // Absorb a pure-whitespace same run when a changed run follows — it joins
      // the two sides of one logical edit.
      const next = runs[i + 1]
      if (open && next && next.kind !== 'same' && isBridge(run)) {
        open.oldText += run.text
        open.newText += run.text
        continue
      }
      close()
      continue
    }
    if (!open) {
      open = {
        id: nextId(),
        kind: 'replace',
        oldText: '',
        newText: '',
        baseStart: run.baseStart,
        baseEnd: run.baseStart,
        curStart: run.curStart,
        curEnd: run.curStart,
        origin: 'manual',
      }
    }
    if (run.kind === 'del') open.oldText += run.text
    else open.newText += run.text
  }
  close()
  return hunks
}

function classify(oldText: string, newText: string): HunkKind {
  const hasOld = oldText.trim() !== ''
  const hasNew = newText.trim() !== ''
  if (hasOld && hasNew) return 'replace'
  if (hasNew) return 'insertion'
  if (hasOld) return 'deletion'
  // Pure-whitespace change either way: call it a replace.
  return oldText === '' ? 'insertion' : newText === '' ? 'deletion' : 'replace'
}

// Carry ids/origins/prompts across recomputes so cards stay stable while the
// attorney types elsewhere. Exact key (position + texts) first, then a unique
// texts-only fallback (the hunk shifted because an earlier edit changed
// offsets). Unmatched hunks keep their fresh id with the given default origin.
export function carryOver(
  prev: PendingHunk[],
  next: PendingHunk[],
  defaults?: { origin: ChangeOrigin; prompt?: string },
): PendingHunk[] {
  const byExact = new Map<string, PendingHunk[]>()
  const byText = new Map<string, PendingHunk[]>()
  const push = (m: Map<string, PendingHunk[]>, k: string, h: PendingHunk): void => {
    const arr = m.get(k)
    if (arr) arr.push(h)
    else m.set(k, [h])
  }
  for (const h of prev) {
    push(byExact, `${h.baseStart} ${h.oldText} ${h.newText}`, h)
    push(byText, `${h.oldText} ${h.newText}`, h)
  }
  const take = (m: Map<string, PendingHunk[]>, k: string): PendingHunk | undefined => {
    const arr = m.get(k)
    return arr && arr.length > 0 ? arr.shift() : undefined
  }
  return next.map((h) => {
    const match =
      take(byExact, `${h.baseStart} ${h.oldText} ${h.newText}`) ??
      take(byText, `${h.oldText} ${h.newText}`)
    if (match) return { ...h, id: match.id, origin: match.origin, prompt: match.prompt }
    if (defaults) return { ...h, origin: defaults.origin, prompt: defaults.prompt }
    return h
  })
}

// ── Accept / reject / undo state transitions ─────────────────────────────────

// Accept: fold the hunk into baseText (old → new at the hunk's base range).
// Accepted spans that sit AFTER the splice shift; spans the splice overlaps were
// re-edited by this newer change, so the newer acceptance supersedes them (their
// cards drop — their text no longer exists verbatim to undo to).
export function acceptHunk(state: AcceptState, hunk: PendingHunk): AcceptState {
  const { baseStart, baseEnd } = hunk
  const delta = hunk.newText.length - hunk.oldText.length
  const baseText = state.baseText.slice(0, baseStart) + hunk.newText + state.baseText.slice(baseEnd)
  const kept: AcceptedChange[] = []
  for (const c of state.accepted) {
    const end = c.start + c.newText.length
    if (end <= baseStart) kept.push(c)
    else if (c.start >= baseEnd) kept.push({ ...c, start: c.start + delta })
    // else: overlapped → superseded, dropped.
  }
  kept.push({
    id: hunk.id,
    kind: hunk.kind,
    oldText: hunk.oldText,
    newText: hunk.newText,
    start: baseStart,
    origin: hunk.origin,
    prompt: hunk.prompt,
  })
  kept.sort((a, b) => a.start - b.start)
  return { baseText, accepted: kept }
}

// Accept every pending hunk. Back-to-front so earlier hunks' offsets stay valid
// while later ones splice.
export function acceptAll(state: AcceptState, hunks: PendingHunk[]): AcceptState {
  const ordered = [...hunks].sort((a, b) => b.baseStart - a.baseStart)
  let s = state
  for (const h of ordered) s = acceptHunk(s, h)
  return s
}

// Undo an accept: splice the change back out of baseText. The diff then reports
// it as pending again — the editor text still carries the new text.
export function undoAccept(state: AcceptState, acceptedId: string): AcceptState {
  const entry = state.accepted.find((c) => c.id === acceptedId)
  if (!entry) return state
  const end = entry.start + entry.newText.length
  // Defensive: baseText only changes through these transitions, so the span must
  // still match; if it somehow doesn't, refuse rather than corrupt.
  if (state.baseText.slice(entry.start, end) !== entry.newText) return state
  const delta = entry.oldText.length - entry.newText.length
  const baseText = state.baseText.slice(0, entry.start) + entry.oldText + state.baseText.slice(end)
  const accepted = state.accepted
    .filter((c) => c.id !== acceptedId)
    .map((c) => (c.start >= end ? { ...c, start: c.start + delta } : c))
  return { baseText, accepted }
}

// Reject, expressed on plain text (the component performs the equivalent editor
// transaction): the current range reverts to the base-side text.
export function rejectHunkText(currentText: string, hunk: PendingHunk): string {
  return currentText.slice(0, hunk.curStart) + hunk.oldText + currentText.slice(hunk.curEnd)
}

// ── Offset mapping (accepted-span highlights) ────────────────────────────────

// Map a base-text range through the runs into current-text sub-ranges (only the
// parts that survive in `same` runs — text the user has since deleted simply has
// no highlight to show).
export function mapBaseRangeToCurRanges(
  runs: TrackRun[],
  start: number,
  end: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const run of runs) {
    if (run.kind !== 'same') continue
    const bEnd = run.baseStart + run.text.length
    const ovStart = Math.max(start, run.baseStart)
    const ovEnd = Math.min(end, bEnd)
    if (ovStart >= ovEnd) continue
    const from = run.curStart + (ovStart - run.baseStart)
    const to = run.curStart + (ovEnd - run.baseStart)
    const prev = out[out.length - 1]
    if (prev && prev[1] === from) prev[1] = to
    else out.push([from, to])
  }
  return out
}

// Strict variant for remapping an accepted span when base is re-synced to the
// current text (track-changes toggle OFF): the span survives only if it maps
// CONTIGUOUSLY and in full — otherwise it was edited over and the entry drops.
export function mapBaseRangeToCurStrict(
  runs: TrackRun[],
  start: number,
  end: number,
): number | null {
  const ranges = mapBaseRangeToCurRanges(runs, start, end)
  if (ranges.length !== 1) return null
  const [from, to] = ranges[0]!
  return to - from === end - start ? from : null
}

// ── Save-note composition ────────────────────────────────────────────────────

// The version-history note summarizing the session: counts by origin plus the
// AI prompts used. Pure so it's testable.
export function buildSessionNote(
  accepted: AcceptedChange[],
  aiPrompts: string[],
  untrackedEdits: boolean,
): string {
  const parts: string[] = []
  if (accepted.length > 0) {
    const ai = accepted.filter((c) => c.origin === 'ai').length
    const manual = accepted.length - ai
    const breakdown =
      ai > 0 && manual > 0
        ? ` (${ai} AI, ${manual} manual)`
        : ai > 0
          ? ' (AI)'
          : manual > 0
            ? ' (manual)'
            : ''
    parts.push(
      `Tracked edits: ${accepted.length} change${accepted.length === 1 ? '' : 's'} accepted${breakdown}`,
    )
  }
  if (aiPrompts.length > 0) {
    const quoted = aiPrompts.map((p) => `“${p}”`).join('; ')
    parts.push(`AI prompts: ${quoted}`)
  }
  if (untrackedEdits) parts.push('Direct edits with track changes off')
  if (parts.length === 0) parts.push('Edited in the document editor')
  return `${parts.join('. ')}.`
}
