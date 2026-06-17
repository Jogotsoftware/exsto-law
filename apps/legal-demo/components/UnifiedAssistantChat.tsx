'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { SendIcon } from '@/components/icons'

// One chat the attorney can point at any connected AI model, that picks up the
// matter/client they're on, and that captures beta feedback. The chat BODY only
// (no floating chrome) so it drops into the matter page as a panel AND inside the
// global feedback FAB. Scope: pass matterEntityId OR contactEntityId to ground +
// thread on that entity; omit both for the global app-help/feedback chat.

interface AssistantModel {
  id: string
  provider: string
  providerLabel: string
  model: string
  label: string
  available: boolean
  connected: boolean
  supportsCitations: boolean
  isDefault: boolean
}

interface DisplayTurn {
  role: 'user' | 'assistant'
  content: string
  citations?: string[]
  model?: string
}

interface ThreadTurn {
  role: 'user' | 'assistant'
  message: string
  reply: string
  model: string
  citations: string[]
}

export interface UnifiedAssistantChatProps {
  matterEntityId?: string
  contactEntityId?: string
  // Load the persisted thread for this scope on mount (matter/contact chats).
  loadThread?: boolean
  // Shown above the first message.
  intro?: string
  placeholder?: string
}

// Citations come from the model — only link http(s) URLs so a javascript:/data:
// URL can't execute on click; otherwise the raw text is shown.
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// Pick the first usable (connected + available) model, else the first available.
function pickDefault(models: AssistantModel[]): string | null {
  const usable = models.find((m) => m.available && m.connected)
  if (usable) return usable.id
  const fallback = models.find((m) => m.available && m.isDefault) ?? models.find((m) => m.available)
  return fallback?.id ?? null
}

export function UnifiedAssistantChat({
  matterEntityId,
  contactEntityId,
  loadThread = false,
  intro,
  placeholder = 'Ask a question, request a draft, or share feedback…',
}: UnifiedAssistantChatProps) {
  const [models, setModels] = useState<AssistantModel[] | null>(null)
  const [modelId, setModelId] = useState<string>('')
  const [turns, setTurns] = useState<DisplayTurn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const scope = matterEntityId ? { matterEntityId } : contactEntityId ? { contactEntityId } : {}

  // Load the model list (and preselect a usable model).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await callAttorneyMcp<{ models: AssistantModel[] }>({
          toolName: 'legal.assistant.models',
        })
        if (cancelled) return
        setModels(r.models)
        setModelId((prev) => prev || pickDefault(r.models) || '')
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Seed prior turns for a matter/contact-scoped chat.
  const loadHistory = useCallback(async () => {
    if (!loadThread) return
    try {
      const r = await callAttorneyMcp<{ turns: ThreadTurn[] }>({
        toolName: 'legal.assistant.thread',
        input: scope,
      })
      const display: DisplayTurn[] = r.turns.map((t) =>
        t.role === 'user'
          ? { role: 'user', content: t.message }
          : { role: 'assistant', content: t.reply, citations: t.citations, model: t.model },
      )
      setTurns(display)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    // `scope` is derived from matterEntityId/contactEntityId, so depending on the
    // ids directly is complete.
  }, [loadThread, matterEntityId, contactEntityId])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  // Keep the latest turn in view.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns, busy])

  async function send() {
    const message = input.trim()
    if (!message || busy || !modelId) return
    setError(null)
    setBusy(true)
    // The model history the server expects: prior user/assistant turns as text.
    const history = turns.map((t) => ({ role: t.role, content: t.content }))
    setTurns((t) => [...t, { role: 'user', content: message }])
    setInput('')
    try {
      const reply = await callAttorneyMcp<{
        reply: string
        citations: string[]
        model: string
      }>({
        toolName: 'legal.assistant.chat',
        input: { message, modelId, history, ...scope },
      })
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          content: reply.reply,
          citations: reply.citations,
          model: reply.model,
        },
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const selected = models?.find((m) => m.id === modelId) ?? null

  // Inline styles (no new global CSS) so this drops into the matter page AND the
  // feedback FAB without touching globals.css. Bubbles reuse existing classes.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span className="text-muted text-sm">Model</span>
        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          disabled={!models}
          aria-label="AI model"
          style={{ flex: 1, minWidth: 0 }}
        >
          {!models && <option>Loading models…</option>}
          {models?.map((m) => (
            <option key={m.id} value={m.id} disabled={!m.available || !m.connected}>
              {m.label}
              {!m.available ? ' — coming soon' : !m.connected ? ' — connect in Settings' : ''}
            </option>
          ))}
        </select>
        {selected?.supportsCitations && (
          <span className="badge" title="Answers include web citations">
            cites sources
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          maxHeight: 360,
          overflowY: 'auto',
          padding: '2px',
        }}
      >
        {intro && turns.length === 0 && <div className="text-muted text-sm">{intro}</div>}
        {turns.map((t, i) => (
          <div key={i} className={`feedback-bubble feedback-bubble-${t.role}`}>
            <div style={{ whiteSpace: 'pre-wrap' }}>{t.content}</div>
            {t.citations && t.citations.length > 0 && (
              <ol style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem', fontSize: '0.85em' }}>
                {t.citations.map((c, j) => (
                  <li key={j}>
                    {isHttpUrl(c) ? (
                      <a href={c} target="_blank" rel="noopener noreferrer">
                        {c}
                      </a>
                    ) : (
                      <span className="text-muted">{c}</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
        {busy && (
          <div className="feedback-bubble feedback-bubble-assistant feedback-bubble-pending">
            <span className="spinner" /> Thinking…
          </div>
        )}
        {error && <div className="alert alert-error">{error}</div>}
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={2}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className="primary"
          onClick={() => void send()}
          disabled={busy || !input.trim() || !modelId}
          aria-label="Send"
        >
          <SendIcon size={16} />
        </button>
      </div>
    </div>
  )
}
