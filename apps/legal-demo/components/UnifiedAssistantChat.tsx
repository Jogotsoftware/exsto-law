'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { streamAssistant, type WorkRate, type ContextDepth } from '@/lib/assistantStream'
import { readDevSession } from '@/lib/auth'
import { renderMarkdown } from '@/lib/draftExport'
import {
  SendIcon,
  SettingsIcon,
  MegaphoneIcon,
  SparklesIcon,
  SearchIcon,
  ClockIcon,
  PlusIcon,
  PaperclipIcon,
  FileTextIcon,
  XIcon,
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
  // Names of documents attached to a user turn (shown as chips on the bubble).
  attachments?: string[]
}

// One legal skill (playbook) the attorney can pick from the /skills menu.
interface SkillCatalogItem {
  slug: string
  name: string
  practiceArea: string
  description: string
  whenToUse: string
}

interface ThreadTurn {
  role: 'user' | 'assistant'
  message: string
  reply: string
  model: string
  citations: string[]
  attachmentNames?: string[]
}

// A document attached to the next message: an uploaded file (parsed to text) or a
// matter document. `text` is the content sent to Claude; `name` labels the chip.
interface Attachment {
  name: string
  text: string
  source: 'upload' | 'matter'
}

type FeedbackCategory = 'ui' | 'ai' | 'workflow' | 'feature' | 'other'

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

// How much matter/client history the assistant reads each turn. More = better
// grounded answers, but a larger, slower, pricier prompt.
const CONTEXT_DEPTHS: Array<{ value: ContextDepth; label: string; hint: string }> = [
  { value: 'lean', label: 'Lean', hint: 'Less history — fastest, cheapest' },
  { value: 'balanced', label: 'Balanced', hint: 'Default — recent emails, transcript, intake' },
  { value: 'generous', label: 'Generous', hint: 'Most history + draft — slower, pricier' },
]

const FEEDBACK_CATEGORIES: Array<{ value: FeedbackCategory; label: string }> = [
  { value: 'ui', label: 'UI / design' },
  { value: 'ai', label: 'AI / answers' },
  // A problem with an EXISTING flow vs. asking for something NEW — kept distinct
  // so the team can separate bug triage from the feature/workflow request queue.
  { value: 'workflow', label: 'Workflow problem' },
  { value: 'feature', label: 'Feature / workflow request' },
  { value: 'other', label: 'Other' },
]

const IS_DEV = process.env.NODE_ENV !== 'production'

// Dev-only session headers for direct (non-MCP) fetches like the attach upload —
// mirrors callAttorneyMcp/streamAssistant. Inert in prod (the signed cookie rides
// along automatically and the route ignores these headers there).
function devAuthHeaders(): Record<string, string> {
  if (!IS_DEV) return {}
  const dev = readDevSession()
  return dev ? { 'x-actor-id': dev.actorId, 'x-tenant-id': dev.tenantId } : {}
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

// The attorney's last-picked model, remembered across sessions so the chat stops
// resetting to the default each time it opens (beta ask). localStorage (not a
// cookie) — it's a per-browser UI preference, never sent to the server.
const MODEL_STORAGE_KEY = 'exsto.assistant.modelId'

function readStoredModelId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(MODEL_STORAGE_KEY)
  } catch {
    return null // storage disabled / private mode
  }
}

