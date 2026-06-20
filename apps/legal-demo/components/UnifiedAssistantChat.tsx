'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { streamAssistant, type WorkRate } from '@/lib/assistantStream'
import { renderMarkdown } from '@/lib/draftExport'
import {
  SendIcon,
  SettingsIcon,
  MegaphoneIcon,
  SparklesIcon,
  SearchIcon,
  ClockIcon,
} from '@/components/icons'

// One chat the attorney can point at any connected AI model, that picks up the
// matter/client they're on, streams replies token-by-token (with a live thinking
// animation), and captures beta feedback. The chat BODY only (no floating
// chrome) so it drops into the matter page as a panel AND inside the global
// feedback FAB. Scope: pass matterEntityId OR contactEntityId to ground + thread
// on that entity; omit both for the global app-help/feedback chat.
//
// The toolbar exposes three controls the attorney asked for:
//   • Settings (gear)  — model, work rate (effort), web search
//   • Beta (megaphone) — feedback straight to the team with page context
//   • Context toggle   — ground to this matter/client, or ask as a general Q

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
  supportsWorkRate: boolean
  supportsWebSearch: boolean
  webSearchInherent: boolean
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

type FeedbackCategory = 'ui' | 'ai' | 'workflow' | 'other'

// One prior conversation in the history picker (from legal.assistant.threads).
interface ThreadSummary {
  scope: 'matter' | 'contact' | 'global'
  matterEntityId?: string
  contactEntityId?: string
  label: string
  snippet: string
  lastMessageAt: string
  count: number
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

const WORK_RATES: Array<{ value: WorkRate; label: string; hint: string }> = [
  { value: 'quick', label: 'Quick', hint: 'Fast, light reasoning' },
  { value: 'balanced', label: 'Balanced', hint: 'Default — adaptive thinking' },
  { value: 'thorough', label: 'Thorough', hint: 'Deeper thinking, slower' },
]

const FEEDBACK_CATEGORIES: Array<{ value: FeedbackCategory; label: string }> = [
  { value: 'ui', label: 'UI / design' },
  { value: 'ai', label: 'AI / answers' },
  { value: 'workflow', label: 'Workflow' },
  { value: 'other', label: 'Other' },
]

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
  // The in-flight assistant reply, streamed token-by-token.
  const [streaming, setStreaming] = useState<{ thinking: string; text: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Toolbar panels + settings.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [betaOpen, setBetaOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null)
  const [workRate, setWorkRate] = useState<WorkRate>('balanced')
  const [webSearch, setWebSearch] = useState(false)
  const [useContext, setUseContext] = useState(true)

  // Beta-feedback form.
  const [fbMessage, setFbMessage] = useState('')
  const [fbCategory, setFbCategory] = useState<FeedbackCategory>('other')
  const [fbBusy, setFbBusy] = useState(false)
  const [fbDone, setFbDone] = useState(false)
  const [fbError, setFbError] = useState<string | null>(null)
  // The substrate event id the feedback landed as — shown back as a reference so
  // the attorney can see it was durably recorded (the "where did it go / no audit
  // trail" beta asks).
  const [fbRef, setFbRef] = useState<string | null>(null)

  // The conversation's CURRENT scope — starts from the props (the page the FAB was
  // opened on); the history picker can re-point it at another matter/client thread
  // without remounting.
  const [activeScope, setActiveScope] = useState<{
    matterEntityId?: string
    contactEntityId?: string
  }>(() => (matterEntityId ? { matterEntityId } : contactEntityId ? { contactEntityId } : {}))
  const scoped = Boolean(activeScope.matterEntityId || activeScope.contactEntityId)
  const scopeLabel = activeScope.matterEntityId
    ? 'this matter'
    : activeScope.contactEntityId
      ? 'this client'
      : ''
  const scope = activeScope

  const selected = models?.find((m) => m.id === modelId) ?? null
  const effectiveWebSearch = selected
    ? selected.webSearchInherent || (selected.supportsWebSearch && webSearch)
    : false

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

  // Load the persisted thread for a scope into the chat. The history picker calls
  // this with a different scope to reopen another conversation.
  const loadHistory = useCallback(
    async (target: { matterEntityId?: string; contactEntityId?: string }) => {
      try {
        const r = await callAttorneyMcp<{ turns: ThreadTurn[] }>({
          toolName: 'legal.assistant.thread',
          input: target,
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
    },
    [],
  )

  // Seed the initial scope's thread on mount (matter/contact chats). The picker
  // loads other scopes explicitly via selectThread.
  useEffect(() => {
    if (loadThread) void loadHistory(activeScope)
    // Mount-only: activeScope's initial value is the prop-derived scope; later
    // scope switches load explicitly via selectThread.
  }, [])

  // Reopen a prior conversation: re-point the active scope, clear the current
  // exchange, and load that thread. Re-grounds context in the chosen scope.
  function selectThread(target: { matterEntityId?: string; contactEntityId?: string }) {
    setHistoryOpen(false)
    setActiveScope(target)
    setTurns([])
    setStreaming(null)
    setError(null)
    setInput('')
    setUseContext(true)
    void loadHistory(target)
  }

  // Open the history picker and (re)load the thread list.
  function openHistory() {
    const opening = !historyOpen
    setHistoryOpen(opening)
    setSettingsOpen(false)
    setBetaOpen(false)
    if (opening) {
      setThreads(null)
      callAttorneyMcp<{ threads: ThreadSummary[] }>({ toolName: 'legal.assistant.threads' })
        .then((r) => setThreads(r.threads))
        .catch(() => setThreads([]))
    }
  }

  // Keep the latest turn in view as content streams in.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns, busy, streaming])

  async function send() {
    const message = input.trim()
    if (!message || busy || !modelId) return
    setError(null)
    setBusy(true)
    setSettingsOpen(false)
    setBetaOpen(false)
    // The model history the server expects: prior user/assistant turns as text.
    const history = turns.map((t) => ({ role: t.role, content: t.content }))
    setTurns((t) => [...t, { role: 'user', content: message }])
    setInput('')

    // Accumulate deltas locally; each handler hands React a fresh object.
    const partial = { thinking: '', text: '' }
    setStreaming({ ...partial })
    let finished = false

    try {
      await streamAssistant(
        {
          message,
          modelId,
          history,
          ...scope,
          workRate,
          webSearch,
          // Only meaningful when scoped; the toggle is hidden otherwise.
          useContext: scoped ? useContext : undefined,
          pageContext:
            typeof window !== 'undefined' ? { path: window.location.pathname } : undefined,
        },
        {
          onThinking: (t) => {
            partial.thinking += t
            setStreaming({ ...partial })
          },
          onText: (t) => {
            partial.text += t
            setStreaming({ ...partial })
          },
          onDone: (d) => {
            finished = true
            setTurns((prev) => [
              ...prev,
              { role: 'assistant', content: d.reply, citations: d.citations, model: d.model },
            ])
            setStreaming(null)
          },
          onError: (m) => {
            finished = true
            setError(m)
            setStreaming(null)
          },
        },
      )
    } catch (e) {
      finished = true
      setError(e instanceof Error ? e.message : String(e))
      setStreaming(null)
    }

    // Reconcile a stream that ended without a terminal event (e.g. a drop):
    // keep whatever streamed rather than losing it.
    if (!finished && (partial.text || partial.thinking)) {
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', content: partial.text || '(no response)', model: modelId },
      ])
    }
    setStreaming(null)
    setBusy(false)
  }

  async function submitFeedback() {
    const message = fbMessage.trim()
    if (!message || fbBusy) return
    setFbBusy(true)
    setFbError(null)
    try {
      const { eventId } = await callAttorneyMcp<{ eventId: string }>({
        toolName: 'legal.assistant.feedback_submit',
        input: {
          message,
          category: fbCategory,
          // The exact page + which part of the app they were in when submitting.
          pageContext: {
            path: typeof window !== 'undefined' ? window.location.pathname : undefined,
            section: activeScope.matterEntityId
              ? 'matter assistant'
              : activeScope.contactEntityId
                ? 'client assistant'
                : 'global assistant',
          },
          ...scope,
        },
      })
      setFbRef(eventId)
      setFbDone(true)
      setFbMessage('')
    } catch (e) {
      setFbError(e instanceof Error ? e.message : String(e))
    } finally {
      setFbBusy(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="uac">
      {/* ── Toolbar: settings, beta, model name + context toggle ───────────── */}
      <div className="uac-toolbar">
        <button
          type="button"
          className={`uac-iconbtn${settingsOpen ? ' active' : ''}`}
          onClick={() => {
            setSettingsOpen((o) => !o)
            setBetaOpen(false)
            setHistoryOpen(false)
          }}
          aria-label="Assistant settings"
          title="Settings — model, work rate, web search"
        >
          <SettingsIcon size={16} />
        </button>
        <button
          type="button"
          className={`uac-iconbtn${betaOpen ? ' active' : ''}`}
          onClick={() => {
            setBetaOpen((o) => !o)
            setSettingsOpen(false)
            setHistoryOpen(false)
            setFbDone(false)
            setFbRef(null)
            setFbError(null)
          }}
          aria-label="Beta feedback"
          title="Beta feedback — straight to the team"
        >
          <MegaphoneIcon size={16} />
        </button>
        <button
          type="button"
          className={`uac-iconbtn${historyOpen ? ' active' : ''}`}
          onClick={openHistory}
          aria-label="Chat history"
          title="History — reopen a prior conversation"
        >
          <ClockIcon size={16} />
        </button>

        <div className="uac-toolbar-spacer" />

        {selected && <span className="uac-model-name">{selected.label}</span>}
        {effectiveWebSearch && (
          <span className="badge uac-web-badge" title="Answers cite live web sources">
            <SearchIcon size={11} /> web
          </span>
        )}
        {scoped && (
          <button
            type="button"
            className={`uac-ctx${useContext ? ' on' : ''}`}
            onClick={() => setUseContext((v) => !v)}
            title={
              useContext
                ? `Grounded in ${scopeLabel}. Click for a general question.`
                : 'General question — not grounded in this matter/client.'
            }
          >
            {useContext ? `Using ${scopeLabel}` : 'General'}
          </button>
        )}
      </div>

      {/* ── History popover (reopen a prior conversation) ─────────────────── */}
      {historyOpen && (
        <div className="uac-popover uac-history">
          <div className="uac-history-head">Recent conversations</div>
          {threads === null ? (
            <div className="uac-history-empty">
              <span className="spinner" /> Loading…
            </div>
          ) : threads.length === 0 ? (
            <div className="uac-history-empty">No past conversations yet.</div>
          ) : (
            <ul className="uac-history-list">
              {threads.map((t) => {
                const target = t.matterEntityId
                  ? { matterEntityId: t.matterEntityId }
                  : t.contactEntityId
                    ? { contactEntityId: t.contactEntityId }
                    : {}
                const isActive =
                  (target.matterEntityId ?? null) === (activeScope.matterEntityId ?? null) &&
                  (target.contactEntityId ?? null) === (activeScope.contactEntityId ?? null)
                return (
                  <li key={`${t.scope}:${t.matterEntityId ?? t.contactEntityId ?? 'global'}`}>
                    <button
                      type="button"
                      className={`uac-history-item${isActive ? ' active' : ''}`}
                      onClick={() => selectThread(target)}
                    >
                      <span className="uac-history-row-top">
                        <span className="uac-history-label">{t.label}</span>
                        <span className="uac-history-count">{t.count}</span>
                      </span>
                      {t.snippet && <span className="uac-history-snippet">{t.snippet}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* ── Settings popover ──────────────────────────────────────────────── */}
      {settingsOpen && (
        <div className="uac-popover">
          <div className="uac-setting">
            <label className="uac-setting-label">Model</label>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              disabled={!models}
              aria-label="AI model"
            >
              {!models && <option>Loading models…</option>}
              {models?.map((m) => (
                <option key={m.id} value={m.id} disabled={!m.available || !m.connected}>
                  {m.label}
                  {!m.available ? ' — coming soon' : !m.connected ? ' — connect in Settings' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="uac-setting">
            <label className="uac-setting-label">Work rate</label>
            <div className="uac-segmented" role="group" aria-label="Work rate">
              {WORK_RATES.map((w) => (
                <button
                  key={w.value}
                  type="button"
                  className={`uac-seg${workRate === w.value ? ' active' : ''}`}
                  disabled={!selected?.supportsWorkRate}
                  title={w.hint}
                  onClick={() => setWorkRate(w.value)}
                >
                  {w.label}
                </button>
              ))}
            </div>
            {selected && !selected.supportsWorkRate && (
              <p className="uac-hint">
                {selected.providerLabel === 'Claude'
                  ? 'Not adjustable on Haiku.'
                  : 'Not adjustable for this model.'}
              </p>
            )}
          </div>

          <div className="uac-setting uac-setting-row">
            <label className="uac-setting-label">Web search</label>
            <button
              type="button"
              role="switch"
              aria-checked={effectiveWebSearch}
              className={`uac-switch${effectiveWebSearch ? ' on' : ''}`}
              disabled={!selected || !selected.supportsWebSearch || selected.webSearchInherent}
              onClick={() => setWebSearch((v) => !v)}
            >
              <span className="uac-switch-knob" />
            </button>
          </div>
          {selected?.webSearchInherent && (
            <p className="uac-hint">{selected.providerLabel} always searches the web.</p>
          )}
          {selected && !selected.supportsWebSearch && (
            <p className="uac-hint">Web search isn’t available for this model.</p>
          )}
        </div>
      )}

      {/* ── Beta feedback popover ─────────────────────────────────────────── */}
      {betaOpen && (
        <div className="uac-popover uac-beta">
          {fbDone ? (
            <div className="uac-beta-done">
              <span>
                <SparklesIcon size={14} /> Logged to your team ✓
              </span>
              {fbRef && (
                <span className="uac-beta-ref" title={`Recorded as event ${fbRef}`}>
                  ref {fbRef.slice(0, 8)}
                </span>
              )}
            </div>
          ) : (
            <>
              <div className="uac-beta-head">
                <span className="uac-beta-title">
                  <MegaphoneIcon size={13} /> Beta feedback
                </span>
                <span className="uac-beta-sub">
                  Captured with the exact page you’re on — straight to the team.
                </span>
              </div>
              <div className="uac-setting">
                <label className="uac-setting-label">About</label>
                <select
                  value={fbCategory}
                  onChange={(e) => setFbCategory(e.target.value as FeedbackCategory)}
                >
                  {FEEDBACK_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                className="uac-beta-text"
                rows={3}
                placeholder="What’s working, what’s broken, what you wish it did…"
                value={fbMessage}
                onChange={(e) => setFbMessage(e.target.value)}
              />
              {fbError && <div className="alert alert-error">{fbError}</div>}
              <button
                type="button"
                className="primary uac-beta-send"
                disabled={fbBusy || !fbMessage.trim()}
                onClick={() => void submitFeedback()}
              >
                {fbBusy ? 'Sending…' : 'Send feedback'}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Message list ──────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="uac-messages"
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-label="Conversation"
      >
        {intro && turns.length === 0 && !streaming && <div className="feedback-intro">{intro}</div>}
        {turns.map((t, i) => (
          <div key={i} className={`feedback-bubble feedback-bubble-${t.role}`}>
            {/* Assistant replies are markdown — render so **bold**, lists and
                headings display formatted (not as raw syntax). renderMarkdown
                escapes HTML before formatting, so model output can't inject
                markup. User turns stay verbatim. */}
            {t.role === 'assistant' ? (
              <div
                className="assistant-md"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(t.content) }}
              />
            ) : (
              <div style={{ whiteSpace: 'pre-wrap' }}>{t.content}</div>
            )}
            {t.citations && t.citations.length > 0 && (
              <ol className="uac-citations">
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

        {/* The in-flight reply: thinking animation → streamed markdown w/ caret. */}
        {streaming && (
          <div className="feedback-bubble feedback-bubble-assistant">
            {!streaming.text && streaming.thinking && (
              <div className="uac-thinking">
                <div className="uac-thinking-head">
                  <SparklesIcon size={12} /> Thinking…
                </div>
                <div className="uac-thinking-body">{streaming.thinking}</div>
              </div>
            )}
            {!streaming.text && !streaming.thinking && (
              <span className="uac-typing" aria-label="Thinking">
                <span />
                <span />
                <span />
              </span>
            )}
            {streaming.text && (
              <div
                className="assistant-md"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(streaming.text) + '<span class="uac-caret"></span>',
                }}
              />
            )}
          </div>
        )}

        {error && (
          <div role="alert" className="alert alert-error">
            {error}
          </div>
        )}
      </div>

      {/* ── Composer ──────────────────────────────────────────────────────── */}
      <div className="uac-composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={placeholder || 'Message the assistant'}
          rows={2}
        />
        <button
          type="button"
          className="primary uac-send"
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
