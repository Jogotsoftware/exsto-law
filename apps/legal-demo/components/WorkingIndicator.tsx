'use client'

import { useEffect, useRef, useState } from 'react'
import { GemCluster } from '@/components/GemSparkle'

// UI-BUILDER-FIX-1 Phase 8 → HARDENING-RESIDUALS-1 (WP-D3) → BUILDER-UX-1 (WP-6):
// THE one loading indicator, Claude-Code style. Exactly ONE status line is ever
// visible — when the underlying stage changes the PHRASE changes, a second line
// never mounts. The line is transient: it unmounts when the turn's answer
// arrives and is never persisted or re-rendered from history.
//
// WP-6: the pool is large and varied (legal-flavored + general-purpose), the
// cycle is slow enough to read a line before it swaps (seconds, not sub-second),
// and successive phrases never repeat within a short window (a shuffled bag that
// draws without replacement and avoids a back-to-back repeat across refills).
// Playful is attorney-side only; the client portal passes `neutral`.
const PHRASES = [
  // legal-flavored
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
  'Citing chapter and verse',
  'Objecting to my own draft',
  'Reviewing the record',
  'Checking the docket',
  'Conferring with counsel',
  'Reading between the lines',
  'Marshalling the facts',
  'Splitting hairs',
  'Consulting the treatise',
  // general-purpose
  'Thinking it through',
  'Connecting the dots',
  'Lining things up',
  'Working through it',
  'Putting it together',
  'Getting this right',
  'Tidying the details',
  'Almost there',
] as const

const NEUTRAL_PHRASES = [
  'Reviewing',
  'Working on it',
  'Almost there',
  'Putting it together',
  'Getting this right',
  'One moment',
] as const

// Slow enough to read the line before it swaps.
const CYCLE_MS = 3800

// A shuffled bag drawn without replacement; on refill, if the first phrase of the
// new bag equals the last shown, swap it forward so no line repeats back-to-back.
function makeBag(pool: readonly string[], last: string | null): string[] {
  const bag = [...pool]
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[bag[i], bag[j]] = [bag[j]!, bag[i]!]
  }
  if (last && bag[bag.length - 1] === last && bag.length > 1) {
    ;[bag[bag.length - 1], bag[bag.length - 2]] = [bag[bag.length - 2]!, bag[bag.length - 1]!]
  }
  return bag
}

export function WorkingIndicator({ neutral = false }: { neutral?: boolean }) {
  const pool: readonly string[] = neutral ? NEUTRAL_PHRASES : PHRASES
  const [phrase, setPhrase] = useState<string>(pool[0]!)
  const [elapsed, setElapsed] = useState(0)
  const bagRef = useRef<string[]>([])
  const lastRef = useRef<string | null>(null)

  useEffect(() => {
    // Randomize on mount (client-only, so no hydration mismatch) and reset per pool.
    bagRef.current = makeBag(pool, null)
    const first = bagRef.current.pop()!
    lastRef.current = first
    setPhrase(first)
    setElapsed(0)
    const cycle = setInterval(() => {
      if (bagRef.current.length === 0) bagRef.current = makeBag(pool, lastRef.current)
      const next = bagRef.current.pop()!
      lastRef.current = next
      setPhrase(next)
    }, CYCLE_MS)
    const tick = setInterval(() => setElapsed((v) => v + 1), 1000)
    return () => {
      clearInterval(cycle)
      clearInterval(tick)
    }
  }, [pool])

  return (
    <div className="uac-thinking" role="status" aria-label="Working">
      <div className="uac-thinking-head">
        {/* WP-L: the shared animated gemstar is THE "AI is working" affordance
            (comp Thinking state) — never a bespoke glyph. */}
        <GemCluster size={20} /> {phrase}…
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
