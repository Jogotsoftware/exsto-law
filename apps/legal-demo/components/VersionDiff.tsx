// Line diff for AI-review MEMOS (client's doc vs the model's suggested redline)
// and for VersionCompareDrawer's line-level toggle (B2.3) — a distinct,
// non-comp gutter view (+/− rows) from the comp's word-level tracked changes
// (buildRedline) that power the AI-revision flagship editor. Its own module
// (not DocumentReviewer.tsx) so VersionCompareDrawer can import it without a
// circular dependency (DocumentReviewer embeds VersionCompareDrawer).
import type { ReactNode } from 'react'
import type { DiffOp } from '@/lib/lineDiff'

export function VersionDiff({ ops }: { ops: DiffOp[] }) {
  const rows: ReactNode[] = []
  let collapsed = false
  ops.forEach((op, i) => {
    if (op.type === 'same') {
      if (!collapsed) {
        rows.push(
          <div key={`gap-${i}`} className="vdiff-gap" aria-hidden>
            ···
          </div>,
        )
        collapsed = true
      }
      return
    }
    collapsed = false
    const cls = op.type === 'add' ? 'vdiff-add' : 'vdiff-del'
    const sign = op.type === 'add' ? '+' : '−'
    rows.push(
      <div key={i} className={`vdiff-line ${cls}`}>
        <span className="vdiff-sign" aria-hidden>
          {sign}
        </span>
        <span className="vdiff-text">{op.line || ' '}</span>
      </div>,
    )
  })
  return <>{rows}</>
}
