'use client'

import { useMemo, useState } from 'react'
import type { BuildQuestionEvent } from '@/lib/assistantStream'
import { QuestionCard } from '@/components/QuestionCard'
import { CheckIcon } from '@/components/icons'

// Click-THROUGH interview: when the build-wizard asks a BATCH of questions in one
// turn, present them ONE AT A TIME (like Claude Code's question flow) instead of a
// stack of cards. Selecting an answer auto-advances to the next; a Back button
// revises an earlier one. The underlying answer plumbing is unchanged — each
// answer calls the parent's onAnswer (which buffers the batch and sends ONE
// combined continuation when the last question is answered), so this is purely a
// presentation change over the existing one-round-trip batch logic.
export function QuestionBatch({
  questions,
  onAnswer,
}: {
  questions: BuildQuestionEvent[]
  onAnswer?: (info: { key: string; answer: string; display: string }) => boolean | void
}) {
  const [idx, setIdx] = useState(0)
  // key -> display chip, so a revisited/answered question shows its choice and the
  // progress rail can mark it done.
  const [answered, setAnswered] = useState<Map<string, string>>(new Map())
  // Bumped on every accepted answer so the current QuestionCard re-mounts fresh
  // when we step Back to it (its internal "answered" lock resets, letting the
  // attorney re-pick).
  const [attempt, setAttempt] = useState(0)

  const total = questions.length
  const current = questions[Math.min(idx, total - 1)]

  const allAnswered = useMemo(
    () => questions.every((q) => answered.has(q.key)),
    [questions, answered],
  )

  if (!current) return null

  // A single question needs no stepper chrome — render the bare card (answering it
  // sends immediately, exactly as before).
  if (total <= 1) {
    return <QuestionCard question={current} onAnswer={onAnswer} />
  }

  function handle(info: { key: string; answer: string; display: string }): boolean {
    const accepted = onAnswer?.(info)
    if (accepted === false) return false
    setAnswered((prev) => new Map(prev).set(info.key, info.display))
    setAttempt((a) => a + 1)
    // Auto-advance to the next question (stay put on the last — the parent submits
    // the whole batch when the final answer lands).
    if (idx < total - 1) setIdx(idx + 1)
    return true
  }

  return (
    <div className="uac-qbatch">
      <div className="uac-qbatch-head">
        <button
          type="button"
          className="uac-qbatch-back"
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          aria-label="Previous question"
        >
          ← Back
        </button>
        <span className="uac-qbatch-count">
          Question {Math.min(idx + 1, total)} of {total}
        </span>
        <span className="uac-qbatch-dots" aria-hidden>
          {questions.map((q, i) => (
            <span
              key={q.key}
              className={`uac-qbatch-dot${i === idx ? ' is-current' : ''}${
                answered.has(q.key) ? ' is-done' : ''
              }`}
            />
          ))}
        </span>
      </div>

      {/* Re-mount per (index, attempt) so stepping Back gives a fresh, re-answerable
          card rather than one locked on its prior pick. */}
      <QuestionCard key={`${current.key}-${idx}-${attempt}`} question={current} onAnswer={handle} />

      {allAnswered && (
        <div className="uac-qbatch-done">
          <CheckIcon size={12} /> All set — sending your answers…
        </div>
      )}
    </div>
  )
}
