'use client'

import { useEffect, useRef, useState } from 'react'
import { UnifiedAssistantChat } from '@/components/UnifiedAssistantChat'
import { MessageCircleIcon, XIcon } from '@/components/icons'

const INTRO =
  'Ask anything about using the app — intake, booking, drafting, review, Granola import, settings. Switch the model up top. Or just tell me what you think; your feedback goes straight to the team.'

// Floating assistant FAB, mounted in the attorney layout (inside the auth gate,
// so it only renders for signed-in attorneys). It now hosts the SAME unified
// assistant chat as the matter page — with the model switcher — in GLOBAL scope
// (no matter/contact context): app-help questions and beta feedback. Each turn
// is recorded as an assistant.turn event.
export function FeedbackChat() {
  const [open, setOpen] = useState(false)
  const inputFocusRef = useRef<HTMLDivElement>(null)

  // Focus the first focusable control when the panel opens.
  useEffect(() => {
    if (open) inputFocusRef.current?.querySelector('textarea')?.focus()
  }, [open])

  if (!open) {
    return (
      <button
        type="button"
        className="feedback-fab"
        onClick={() => setOpen(true)}
        aria-label="Open assistant"
      >
        <MessageCircleIcon size={18} />
        Assistant
      </button>
    )
  }

  return (
    <div className="feedback-panel" role="dialog" aria-label="Assistant">
      <div className="feedback-panel-head">
        <div className="feedback-panel-title">Assistant</div>
        <button
          type="button"
          className="feedback-panel-close"
          onClick={() => setOpen(false)}
          aria-label="Close"
        >
          <XIcon size={16} />
        </button>
      </div>
      <div className="feedback-panel-body" ref={inputFocusRef}>
        {/* Global scope: no matter/contact, don't load a shared thread. */}
        <UnifiedAssistantChat intro={INTRO} placeholder="Ask a question or share feedback…" />
      </div>
    </div>
  )
}