function storeModelId(id: string): void {
  if (typeof window === 'undefined' || !id) return
  try {
    window.localStorage.setItem(MODEL_STORAGE_KEY, id)
  } catch {
    // ignore — a remembered model is a nicety, not load-bearing
  }
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
  // The in-flight assistant reply, streamed token-by-token. `skills` holds any
  // specialized playbooks the model loaded for this turn (shown as "using …").
  const [streaming, setStreaming] = useState<{
    thinking: string
    text: string
    skills: { slug: string; name: string }[]
  } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  // Bumped whenever the conversation is superseded (a new send, or switching to a
  // prior thread). In-flight stream/load callbacks compare against it and no-op
  // when stale, so an old reply can never land in a newly-opened thread.
  const genRef = useRef(0)

  // /skills picker — the firm's legal playbooks the attorney can force-load.
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalogItem[] | null>(null)
  const [selectedSkills, setSelectedSkills] = useState<{ slug: string; name: string }[]>([])
  const [skillMenuOpen, setSkillMenuOpen] = useState(false)
  const [skillQuery, setSkillQuery] = useState('')

  // Toolbar panels + settings.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [feedbackMode, setFeedbackMode] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null)
  const [workRate, setWorkRate] = useState<WorkRate>('balanced')
  const [webSearch, setWebSearch] = useState(false)
  const [useContext, setUseContext] = useState(true)
  const [contextDepth, setContextDepth] = useState<ContextDepth>('balanced')

  // Beta-feedback form.
  const [fbCategory, setFbCategory] = useState<FeedbackCategory>('other')
  const [fbBusy, setFbBusy] = useState(false)
  const [fbDone, setFbDone] = useState(false)
  const [fbError, setFbError] = useState<string | null>(null)
  // The substrate event id the feedback landed as — shown back as a reference so
  // the attorney can see it was durably recorded (the "where did it go / no audit
  // trail" beta asks).
  const [fbRef, setFbRef] = useState<string | null>(null)

  // Documents attached to the NEXT message. Cleared after each send (per-message,
  // like email attachments). Claude only — see canAttach below.
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachBusy, setAttachBusy] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const MAX_ATTACHMENTS = 6

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
  // Skills run on the Claude path only (the catalog + load_skill tool); the
  // /skills affordance and any picked skills are hidden/ignored for Perplexity.
  const isClaude = selected?.provider === 'anthropic'
  const effectiveWebSearch = selected
    ? selected.webSearchInherent || (selected.supportsWebSearch && webSearch)
    : false
  // Attachments go ONLY to the firm's own model (Claude). An external research
  // model (Perplexity) must never receive client documents, so the affordance is
  // hidden for it — matching the provider-privacy split in assistantChat.ts.
  const canAttach = selected?.provider === 'anthropic'

  // Switching to a non-Claude model drops any staged attachments (they can't be
  // sent), so stale chips don't imply they will be.
  useEffect(() => {
    if (!canAttach) {
      setAttachments([])
      setAttachMenuOpen(false)
      setAttachError(null)
    }
  }, [canAttach])

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
        // Restore the remembered model if it's still selectable (available +
        // connected); otherwise fall back to the usual default.
        setModelId((prev) => {
          if (prev) return prev
          const stored = readStoredModelId()
          if (stored && r.models.some((m) => m.id === stored && m.available && m.connected)) {
            return stored
          }
          return pickDefault(r.models) || ''
        })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Load the firm's legal skills catalog once (for the /skills picker). Excludes
  // the academic law-school skills server-side; only fetched when Claude is in use.
  useEffect(() => {
    if (!isClaude || skillCatalog) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await callAttorneyMcp<{ skills: SkillCatalogItem[] }>({
          toolName: 'legal.skill.list',
        })
        if (!cancelled) setSkillCatalog(r.skills)
      } catch {
        // Non-fatal: the picker just stays empty if the catalog can't load.
        if (!cancelled) setSkillCatalog([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isClaude, skillCatalog])

  // Load the persisted thread for a scope into the chat. The history picker calls
  // this with a different scope to reopen another conversation.
  const loadHistory = useCallback(
    async (target: { matterEntityId?: string; contactEntityId?: string }) => {
      const gen = genRef.current
      try {
        const r = await callAttorneyMcp<{ turns: ThreadTurn[] }>({
          toolName: 'legal.assistant.thread',
          input: target,
        })
        if (genRef.current !== gen) return // a newer send/selection superseded this load
        const display: DisplayTurn[] = r.turns.map((t) =>
          t.role === 'user'
            ? { role: 'user', content: t.message, attachments: t.attachmentNames }
            : { role: 'assistant', content: t.reply, citations: t.citations, model: t.model },
        )
        setTurns(display)
      } catch (e) {
        if (genRef.current !== gen) return
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
    genRef.current++ // invalidate any in-flight send so its callbacks no-op
    setHistoryOpen(false)
    setActiveScope(target)
    setTurns([])
    setStreaming(null)
    setError(null)
    setInput('')
    setBusy(false)
    setUseContext(true)
    setFeedbackMode(false)
    setFbDone(false)
    setFbRef(null)
    setFbError(null)
    setAttachments([])
    setAttachError(null)
    setAttachMenuOpen(false)
    void loadHistory(target)
    // The picker button just unmounted; return keyboard focus to the composer.
    setTimeout(() => composerRef.current?.focus(), 0)
  }

  // Open the history picker and (re)load the thread list.
  function openHistory() {
    const opening = !historyOpen
    setHistoryOpen(opening)
    setSettingsOpen(false)
    if (opening) {
      setThreads(null)
      callAttorneyMcp<{ threads: ThreadSummary[] }>({ toolName: 'legal.assistant.threads' })
        .then((r) => setThreads(r.threads))
        .catch(() => setThreads([]))
    }
  }

  // Start a fresh conversation in the current scope. The persisted thread is
  // untouched (append-only) — it stays reachable from the history picker.
  function toggleSkill(s: SkillCatalogItem) {
    setSelectedSkills((prev) =>
      prev.some((x) => x.slug === s.slug)
        ? prev.filter((x) => x.slug !== s.slug)
        : [...prev, { slug: s.slug, name: s.name }],
    )
  }

  function newChat() {
    genRef.current++ // abandon any in-flight stream
    setTurns([])
    setStreaming(null)
    setError(null)
    setInput('')
    setBusy(false)
    setHistoryOpen(false)
    setSkillMenuOpen(false)
    setSelectedSkills([])
    setFeedbackMode(false)
    setFbDone(false)
    setFbRef(null)
    setFbError(null)
    setAttachments([])
    setAttachError(null)
    setAttachMenuOpen(false)
    setTimeout(() => composerRef.current?.focus(), 0)
  }

  // Keep the latest turn in view as content streams in.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns, busy, streaming])

  // ── Attachments ────────────────────────────────────────────────────────────
  function removeAttachment(idx: number) {
    setAttachments((a) => a.filter((_, i) => i !== idx))
  }

  // Parse an uploaded file to text server-side, then stage it for the next send.
  async function uploadFile(file: File) {
    if (attachments.length >= MAX_ATTACHMENTS) {
      setAttachError(`You can attach up to ${MAX_ATTACHMENTS} documents at a time.`)
      return
    }
    setAttachBusy(true)
    setAttachError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/attorney/assistant/attach', {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
        headers: devAuthHeaders(),
      })
      const data = (await res.json().catch(() => null)) as {
        name?: string
        text?: string
        error?: string
      } | null
      if (!res.ok || !data?.text) {
        throw new Error(data?.error || `Couldn’t read that file (${res.status}).`)
      }
      setAttachments((a) => [
        ...a,
        { name: data.name || file.name, text: data.text as string, source: 'upload' },
      ])
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : String(e))
    } finally {
      setAttachBusy(false)
    }
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // let the same file be re-picked later
    for (const f of files) void uploadFile(f)
  }

  // Attach the current matter's document (its latest draft) by pulling its body.
  async function attachMatterDocument() {
    const matterId = activeScope.matterEntityId
    if (!matterId) return
    if (attachments.length >= MAX_ATTACHMENTS) {
      setAttachError(`You can attach up to ${MAX_ATTACHMENTS} documents at a time.`)
      return
    }
    setAttachBusy(true)
    setAttachError(null)
    try {
      const { matter } = await callAttorneyMcp<{
        matter: { latestDraftVersionId: string | null } | null
      }>({ toolName: 'legal.matter.get', input: { matterEntityId: matterId } })
      const versionId = matter?.latestDraftVersionId
      if (!versionId) {
        setAttachError('This matter has no document yet.')
        return
      }
      const { draft } = await callAttorneyMcp<{
        draft: { bodyMarkdown: string; documentKind: string; matterNumber: string } | null
      }>({ toolName: 'legal.draft.get', input: { documentVersionId: versionId } })
      if (!draft?.bodyMarkdown) {
        setAttachError('Could not read this matter’s document.')
        return
      }
      const name = `${draft.matterNumber} — ${draft.documentKind.replace(/_/g, ' ')}`
      setAttachments((a) =>
        a.some((x) => x.source === 'matter' && x.name === name)
          ? a // already attached
          : [...a, { name, text: draft.bodyMarkdown, source: 'matter' }],
      )
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : String(e))
    } finally {
      setAttachBusy(false)
    }
  }

  // Paperclip: when a matter document is available, open a small source menu;
  // otherwise jump straight to the file picker.
  function onAttachClick() {
    if (activeScope.matterEntityId) {
      setAttachMenuOpen((o) => !o)
    } else {
      fileInputRef.current?.click()
    }
  }

  async function send() {
    const message = input.trim()
    if (!message || busy || !modelId) return
    const gen = ++genRef.current // this exchange's generation; stale callbacks no-op
    const live = () => genRef.current === gen
    setError(null)
    setBusy(true)
    setSettingsOpen(false)
    // The model history the server expects: prior user/assistant turns as text.
    const history = turns.map((t) => ({ role: t.role, content: t.content }))
    // Attachments are per-message and Claude-only; snapshot then clear them.
    const sentAttachments = canAttach ? attachments : []
    setTurns((t) => [
      ...t,
      {
        role: 'user',
        content: message,
        attachments: sentAttachments.length ? sentAttachments.map((a) => a.name) : undefined,
      },
    ])
    setInput('')
    setAttachments([])
    setAttachMenuOpen(false)

    // Accumulate deltas locally; each handler hands React a fresh object.
    const partial = { thinking: '', text: '', skills: [] as { slug: string; name: string }[] }
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
          // Depth only matters when grounded in a matter/client.
          contextDepth: scoped && useContext ? contextDepth : undefined,
          // Attorney-picked skills (Claude only) — force-loaded this turn.
          skillSlugs: isClaude && selectedSkills.length ? selectedSkills.map((s) => s.slug) : undefined,
          attachments: sentAttachments.length
            ? sentAttachments.map((a) => ({ name: a.name, text: a.text }))
            : undefined,
          pageContext:
            typeof window !== 'undefined' ? { path: window.location.pathname } : undefined,
        },
        {
          onThinking: (t) => {
            if (!live()) return
            partial.thinking += t
            setStreaming({ ...partial })
          },
          onText: (t) => {
            if (!live()) return
            partial.text += t
            setStreaming({ ...partial })
          },
          onSkill: (s) => {
            if (!live()) return
            if (s.slug && !partial.skills.some((x) => x.slug === s.slug)) partial.skills.push(s)
            setStreaming({ ...partial, skills: [...partial.skills] })
          },
          onDone: (d) => {
            if (!live()) return
            finished = true
            setTurns((prev) => [
              ...prev,
              { role: 'assistant', content: d.reply, citations: d.citations, model: d.model },
            ])
            setStreaming(null)
          },
          onError: (m) => {
            if (!live()) return
            finished = true
            setError(m)
            setStreaming(null)
          },
        },
      )
    } catch (e) {
      if (!live()) return
      finished = true
      setError(e instanceof Error ? e.message : String(e))
      setStreaming(null)
    }

    // A newer send or a thread switch superseded this exchange — leave the
    // reopened conversation's state untouched (its reply must not land here).
    if (!live()) return

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

  // Log the whole feedback-mode conversation as ONE feedback record (the attorney
  // and the assistant fleshed it out together), with the page + scope context.
  async function submitFeedback() {
    if (fbBusy || turns.length === 0) return
    setFbBusy(true)
    setFbError(null)
    const transcript = turns
      .map((t) => `${t.role === 'user' ? 'Attorney' : 'Assistant'}: ${t.content}`)
      .join('\n\n')
    try {
      const { eventId } = await callAttorneyMcp<{ eventId: string }>({
        toolName: 'legal.assistant.feedback_submit',
        input: {
          message: transcript,
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
    } catch (e) {
      setFbError(e instanceof Error ? e.message : String(e))
    } finally {
      setFbBusy(false)
    }
  }

  // Leave feedback mode. After a submitted thread, start a fresh regular chat;
  // otherwise just drop the banner and keep whatever was said.
  function exitFeedbackMode() {
    if (fbDone) {
      newChat()
      return
    }
    setFeedbackMode(false)
    setFbError(null)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Type "/" on an empty composer to open the skills menu (Claude only).
    if (e.key === '/' && !input && isClaude) {
      e.preventDefault()
      setSkillMenuOpen(true)
      return
    }
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
            setHistoryOpen(false)
          }}
          aria-label="Assistant settings"
          title="Settings — model, work rate, web search"
        >
          <SettingsIcon size={16} />
        </button>
        <button
          type="button"
          className={`uac-iconbtn${feedbackMode ? ' active' : ''}`}
          onClick={() => {
            setFeedbackMode((m) => !m)
            setSettingsOpen(false)
            setHistoryOpen(false)
            setFbDone(false)
            setFbRef(null)
            setFbError(null)
          }}
          aria-label="Feedback mode"
          aria-pressed={feedbackMode}
          title="Feedback mode — talk it through, then log the whole thread"
        >
          <MegaphoneIcon size={16} />
        </button>
        <button
          type="button"
          className={`uac-iconbtn${historyOpen ? ' active' : ''}`}
          onClick={openHistory}
          aria-label="Chat history"
          aria-expanded={historyOpen}
          aria-haspopup="menu"
          title="History — reopen a prior conversation"
        >
          <ClockIcon size={16} />
        </button>
        {turns.length > 0 && (
          <button
            type="button"
            className="uac-iconbtn"
            onClick={newChat}
            aria-label="New chat"
            title="New chat — clear this conversation"
          >
            <PlusIcon size={16} />
          </button>
        )}

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
                        <span
                          className="uac-history-count"
                          title={`${t.count} ${t.count === 1 ? 'turn' : 'turns'}`}
                        >
                          {t.count}
                        </span>
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
              onChange={(e) => {
                setModelId(e.target.value)
                storeModelId(e.target.value) // remember it for next session
              }}
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

          {scoped && (
            <div className="uac-setting">
              <label className="uac-setting-label">Context depth</label>
              <div className="uac-segmented" role="group" aria-label="Context depth">
                {CONTEXT_DEPTHS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    className={`uac-seg${contextDepth === d.value ? ' active' : ''}`}
                    disabled={!useContext}
                    title={d.hint}
                    onClick={() => setContextDepth(d.value)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <p className="uac-hint">
                {useContext
                  ? 'How much of the current matter/client the assistant reads each message.'
                  : 'Turn the context toggle on to ground the assistant in this matter/client.'}
              </p>
            </div>
          )}

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

      {/* ── Feedback mode banner ──────────────────────────────────────────── */}
      {feedbackMode && (
        <div className="uac-fbmode" role="region" aria-label="Feedback mode">
          {fbDone ? (
            <div className="uac-fbmode-done">
              <span className="uac-fbmode-thanks">
                <SparklesIcon size={16} /> Thank you — your feedback is with the team.
              </span>
              {fbRef && (
                <span className="uac-fbmode-refrow">
                  <span className="uac-fbmode-reflabel">Reference</span>
                  <code className="uac-beta-ref" title={`Recorded as event ${fbRef}`}>
                    {fbRef.slice(0, 8)}
                  </code>
                </span>
              )}
              <button
                type="button"
                className="uac-fbmode-exit uac-fbmode-backbtn"
                onClick={exitFeedbackMode}
              >
                Back to chat
              </button>
            </div>
          ) : (
            <>
              <div className="uac-fbmode-head">
                <span className="uac-fbmode-title">
                  <MegaphoneIcon size={13} /> Feedback mode
                </span>
                <span className="uac-fbmode-sub">
                  Tell me what’s working, broken, or missing — I’ll ask a follow-up or two, then log
                  the whole thread to the team.
                </span>
              </div>
              <div className="uac-fbmode-controls">
                <label className="uac-fbmode-catlabel">
                  <span>Category</span>
                  <select
                    aria-label="Feedback category"
                    value={fbCategory}
                    onChange={(e) => setFbCategory(e.target.value as FeedbackCategory)}
                  >
                    {FEEDBACK_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="uac-fbmode-actions">
                  <button
                    type="button"
                    className="uac-fbmode-exit"
                    onClick={exitFeedbackMode}
                    disabled={fbBusy}
                  >
                    Exit
                  </button>
                  <button
                    type="button"
                    className="primary uac-fbmode-send"
                    disabled={fbBusy || turns.length === 0}
                    onClick={() => void submitFeedback()}
                    title={
                      turns.length === 0 ? 'Describe your feedback in the chat first' : undefined
                    }
                  >
                    {fbBusy ? 'Submitting…' : 'Submit feedback'}
                  </button>
                </div>
              </div>
              {fbError && <div className="alert alert-error">{fbError}</div>}
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
        {/* Greeting: render as the assistant's first message bubble (not a centered
            header), so an empty chat already reads like the assistant opened it.
            Ephemeral — it isn't a stored turn; it clears once the attorney replies. */}
        {intro && turns.length === 0 && !streaming && (
          <div className="feedback-bubble feedback-bubble-assistant">
            <div className="assistant-md">{intro}</div>
          </div>
        )}
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
            {t.role === 'user' && t.attachments && t.attachments.length > 0 && (
              <div className="uac-bubble-attachments">
                {t.attachments.map((name, k) => (
                  <span key={k} className="uac-attach-chip uac-attach-chip-static" title={name}>
                    <FileTextIcon size={11} />
                    <span className="uac-attach-chip-name">{name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* The in-flight reply: thinking animation → streamed markdown w/ caret. */}
        {streaming && (
          <div className="feedback-bubble feedback-bubble-assistant">
            {streaming.skills.length > 0 && (
              <div className="uac-skill-chips">
                {streaming.skills.map((s) => (
                  <span key={s.slug} className="uac-skill-chip">
                    <SparklesIcon size={11} /> Using {s.name}
                  </span>
                ))}
              </div>
            )}
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

      {/* Composer: legal-skills menu + staged attachments + input */}
      <div className="uac-composer-wrap uac-composer-area">
        {/* Legal-skills menu (Claude only) — opens above the composer. */}
        {isClaude && skillMenuOpen && (
          <div className="uac-skillmenu" role="dialog" aria-label="Legal skills">
            <div className="uac-skillmenu-head">
              <SparklesIcon size={13} />
              <input
                autoFocus
                className="uac-skillmenu-search"
                value={skillQuery}
                onChange={(e) => setSkillQuery(e.target.value)}
                placeholder="Search legal skills…"
                aria-label="Search legal skills"
              />
              <button
                type="button"
                className="uac-skillmenu-close"
                onClick={() => {
                  setSkillMenuOpen(false)
                  setSkillQuery('')
                }}
                aria-label="Close skills menu"
              >
                ×
              </button>
            </div>
            <div className="uac-skillmenu-list">
              {skillCatalog === null && <div className="uac-skillmenu-empty">Loading skills…</div>}
              {skillCatalog !== null &&
                (() => {
                  const q = skillQuery.trim().toLowerCase()
                  const matches = skillCatalog.filter(
                    (s) =>
                      !q ||
                      s.name.toLowerCase().includes(q) ||
                      s.slug.toLowerCase().includes(q) ||
                      s.practiceArea.toLowerCase().includes(q) ||
                      s.whenToUse.toLowerCase().includes(q),
                  )
                  if (!matches.length)
                    return <div className="uac-skillmenu-empty">No skills match.</div>
                  const groups = new Map<string, SkillCatalogItem[]>()
                  for (const s of matches) {
                    const a = groups.get(s.practiceArea) ?? []
                    a.push(s)
                    groups.set(s.practiceArea, a)
                  }
                  return [...groups.entries()].map(([area, list]) => (
                    <div key={area} className="uac-skillmenu-group">
                      <div className="uac-skillmenu-area">{area}</div>
                      {list.map((s) => {
                        const on = selectedSkills.some((x) => x.slug === s.slug)
                        return (
                          <button
                            key={s.slug}
                            type="button"
                            className={`uac-skillmenu-item${on ? ' is-on' : ''}`}
                            onClick={() => toggleSkill(s)}
                            title={s.whenToUse}
                          >
                            <span className="uac-skillmenu-name">
                              {on ? '✓ ' : ''}
                              {s.name}
                            </span>
                            {s.description && (
                              <span className="uac-skillmenu-desc">{s.description}</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  ))
                })()}
            </div>
          </div>
        )}

        {canAttach && attachments.length > 0 && (
          <div className="uac-staged-attachments">
            {attachments.map((a, i) => (
              <span key={i} className="uac-attach-chip" title={a.name}>
                {a.source === 'matter' ? <FileTextIcon size={11} /> : <PaperclipIcon size={11} />}
                <span className="uac-attach-chip-name">{a.name}</span>
                <button
                  type="button"
                  className="uac-attach-remove"
                  onClick={() => removeAttachment(i)}
                  aria-label={`Remove ${a.name}`}
                >
                  <XIcon size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        {attachError && (
          <div className="uac-attach-error" role="alert">
            {attachError}
          </div>
        )}
        <div className={`uac-composer${canAttach ? ' has-attach' : ''}`}>
          {canAttach && (
            <button
              type="button"
              className={`uac-attach-btn${attachMenuOpen ? ' active' : ''}`}
              onClick={onAttachClick}
              disabled={attachBusy}
              aria-label="Attach a document"
              aria-haspopup={activeScope.matterEntityId ? 'menu' : undefined}
              aria-expanded={activeScope.matterEntityId ? attachMenuOpen : undefined}
              title="Attach a document"
            >
              {attachBusy ? <span className="spinner" /> : <PaperclipIcon size={16} />}
            </button>
          )}
          {attachMenuOpen && canAttach && (
            <div className="uac-attach-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="uac-attach-menu-item"
                onClick={() => {
                  setAttachMenuOpen(false)
                  fileInputRef.current?.click()
                }}
              >
                <PaperclipIcon size={14} /> Upload a file
              </button>
              {activeScope.matterEntityId && (
                <button
                  type="button"
                  role="menuitem"
                  className="uac-attach-menu-item"
                  onClick={() => {
                    setAttachMenuOpen(false)
                    void attachMatterDocument()
                  }}
                >
                  <FileTextIcon size={14} /> This matter’s document
                </button>
              )}
            </div>
          )}
          <textarea
            ref={composerRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={placeholder || 'Message the assistant'}
            rows={2}
          />
          <button
            type="button"
            className="uac-send"
            onClick={() => void send()}
            disabled={busy || !input.trim() || !modelId}
            aria-label="Send"
          >
            <SendIcon size={16} />
          </button>
        </div>

        {/* Skills affordance (Claude only): the /skills trigger + picked-skill pills. */}
        {isClaude && (
          <div className="uac-skillbar">
            <button
              type="button"
              className={`uac-skilltrigger${skillMenuOpen ? ' is-open' : ''}`}
              onClick={() => setSkillMenuOpen((o) => !o)}
              title="Add a legal skill (or type / in an empty message)"
            >
              <SparklesIcon size={13} /> /skills
            </button>
            {selectedSkills.map((s) => (
              <span key={s.slug} className="uac-skill-pill">
                {s.name}
                <button
                  type="button"
                  className="uac-skill-pill-x"
                  onClick={() => setSelectedSkills((prev) => prev.filter((x) => x.slug !== s.slug))}
                  aria-label={`Remove ${s.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/html"
          multiple
          hidden
          onChange={onFilePicked}
        />
      </div>
    </div>
  )
}
