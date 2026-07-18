// The li-edtr tracked-changes hunk model (apps/legal-demo/lib/trackedChanges):
// diff-run segmentation (reusing lineDiff + wordDiff word runs), hunk grouping,
// accept / reject / undo state transitions, offset mapping, and final-text
// materialization. All pure string functions — these tests are the contract the
// editor component builds on.
import { describe, it, expect } from 'vitest'
import {
  diffRuns,
  groupHunks,
  carryOver,
  acceptHunk,
  acceptAll,
  undoAccept,
  rejectHunkText,
  mapBaseRangeToCurRanges,
  mapBaseRangeToCurStrict,
  buildSessionNote,
  type TrackRun,
  type PendingHunk,
  type AcceptState,
} from '../../apps/legal-demo/lib/trackedChanges'

// The run stream's two concatenation invariants — every case below leans on
// these, so check them wherever a diff is computed.
function baseOf(runs: TrackRun[]): string {
  return runs
    .filter((r) => r.kind !== 'ins')
    .map((r) => r.text)
    .join('')
}
function curOf(runs: TrackRun[]): string {
  return runs
    .filter((r) => r.kind !== 'del')
    .map((r) => r.text)
    .join('')
}
function checkInvariants(base: string, current: string): TrackRun[] {
  const runs = diffRuns(base, current)
  expect(baseOf(runs)).toBe(base)
  expect(curOf(runs)).toBe(current)
  // Offsets are consistent with the concatenation order.
  let b = 0
  let c = 0
  for (const r of runs) {
    expect(r.baseStart).toBe(b)
    expect(r.curStart).toBe(c)
    if (r.kind !== 'ins') b += r.text.length
    if (r.kind !== 'del') c += r.text.length
  }
  return runs
}

function hunksFor(base: string, current: string): PendingHunk[] {
  return groupHunks(checkInvariants(base, current))
}

describe('diffRuns — segmentation invariants', () => {
  const CASES: Array<[string, string, string]> = [
    ['identical', 'The quick brown fox.', 'The quick brown fox.'],
    ['word replaced', 'The quick brown fox.', 'The slow brown fox.'],
    ['word inserted mid-line', 'The brown fox.', 'The very brown fox.'],
    ['word deleted mid-line', 'The very brown fox.', 'The brown fox.'],
    ['line appended', 'Alpha', 'Alpha\nBeta'],
    ['line removed at end', 'Alpha\nBeta', 'Alpha'],
    ['line inserted between', 'Alpha\nBeta', 'Alpha\nMid\nBeta'],
    ['line removed between', 'Alpha\nMid\nBeta', 'Alpha\nBeta'],
    ['line changed', 'Alpha\nOld text here\nBeta', 'Alpha\nNew text here\nBeta'],
    ['empty base', '', 'Fresh document\nWith two lines'],
    ['empty current', 'Doomed document\nWith two lines', ''],
    ['both empty', '', ''],
    ['blank line added', 'A\nB', 'A\n\nB'],
    ['blank line removed', 'A\n\nB', 'A\nB'],
    ['trailing newline added', 'A', 'A\n'],
    ['trailing newline removed', 'A\n', 'A'],
    ['everything replaced', 'One two three', 'Four five'],
    [
      'multi-paragraph rewrite',
      '# Title\n\nBody one.\nBody two.',
      '# Title\n\nBody one changed.\nExtra line.\nBody two.',
    ],
  ]
  for (const [name, base, current] of CASES) {
    it(name, () => {
      checkInvariants(base, current)
    })
  }

  it('unchanged text produces only same runs', () => {
    const runs = checkInvariants('A\nB\nC', 'A\nB\nC')
    expect(runs.every((r) => r.kind === 'same')).toBe(true)
  })
})

