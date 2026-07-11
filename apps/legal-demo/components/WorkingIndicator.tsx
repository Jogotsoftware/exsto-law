'use client'

import { useEffect, useState } from 'react'
import { SparklesIcon } from '@/components/icons'

// UI-BUILDER-FIX-1 Phase 8 — THE one loading indicator. "Thinking…" and
// "Drafting…" used to be separate mounts with non-exclusive guards, so both
// could show at once; every pre-text waiting state now renders exactly this
// component: one chip, cycling short legal-flavored phrases (Claude-Code style)
// so a long silent generation feels alive without narrating process.
const PHRASES = [
  'Working for you',
  'Reviewing the record',
  'Drafting with care',
  'Consulting the file',
  'Reading the fine print',
  'Preparing your matter',
  'Cross-referencing precedent',
  'Getting this right',
] as const

const CYCLE_MS = 2400

export function WorkingIndicator() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % PHRASES.length), CYCLE_MS)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="uac-thinking" role="status" aria-label="Working">
      <div className="uac-thinking-head">
        <SparklesIcon size={12} /> {PHRASES[i]}…
        <span className="uac-typing" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>
  )
}
