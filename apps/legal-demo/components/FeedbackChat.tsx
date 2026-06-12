'use client'

import { useEffect, useRef, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { MessageCircleIcon, SendIcon, XIcon } from '@/components/icons'

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

const INTRO =
  'Hi! Ask me anything about using the app — intake, booking, drafting, review, Granola import, settings. Or just tell me what you think; your feedback goes straight to the team.'

// Floating beta-feedback assistant, mounted in the attorney layout. It is inside
// AttorneyAuthGate already, so it only renders for signed-in attorneys. Each send
// calls legal.assistant.ask, which records the exchange to the substrate.
export function FeedbackChat() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Keep the latest turn in view as the conversation grows.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns, busy])

  // Focus the input when the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  async function send() {
    const message = input.trim()
    if (!message || busy) return
    setError(null)
    setBusy(true)
    // Optimistically show the attorney's turn; the reply is appended on success.
    const history = turns
    setTurns([...turns, { role: 'user', content: message }])
    setInput('')
    try {
      const pageContext =
        typeof window !== 'undefined' ? { path: window.location.pathname } : undefined
      const { reply } = await callAttorneyMcp<{ reply: string }>({
        toolName: 'legal.assistant.ask',
        input: { message, history, pageContext },
      })
      setTurns((t) => [...t, { role: 'assistant', content: reply }])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="feedback-fab"
        onClick={() => setOpen(true)}
        aria-label="Open feedback assistant"
      >
        <MessageCircleIcon size={18} />
        Feedback
      </button>
    )
  }

  return (
    <div className="feedback-panel" role="dialog" aria-label="Feedback assistant">
      <div className="feedback-panel-head">
        <div className="feedback-panel-title">Beta assistant</div>
        <button
          type="button"
          className="feedback-panel-close"
          onClick={() => setOpen(false)}
          aria-label="Close"
        >
          <XIcon size={16} />
        </button>
      </div>

      <div className="feedback-panel-body" ref={scrollRef}>
        <div className="feedback-intro">{INTRO}</div>
        {turns.map((t, i) => (
          <div key={i} className={`feedback-bubble feedback-bubble-${t.role}`}>
            {t.content}
          </div>
        ))}
        {busy && (
          <div className="feedback-bubble feedback-bubble-assistant feedback-bubble-pending">
            <span className="spinner" /> Thinking…
          </div>
        )}
        {error && <div className="alert alert-error feedback-error">{error}</div>}
      </div>

      <div className="feedback-panel-foot">
        <textarea
          ref={inputRef}
          className="feedback-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask a question or share feedback…"
          rows={2}
        />
        <button
          type="button"
          className="primary feedback-send"
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          aria-label="Send"
        >
          <SendIcon size={16} />
        </button>
      </div>
    </div>
  )
}