describe('groupHunks', () => {
  it('a word swap is one replace hunk with exact texts and offsets', () => {
    const base = 'Pay within thirty days.'
    const cur = 'Pay within ten days.'
    const hunks = hunksFor(base, cur)
    expect(hunks).toHaveLength(1)
    const h = hunks[0]!
    expect(h.kind).toBe('replace')
    expect(h.oldText).toBe('thirty')
    expect(h.newText).toBe('ten')
    expect(base.slice(h.baseStart, h.baseEnd)).toBe('thirty')
    expect(cur.slice(h.curStart, h.curEnd)).toBe('ten')
  })

  it('adjacent word replacements separated by a surviving space bridge into ONE hunk', () => {
    const base = 'The deadline is thirty calendar days.'
    const cur = 'The deadline is ten business days.'
    const hunks = hunksFor(base, cur)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]!.oldText).toBe('thirty calendar')
    expect(hunks[0]!.newText).toBe('ten business')
  })

  it('changes in different paragraphs stay separate hunks (newlines never bridge)', () => {
    const base = 'First clause stays firm.\nSecond clause stays firm.'
    const cur = 'First clause goes soft.\nSecond clause goes soft.'
    const hunks = hunksFor(base, cur)
    expect(hunks).toHaveLength(2)
  })

  it('pure insertion of a sentence classifies as insertion', () => {
    const base = 'One. Three.'
    const cur = 'One. Two. Three.'
    const hunks = hunksFor(base, cur)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]!.kind).toBe('insertion')
    expect(hunks[0]!.oldText.trim()).toBe('')
  })

  it('pure deletion of a paragraph classifies as deletion and carries the newline', () => {
    const base = 'Keep.\nDrop this entire clause.\nAlso keep.'
    const cur = 'Keep.\nAlso keep.'
    const hunks = hunksFor(base, cur)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]!.kind).toBe('deletion')
    expect(hunks[0]!.newText).toBe('')
    expect(hunks[0]!.oldText).toContain('Drop this entire clause.')
  })

  it('appending a new paragraph is one insertion hunk including its separator', () => {
    const base = 'Existing paragraph.'
    const cur = 'Existing paragraph.\nA new confidentiality clause.'
    const hunks = hunksFor(base, cur)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]!.kind).toBe('insertion')
    expect(hunks[0]!.newText).toBe('\nA new confidentiality clause.')
  })
})

describe('accept / reject / undo transitions', () => {
  const base = 'Pay within thirty days of receipt.\nThis agreement is informal.'
  const cur = 'Pay within ten days of receipt.\nThis agreement is binding.'

  function fresh(): { state: AcceptState; hunks: PendingHunk[] } {
    return { state: { baseText: base, accepted: [] }, hunks: hunksFor(base, cur) }
  }

  it('accepting one hunk folds it into baseText; the diff stops reporting it', () => {
    const { state, hunks } = fresh()
    expect(hunks).toHaveLength(2)
    const s2 = acceptHunk(state, hunks[0]!)
    expect(s2.baseText).toBe('Pay within ten days of receipt.\nThis agreement is informal.')
    expect(s2.accepted).toHaveLength(1)
    const remaining = groupHunks(diffRuns(s2.baseText, cur))
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.oldText).toBe('informal.')
  })

  it('accepting ALL pending hunks makes baseText equal the current text (materialization)', () => {
    const { state, hunks } = fresh()
    const s2 = acceptAll(state, hunks)
    expect(s2.baseText).toBe(cur)
    expect(s2.accepted).toHaveLength(2)
    expect(groupHunks(diffRuns(s2.baseText, cur))).toHaveLength(0)
  })

  it('undoing an accept restores baseText and the hunk reappears as pending', () => {
    const { state, hunks } = fresh()
    const s2 = acceptHunk(state, hunks[0]!)
    const s3 = undoAccept(s2, hunks[0]!.id)
    expect(s3.baseText).toBe(base)
    expect(s3.accepted).toHaveLength(0)
    expect(groupHunks(diffRuns(s3.baseText, cur))).toHaveLength(2)
  })

  it('accept two, undo the FIRST — later accepted span shifts back correctly', () => {
    const { state, hunks } = fresh()
    let s = acceptHunk(state, hunks[0]!)
    // Second hunk's offsets are vs the ORIGINAL base — recompute pending against
    // the updated base the way the editor does.
    const pending = groupHunks(diffRuns(s.baseText, cur))
    expect(pending).toHaveLength(1)
    s = acceptHunk(s, pending[0]!)
    expect(s.baseText).toBe(cur)
    const undone = undoAccept(s, hunks[0]!.id)
    expect(undone.baseText).toBe('Pay within thirty days of receipt.\nThis agreement is binding.')
    // The surviving accepted entry still describes intact text at its span.
    const kept = undone.accepted[0]!
    expect(undone.baseText.slice(kept.start, kept.start + kept.newText.length)).toBe(kept.newText)
  })

  it('rejecting a hunk restores the base text at that spot (text semantics)', () => {
    const { hunks } = fresh()
    const afterReject = rejectHunkText(cur, hunks[1]!)
    expect(afterReject).toBe('Pay within ten days of receipt.\nThis agreement is informal.')
    // Rejecting every hunk back-to-front reproduces the base exactly.
    let text = cur
    for (const h of [...hunks].sort((a, b) => b.curStart - a.curStart)) {
      text = rejectHunkText(text, h)
    }
    expect(text).toBe(base)
  })

  it('a later accept overlapping an earlier accepted span supersedes it (entry drops)', () => {
    const b0 = 'alpha beta gamma'
    const c1 = 'alpha BETA gamma'
    const s1 = acceptAll({ baseText: b0, accepted: [] }, hunksFor(b0, c1))
    expect(s1.baseText).toBe(c1)
    expect(s1.accepted).toHaveLength(1)
    // Now the attorney re-edits over the accepted region.
    const c2 = 'alpha delta gamma'
    const h2 = groupHunks(diffRuns(s1.baseText, c2))
    expect(h2).toHaveLength(1)
    const s2 = acceptHunk(s1, h2[0]!)
    expect(s2.baseText).toBe(c2)
    // The overlapped first accept is superseded — only the new entry remains.
    expect(s2.accepted).toHaveLength(1)
    expect(s2.accepted[0]!.newText).toBe('delta')
  })

  it('undoAccept refuses (returns state unchanged) when the span no longer matches', () => {
    const s: AcceptState = {
      baseText: 'short',
      accepted: [
        { id: 'x', kind: 'replace', oldText: 'a', newText: 'ZZZZZZZZ', start: 0, origin: 'manual' },
      ],
    }
    expect(undoAccept(s, 'x')).toBe(s)
  })
})

