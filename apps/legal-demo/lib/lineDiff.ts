// Minimal line-level diff (LCS) for comparing two document drafts. Each output
// entry is an unchanged, added (in `b`, not `a`), or removed (in `a`, not `b`)
// line. Line granularity suits legal drafts (paragraphs/clauses per line) and
// keeps the renderer dependency-free. O(n·m) — fine for documents (hundreds of
// lines), not meant for megabyte inputs.

export type DiffOp = { type: 'same' | 'add' | 'del'; line: string }

export function lineDiff(a: string, b: string): DiffOp[] {
  // Treat an empty document as zero lines, not a single phantom '' line (which
  // would otherwise show as a spurious added/removed blank line).
  const aLines = a === '' ? [] : a.split('\n')
  const bLines = b === '' ? [] : b.split('\n')
  const n = aLines.length
  const m = bLines.length

  // lcs[i][j] = length of the longest common subsequence of aLines[i..] / bLines[j..].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        aLines[i] === bLines[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      ops.push({ type: 'same', line: aLines[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ type: 'del', line: aLines[i]! })
      i++
    } else {
      ops.push({ type: 'add', line: bLines[j]! })
      j++
    }
  }
  while (i < n) ops.push({ type: 'del', line: aLines[i++]! })
  while (j < m) ops.push({ type: 'add', line: bLines[j++]! })
  return ops
}

// Counts of added / removed lines — the diff summary ("+4 / −2").
export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op.type === 'add') added++
    else if (op.type === 'del') removed++
  }
  return { added, removed }
}
