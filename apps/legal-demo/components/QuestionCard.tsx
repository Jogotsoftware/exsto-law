'use client'

import { useState } from 'react'
import type { BuildQuestionEvent } from '@/lib/assistantStream'
import { CheckIcon, SendIcon } from '@/components/icons'

// The click-to-answer card for a structured build-wizard interview question (Phase 7).
// This is the headline UX fix: instead of the AI typing a question as free chat, it
// asks via ask_build_question and we render this card — choice buttons (single or
// multi) and/or a text box. WHY a card: it makes the guided build FEEL like a wizard
// (the attorney clicks/fills) rather than a conversation.
//
// On answer, the parent sends a HIDDEN continuation to the model (no fake user bubble);
// the card shows the attorney's CHOICE as a tidy answer chip in place of the buttons,
// so the transcript stays clean. The card disables itself once answered so a re-render
// (or an accidental second click) can't fire the continuation twice.
export function QuestionCard({
  question,
  onAnswer,
}: {
  question: BuildQuestionEvent
  // Fired once on submit: `key` echoes the question, `answer` is the human-readable
  // answer text the model receives as the hidden continuation; `display` is the tidy
  // chip text shown on the card. (They differ only for multi-select / labelled choices.)
  // Returns whether the answer was ACCEPTED — when it returns false (e.g. a turn is
  // mid-stream) the card stays interactive so the attorney can retry instead of being
  // stranded on an answered-looking card whose answer never reached the build.
  onAnswer?: (info: { key: string; answer: string; display: string }) => boolean | void
}) {
  const [answered, setAnswered] = useState<string | null>(null)
  // Multi-select staging: the set of picked choice values (by value).
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [text, setText] = useState('')

  // Resolve a choice value to its label for the displayed chip (falls back to value).
  const labelFor = (value: string): string =>
    question.choices.find((c) => c.value === value)?.label ?? value

  function submit(answer: string, display: string) {
    if (answered) return // already answered — never fire twice
    const a = answer.trim()
    if (!a) return
    // Lock the card ONLY if the parent accepted the answer. A rejected answer (parent
    // returns false — e.g. a turn is mid-stream) leaves the card interactive so the
    // attorney can click again, instead of stranding them on an answered-looking card
    // whose answer never advanced the build. (undefined = no handler → lock as before.)
    const accepted = onAnswer?.({ key: question.key, answer: a, display })
    if (accepted === false) return
    setAnswered(display)
  }

  // Single-select: clicking a choice answers immediately.
  function pickSingle(value: string) {
    submit(labelFor(value), labelFor(value))
  }

  // Multi-select: toggle into the staged set; a separate "Continue" submits them all.
  function toggleMulti(value: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }
  function submitMulti() {
    const labels = [...picked].map(labelFor)
    if (!labels.length) return
    submit(labels.join(', '), labels.join(', '))
  }

  function submitText() {
    submit(text, text)
  }

  return (
    <div className="uac-qcard">
      <div className="uac-qcard-question">{question.question}</div>

      {answered ? (
        // Answered: the tidy chip replaces the controls (no raw user bubble).
        <div className="uac-qcard-answered">
          <span className="uac-qcard-answerchip">
            <CheckIcon size={12} /> {answered}
          </span>
        </div>
      ) : (
        <>
          {question.choices.length > 0 && (
            <div className="uac-qcard-choices">
              {question.choices.map((c) => {
                const on = picked.has(c.value)
                return (
                  <button
                    key={c.value}
                    type="button"
                    className={`uac-qcard-choice${question.multiSelect && on ? ' is-on' : ''}`}
                    onClick={() =>
                      question.multiSelect ? toggleMulti(c.value) : pickSingle(c.value)
                    }
                    title={c.hint}
                  >
                    <span className="uac-qcard-choice-label">
                      {question.multiSelect && on ? '✓ ' : ''}
                      {c.label}
                    </span>
                    {c.hint && <span className="uac-qcard-choice-hint">{c.hint}</span>}
                  </button>
                )
              })}
            </div>
          )}

          {/* Multi-select needs an explicit submit once the attorney has picked. */}
          {question.multiSelect && question.choices.length > 0 && (
            <button
              type="button"
              className="uac-reply-btn"
              onClick={submitMulti}
              disabled={picked.size === 0}
            >
              <CheckIcon size={12} /> Continue with {picked.size || 'no'} selected
            </button>
          )}

          {/* Free-text answer (also the only control when there are no choices). */}
          {question.allowFreeText && (
            <div className="uac-qcard-textrow">
              <input
                className="uac-qcard-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submitText()
                  }
                }}
                placeholder={
                  question.choices.length ? 'Or type your own answer…' : 'Type your answer…'
                }
                aria-label="Your answer"
              />
              {/* Same treatment as the chat composer's send (uac-send) — one send
                  affordance across the app, not a second heavier variant. */}
              <button
                type="button"
                className="uac-send"
                onClick={submitText}
                disabled={!text.trim()}
                aria-label="Submit answer"
              >
                <SendIcon size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