describe('carryOver — id/origin continuity across recomputes', () => {
  it('exact-position match keeps id, origin and prompt', () => {
    const prev = hunksFor('a b c', 'a X c').map((h) => ({
      ...h,
      origin: 'ai' as const,
      prompt: 'firmer',
    }))
    const next = hunksFor('a b c', 'a X c')
    const carried = carryOver(prev, next)
    expect(carried[0]!.id).toBe(prev[0]!.id)
    expect(carried[0]!.origin).toBe('ai')
    expect(carried[0]!.prompt).toBe('firmer')
  })

  it('a shifted hunk (offsets moved by an earlier edit) still matches by texts', () => {
    const prev = hunksFor('one two three', 'one TWO three').map((h) => ({
      ...h,
      origin: 'ai' as const,
      prompt: 'p',
    }))
    // An insertion earlier in the doc shifts the replace hunk right.
    const next = hunksFor('zero one two three', 'zero! one TWO three')
    const shifted = next.find((h) => h.oldText === 'two')
    expect(shifted).toBeDefined()
    const carried = carryOver(prev, next)
    const match = carried.find((h) => h.oldText === 'two')!
    expect(match.id).toBe(prev[0]!.id)
    expect(match.origin).toBe('ai')
  })

  it('an unmatched new hunk takes the provided default origin', () => {
    const next = hunksFor('a b', 'a Z')
    const carried = carryOver([], next, { origin: 'ai', prompt: 'shorten' })
    expect(carried[0]!.origin).toBe('ai')
    expect(carried[0]!.prompt).toBe('shorten')
  })

  it('without defaults an unmatched hunk stays manual', () => {
    const next = hunksFor('a b', 'a Z')
    expect(carryOver([], next)[0]!.origin).toBe('manual')
  })
})

describe('offset mapping (accepted-span highlights)', () => {
  it('maps a base range through same runs into current offsets', () => {
    const base = 'alpha beta gamma'
    const cur = 'alpha NEW beta gamma'
    const runs = diffRuns(base, cur)
    // 'beta' in base is [6, 10) — in current it sits after the insertion.
    const ranges = mapBaseRangeToCurRanges(runs, 6, 10)
    expect(ranges).toHaveLength(1)
    const [from, to] = ranges[0]!
    expect(cur.slice(from, to)).toBe('beta')
  })

  it('strict mapping returns null when the span was edited over', () => {
    const base = 'alpha beta gamma'
    const cur = 'alpha bXta gamma'
    const runs = diffRuns(base, cur)
    expect(mapBaseRangeToCurStrict(runs, 6, 10)).toBeNull()
  })

  it('strict mapping returns the shifted offset when intact', () => {
    const base = 'alpha beta'
    const cur = 'X alpha beta'
    const runs = diffRuns(base, cur)
    const from = mapBaseRangeToCurStrict(runs, 6, 10)
    expect(from).not.toBeNull()
    expect(cur.slice(from!, from! + 4)).toBe('beta')
  })
})

describe('buildSessionNote', () => {
  it('summarizes counts by origin and quotes AI prompts', () => {
    const note = buildSessionNote(
      [
        { id: '1', kind: 'replace', oldText: 'a', newText: 'b', start: 0, origin: 'ai' },
        { id: '2', kind: 'insertion', oldText: '', newText: 'c', start: 2, origin: 'manual' },
      ],
      ['Make the tone firmer'],
      false,
    )
    expect(note).toContain('2 changes accepted (1 AI, 1 manual)')
    expect(note).toContain('“Make the tone firmer”')
  })

  it('flags untracked direct edits', () => {
    expect(buildSessionNote([], [], true)).toBe('Direct edits with track changes off.')
  })

  it('falls back to a generic note', () => {
    expect(buildSessionNote([], [], false)).toBe('Edited in the document editor.')
  })
})
