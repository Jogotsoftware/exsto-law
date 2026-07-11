'use client'

import { useEffect, useState } from 'react'

// UI-BUILDER-FIX-1 Phase 8 → HARDENING-RESIDUALS-1 (WP-D3): THE one loading
// indicator, Claude-Code style. Exactly ONE status line is ever visible — when
// the underlying stage changes (thinking → drafting) the PHRASE changes, a
// second line never mounts. The line is transient: it unmounts when the turn's
// answer arrives and is never persisted or re-rendered from history. Playful
// lawyer-flavored phrases are attorney-side only; the client portal keeps a
// neutral pool via the `neutral` prop.
const PHRASES = [
  'Practicing jurisprudence',
  'Litigating with myself',
  'Checking the precedents',
  'Reading the fine print',
  'Shepardizing',
  'Weighing the equities',
  'Briefing the issue',
  'Redlining furiously',
  'Consulting the statutes',
  'Approaching the bench',
] as const

const NEUTRAL_PHRASES = ['Reviewing', 'Working on it', 'Almost there'] as const

const CYCLE_MS = 3200

export function WorkingIndicator({ neutral = false }: { neutral?: boolean }) {
  const [i, setI] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const pool: readonly string[] = neutral ? NEUTRAL_PHRASES : PHRASES
  useEffect(() => {
    const cycle = setInterval(() => setI((v) => (v + 1) % pool.length), CYCLE_MS)
    const tick = setInterval(() => setElapsed((v) => v + 1), 1000)
    return () => {
      clearInterval(cycle)
      clearInterval(tick)
    }
  }, [pool.length])
  return (
    <div className="uac-thinking" role="status" aria-label="Working">
      <div className="uac-thinking-head">
        <span aria-hidden="true">⚖</span> {pool[i]}…
        <span className="uac-typing" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {elapsed > 2 && <span className="uac-thinking-elapsed">({elapsed}s)</span>}
      </div>
    </div>
  )
}
