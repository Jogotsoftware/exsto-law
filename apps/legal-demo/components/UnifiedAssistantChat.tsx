'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import {
  streamAssistant,
  type WorkRate,
  type ContextDepth,
  type EditorLaunchEvent,
} from '@/lib/assistantStream'
import { QuestionnaireEditorModal } from '@/components/QuestionnaireEditorModal'
import { TemplateEditorModal } from '@/components/TemplateEditorModal'
import { WorkflowEditorModal } from '@/components/WorkflowEditorModal'
import type { QuestionnaireSchema } from '@/components/QuestionnaireBuilder'
import type { WfLifecycle } from '@/lib/workflowBuilderModel'
import { assistantHistoryContent } from '@/lib/buildHistoryContent'
import { stripMachinery, MACHINERY_OPEN } from '@/lib/assistantText'
import { WorkingIndicator } from '@/components/WorkingIndicator'
import { WorkflowProposalCard, type WorkflowProposal } from '@/components/WorkflowProposalCard'
import {
  ServiceProposalCard,
  type ServiceProposal,
  type OnApproved,
} from '@/components/ServiceProposalCard'
import {
  QuestionnaireProposalCard,
  type QuestionnaireProposal,
} from '@/components/QuestionnaireProposalCard'
import { TemplateProposalCard, type TemplateProposal } from '@/components/TemplateProposalCard'
import { CostProposalCard, type CostProposal } from '@/components/CostProposalCard'
import { EnableProposalCard, type EnableProposal } from '@/components/EnableProposalCard'
import { KindProposalCard, type KindProposal } from '@/components/KindProposalCard'
import { QuestionBatch } from '@/components/QuestionBatch'
import type { BuildQuestionEvent } from '@/lib/assistantStream'
import { readDevSession } from '@/lib/auth'
import { renderMarkdown, downloadAsPdf, downloadAsWord } from '@/lib/draftExport'
import { GemCluster, GemSparkle } from '@/components/GemSparkle'
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
  CopyIcon,
  CheckIcon,
  LayersIcon,
  ShieldCheckIcon,
  WandIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ListIcon,
  CheckCircleIcon,
  UploadIcon,
  ArrowRightIcon,
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

// A finished document the assistant produced (a deliverable to download/save),
// distinct from the prose reply.
interface ProducedDoc {
  title: string
  markdown: string
}

interface DisplayTurn {
  role: 'user' | 'assistant'
  content: string
  // Model-facing record of this turn, used when building the next request's history.
  // Differs from `content` when the turn spoke through cards (ask_build_question /
  // proposal tool calls produce no prose): `content` is what the UI shows (possibly
  // nothing), `historyContent` is what the model must remember having said. Without
  // it a card-only turn serializes into history as '', the model loses its place in
  // the guided build and re-asks earlier questions ("goes back a step").
  historyContent?: string
  // Hidden continuation (build primer / question answers / approval nudges): kept in
  // `turns` so the model re-sees it in history, but never rendered as a bubble.
  hiddenFromUi?: boolean
  // The send that carried this user turn failed (after the automatic retry). The
  // bubble stays visible (dimmed) so the attorney sees what didn't go through, but
  // the turn is EXCLUDED from the history sent to the model — otherwise the next
  // send would show the model the same unanswered question twice. Cleared when the
  // attorney clicks "Try again" (the same turn is re-sent, context intact).
  failed?: boolean
  citations?: string[]
  model?: string
  // Names of documents attached to a user turn (shown as chips on the bubble).
  attachments?: string[]
  // Documents the assistant produced on an assistant turn — shown as download cards.
  documents?: ProducedDoc[]
  // Workflow proposals the assistant captured on an assistant turn — shown as inline
  // approval cards (PR5). The live write happens only when the attorney approves.
  workflowProposals?: WorkflowProposal[]
  // New-service proposals the assistant captured (Build-Wizard Phase 1) — shown as
  // inline approval cards. The service is created only when the attorney approves.
  serviceProposals?: ServiceProposal[]
  // Questionnaire proposals captured (Build-Wizard Phase 2) — inline approval cards.
  questionnaireProposals?: QuestionnaireProposal[]
  // Document-template proposals captured (Build-Wizard Phase 3) — inline approval cards.
  templateProposals?: TemplateProposal[]
  // Billing proposals captured (Build-Wizard Phase 6) — inline approval cards.
  costProposals?: CostProposal[]
  // Enable proposals captured (Build-Wizard Phase 6, terminal) — the final approval card.
  enableProposals?: EnableProposal[]
  // Structured interview questions the assistant asked (Build-Wizard Phase 7) — shown
  // as click-to-answer QuestionCards. Ephemeral to the live session (not persisted to
  // the thread): once answered they've already driven the build forward.
  buildQuestions?: BuildQuestionEvent[]
  // New data-kind proposals captured (Tier 1 data-as-schema) — inline approval cards.
  kindProposals?: KindProposal[]
  // The model's own reasoning/process for this turn, relocated OUT of the reply and
  // shown behind a collapsed, expandable "thinking" disclosure (BUILDER-REASONING-
  // CHANNEL-1). Absent when the turn produced no thinking (e.g. the 'quick' work rate).
  reasoning?: string
  // Non-fatal warnings surfaced on this turn (e.g. the tool-round cap cut a pending
  // step off) — rendered as a visible notice line, never as a turn failure (WP5.1).
  notices?: TurnNotice[]
}

// A non-fatal notice on a turn (BUILDER-UX-3 P3). tone 'warning' (the default)
// renders the amber box; 'status' is a muted progress line ("Taking another
// pass…") — transient: shown live while streaming, dropped when the turn commits.
interface TurnNotice {
  message: string
  tone: 'status' | 'warning'
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
  reasoning?: string
  model: string
  citations: string[]
  // WP-D6: the user half of this turn was app orchestration (a hidden driver),
  // not attorney prose — hide it on replay.
  syntheticDriver?: boolean
  attachmentNames?: string[]
  documents?: ProducedDoc[]
  workflowProposals?: WorkflowProposal[]
  serviceProposals?: ServiceProposal[]
  questionnaireProposals?: QuestionnaireProposal[]
  templateProposals?: TemplateProposal[]
  costProposals?: CostProposal[]
  enableProposals?: EnableProposal[]
  kindProposals?: KindProposal[]
}

// A document attached to the next message: an uploaded file (parsed to text), a
// matter document, or a firm template (WP-L "Insert a template"). `text` is the
// content sent to Claude; `name` labels the chip.
interface Attachment {
  name: string
  text: string
  source: 'upload' | 'matter' | 'template'
}

// One firm template in the "Insert a template" picker (legal.template.list —
// the same read the Templates gallery uses; body rides along).
interface TemplateOpt {
  templateEntityId: string
  name: string
  body: string
  docKind: string | null
}

// A bookable service in the guided new-matter flow (legal.matter.open needs one).
interface ServiceOpt {
  serviceKey: string
  displayName: string
  bookable?: boolean
}

// WP-L — the guided "Create a new matter" flow (comp: startQaFlow). A LOCAL chip
// walk, not an AI conversation: each step is an assistant-style question with
// option chips / a typed answer, and the finish is a REAL matter via the existing
// legal.matter.open operation (the same call NewMatterModal makes). The comp's
// demo questions (matter type / how found / turnaround) have no substrate fields;
// the real flow asks exactly what matter.open needs — see WIRING §WP-L.
interface MatterFlow {
  step: 'service' | 'name' | 'email' | 'creating' | 'done' | 'error'
  services: ServiceOpt[] | null
  serviceKey?: string
  serviceName?: string
  clientFullName?: string
  clientEmail?: string
  matterEntityId?: string
  error?: string
}

// WP-L — the build-mode progress strip maps approvals onto the comp's six phases.
// Approvals can land out of canonical order (the wizard sometimes drafts the
// document before the intake form); the strip shows the FIRST phase not yet
// approved, and "Step n of 6" counts approvals + the one in progress.
const BUILD_PHASES: Array<{ artifact: string; label: string }> = [
  { artifact: 'service', label: 'Define service' },
  { artifact: 'questionnaire', label: 'Client intake' },
  { artifact: 'template', label: 'Document template' },
  { artifact: 'workflow', label: 'Workflow' },
  { artifact: 'billing', label: 'Billing' },
  { artifact: 'enable', label: 'Review & publish' },
]

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

// One saved conversation (assistant_chat_session) in the history picker
// (from legal.assistant.chat_sessions) — WP-D2.
interface ChatSessionSummary {
  chatSessionId: string
  title: string
  scope: 'global' | 'matter' | 'contact'
  scopeEntityId: string | null
  status: 'open' | 'closed'
  startedAt: string
  lastMessageAt: string | null
  turnCount: number
}

// BUILDER-UX-1 WP-5 — one guided build = one titled thread (from
// legal.assistant.build_sessions), separate from App help + matter threads.
interface BuildSessionSummary {
  buildSessionId: string
  title: string
  serviceKey: string | null
  status: 'open' | 'closed'
  startedAt: string
  lastMessageAt: string | null
  messageCount: number
}

export interface UnifiedAssistantChatProps {
  matterEntityId?: string
  contactEntityId?: string
  // Load the persisted thread for this scope on mount (matter/contact chats).
  loadThread?: boolean
  // Shown above the first message.
  intro?: string
  placeholder?: string
  // Prime the composer with this text on mount (e.g. a "Build with AI" launcher
  // that pre-writes the request). The attorney still presses Send — we never
  // auto-submit. Seeded once; later edits/sends clear it normally.
  initialInput?: string
  // WP-L: when hosted in the floating panel, the chat renders the comp's navy
  // header (gemstar + title + model status + History/New/Close) itself — the
  // header needs the model + history state that lives here. Absent ⇒ no header.
  onClose?: () => void
}

const WORK_RATES: Array<{ value: WorkRate; label: string; hint: string }> = [
  { value: 'quick', label: 'Quick', hint: 'Fast, light reasoning' },
  { value: 'balanced', label: 'Balanced', hint: 'Default — adaptive thinking' },
  { value: 'thorough', label: 'Thorough', hint: 'Deeper thinking, slower' },
]

// The single "context" control in the chat toolbar. Three are depth levels (how
// much of the matter/client the assistant reads each turn) and Secure is a mode —
// full context to the firm's own model, but never used for web search or any
// external call. Maps onto the existing depth ('lean'|'balanced'|'generous') +
// secureMode pair: Full ⇒ generous, Secure ⇒ generous + locked.
type ContextLevel = 'lean' | 'balanced' | 'full' | 'secure'
const CONTEXT_LEVELS: Array<{ value: ContextLevel; label: string; hint: string }> = [
  { value: 'lean', label: 'Lean', hint: 'Less history — fastest, cheapest' },
  {
    value: 'balanced',
    label: 'Balanced',
    hint: 'Default — recent emails, transcript, intake, tasks',
  },
  {
    value: 'full',
    label: 'Full',
    hint: 'Everything on the matter — emails, transcript, intake, documents, tasks, meetings, billing',
  },
  {
    value: 'secure',
    label: 'Secure',
    hint: 'Full context, but never used for web search or any external call',
  },
]
function depthToLevel(depth: ContextDepth, secure: boolean): ContextLevel {
  if (secure) return 'secure'
  return depth === 'generous' ? 'full' : depth
}

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

function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'document'
  )
}

// Snapshot the VISIBLE content of the current page so the assistant can answer
// about "what's on this page / this matter screen / this invoice / these entries".
// It reads the #main region — the chat panel is a sibling of #main in the layout,
// so the conversation itself is never fed back in. Whitespace is collapsed and the
// text is bounded (the server bounds it again). Claude-only; the caller skips this
// for the external research model so page content never leaves the firm.
// Errors worth ONE silent automatic retry: infrastructure hiccups (model
// overloaded, rate limited, gateway/network blips) where an immediate re-send
// usually succeeds — the attorney just sees the thinking indicator continue.
// Anything else (bad request, auth, validation) surfaces immediately with the
// manual "Try again" instead; retrying those wouldn't change the outcome.
function isTransientAssistantError(message: string): boolean {
  return /overloaded|rate.?limit|too many requests|timed?.?out|timeout|network|failed to fetch|load failed|connection|temporarily unavailable|service unavailable|internal server error|request failed \(5\d\d\)|\b(429|500|502|503|504|529)\b/i.test(
    message,
  )
}

// Last line of defense so the transcript never shows machinery. The server
// already humanizes model errors, but if a raw API-error body (e.g.
// `529 {"type":"error",...}`) ever reaches the UI from any path, replace it
// with a plain sentence — never render JSON or a request_id to the attorney.
function humanizeClientError(message: string): string {
  const looksLikeJson = /[{[]/.test(message) && /"(type|error|request_id)"\s*:/.test(message)
  if (!looksLikeJson) return message
  return isTransientAssistantError(message)
    ? 'The assistant is briefly overloaded — please try again in a moment.'
    : "The assistant couldn't complete that request. Please try again."
}

const MAX_PAGE_CONTENT_CHARS = 14000
function capturePageContent(): string | undefined {
  if (typeof document === 'undefined') return undefined
  const main = document.getElementById('main')
  if (!main) return undefined
  // innerText (not textContent) ≈ what's actually visible: it respects hidden
  // elements and line breaks, so the model sees the page roughly as the attorney does.
  const text = (main.innerText ?? '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!text) return undefined
  return text.length > MAX_PAGE_CONTENT_CHARS
    ? `${text.slice(0, MAX_PAGE_CONTENT_CHARS).trimEnd()} …[truncated]`
    : text
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

// The model's reasoning/process for a turn, behind a collapsed disclosure (BUILDER-
// REASONING-CHANNEL-1). The reply channel stays clean — process narration and internal
// vocab live here, revealed only when the attorney chooses to expand (the Claude
// pattern: clean by default, transparent on demand). Reasoning is plain summarized text
// (not markdown/machinery), so it's rendered verbatim, not through renderMarkdown.
function ReasoningDisclosure({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="uac-reasoning">
      <button
        type="button"
        className="uac-reasoning-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        <GemSparkle size={12} secondary={false} />
        <span>Thinking</span>
      </button>
      {open && <div className="uac-reasoning-body">{reasoning}</div>}
    </div>
  )
}

// Hover affordance on an assistant reply: copy its text to the clipboard. Copies
// the raw markdown (what the attorney would paste into a doc/email), not the
// rendered HTML. Flips to a check for ~1.5s on success; silently no-ops if the
// clipboard is unavailable (insecure context / permission denied).
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked — leave the icon as-is rather than faking success.
    }
  }
  return (
    <button
      type="button"
      className={`uac-reply-btn${copied ? ' copied' : ''}`}
      onClick={copy}
      aria-label={copied ? 'Copied' : 'Copy message'}
      title={copied ? 'Copied' : 'Copy'}
    >
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />} Copy
    </button>
  )
}

// Smooth a bursty token stream into a steady, word-by-word reveal. The network
// delivers the reply in uneven chunks — often a whole phrase in one flush through
// the serverless proxy — so painting each chunk as it lands looks jerky/choppy
// (beta: "streaming feels jerky, prefer the words come in a little slower and
// smoother"). Instead we hold the full received text as a target and reveal it a
// little each animation frame, easing out as we catch up, snapped to word
// boundaries so words appear whole rather than mid-token. Cadence is decoupled
// from the network; once caught up it idles until more text arrives.
function revealedSlice(target: string, shown: number): string {
  if (shown >= target.length) return target
  // Don't reveal a partial word — back up to the last whitespace we've reached.
  const boundary = Math.max(target.lastIndexOf(' ', shown), target.lastIndexOf('\n', shown))
  return boundary > 0 ? target.slice(0, boundary) : ''
}

function useSmoothReveal(target: string): string {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    let raf = 0
    let active = true
    const tick = () => {
      if (!active) return
      setShown((cur) => {
        if (cur >= target.length) return cur
        const backlog = target.length - cur
        // Ease-out: faster when far behind, gentle near the end; never crawls.
        return cur + Math.min(backlog, Math.max(3, Math.ceil(backlog / 6)))
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      active = false
      cancelAnimationFrame(raf)
    }
  }, [target])
  return revealedSlice(target, Math.min(shown, target.length))
}

// Wrap the STAGE-DIRECTION half of a hidden driver message (priming, approve
// continuation, wrap-up) in the machinery sentinel (1.1 WP3). The model reads these
// hidden user turns and ACTS on them, but used to echo the instruction verbatim into
// its reply ("do NOT start another step…", "close with 'Let me know how else I can
// help!'"). Wrapping the directive marks it as internal — the prompt tells the model
// never to reproduce ⟦…⟧ text, and stripMachinery removes any verbatim echo from render.
function driver(instruction: string): string {
  return `⟦${instruction}⟧`
}

// The in-flight assistant reply, revealed smoothly. Lives only while streaming
// (its parent unmounts it at onDone, which then renders the full committed turn),
// so the rAF loop is bounded to the stream's lifetime.
function StreamingMarkdown({ text }: { text: string }) {
  // Strip internal machinery (⟦…⟧ notes, legacy tool-call annotations) BEFORE reveal
  // so a leaked marker never flashes token-by-token (1.1 render guarantee).
  const shown = useSmoothReveal(stripMachinery(text))
  return (
    <div
      className="assistant-md"
      dangerouslySetInnerHTML={{
        __html: renderMarkdown(shown) + '<span class="uac-caret"></span>',
      }}
    />
  )
}

// A document the assistant produced this turn — rendered as a distinct card (so
// it reads as a deliverable, not a chat bubble) with the document preview and the
// download/save actions. This is where downloads live now: on a real produced
// document, never on every reply.
function DocumentCard({ doc, matterEntityId }: { doc: ProducedDoc; matterEntityId?: string }) {
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [expanded, setExpanded] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const filename = slugifyTitle(doc.title)
  async function save() {
    if (!matterEntityId) return
    setSaveState('saving')
    try {
      await callAttorneyMcp({
        toolName: 'legal.assistant.save_reply',
        input: {
          matterEntityId,
          markdown: doc.markdown,
          documentKind: filename.replace(/-/g, '_'),
        },
      })
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setSaveState('idle'), 2200)
  }
  return (
    <div className="uac-doc-card">
      <div className="uac-doc-head">
        <span className="uac-doc-title">
          <FileTextIcon size={14} /> {doc.title}
        </span>
        <button
          type="button"
          className="uac-doc-toggle"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Collapse the document' : 'Show the document'}
        >
          {expanded ? 'Hide' : 'Show'}
        </button>
      </div>
      {expanded && (
        <div
          className="uac-doc-body assistant-md"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.markdown) }}
        />
      )}
      <div className="uac-doc-actions">
        <button
          type="button"
          className="uac-reply-btn"
          onClick={() => downloadAsPdf(doc.markdown, doc.title)}
          title="Download as PDF"
        >
          <FileTextIcon size={12} /> PDF
        </button>
        <button
          type="button"
          className="uac-reply-btn"
          onClick={() => downloadAsWord(doc.markdown, filename)}
          title="Download as Word"
        >
          <FileTextIcon size={12} /> Word
        </button>
        <CopyButton text={doc.markdown} />
        {matterEntityId && (
          <button
            type="button"
            className={`uac-reply-btn${saveState === 'saved' ? ' copied' : ''}`}
            onClick={save}
            disabled={saveState === 'saving'}
            title="Save this document to the matter's drafts (for review)"
          >
            {saveState === 'saved' ? <CheckIcon size={12} /> : <FileTextIcon size={12} />}{' '}
            {saveState === 'saving'
              ? 'Saving…'
              : saveState === 'saved'
                ? 'Saved'
                : saveState === 'error'
                  ? 'Failed'
                  : 'Save to matter'}
          </button>
        )}
      </div>
    </div>
  )
}

export function UnifiedAssistantChat({
  matterEntityId,
  contactEntityId,
  loadThread = false,
  intro,
  placeholder = 'Ask a question, request a draft, or share feedback…',
  initialInput,
  onClose,
}: UnifiedAssistantChatProps) {
  const router = useRouter()
  const [models, setModels] = useState<AssistantModel[] | null>(null)
  const [modelId, setModelId] = useState<string>('')
  // Whether the guided service-build wizard is enabled for this deployment (server
  // flag LEGAL_BUILD_WIZARD, delivered on the models response). Gates the "Build a
  // service" composer control + the build-mode banner; off ⇒ neither exists, so the
  // chatbot is byte-for-byte unchanged.
  const [buildWizard, setBuildWizard] = useState(false)
  // BUILD MODE: the attorney clicked "Build a service" — the dock shows the comp's
  // progress strip and the next send primes the guided interview. Cleared by New
  // chat / leaving the mode.
  const [buildMode, setBuildMode] = useState(false)
  // WP-L: which wizard artifacts have been APPROVED in this build — drives the
  // progress strip's phase label, "Step n of 6" and gradient segments. A Set in
  // state (not a ref) because the strip must re-render on approval.
  const [approvedPhases, setApprovedPhases] = useState<Set<string>>(new Set())
  // WP-L: the guided "Create a new matter" chip flow (local — see MatterFlow).
  const [matterFlow, setMatterFlow] = useState<MatterFlow | null>(null)
  // Typed answer for the matter flow's free-text steps (name/email).
  const [matterFlowText, setMatterFlowText] = useState('')
  // WP-L "Insert a template": the picker's template list (fetched on open).
  const [templatePicker, setTemplatePicker] = useState<{
    open: boolean
    templates: TemplateOpt[] | null
  }>({ open: false, templates: null })
  // WP-L: the comp's model pill menu (composer bottom-right).
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  // WP-L: the general-scope "Draft a document" matter picker (chips of matters).
  const [draftPicker, setDraftPicker] = useState<{
    matters: Array<{ matterEntityId: string; matterNumber?: string; serviceLabel?: string }> | null
  } | null>(null)
  const [turns, setTurns] = useState<DisplayTurn[]>([])
  // Seed the composer from initialInput on first render (a primed launcher). The
  // attorney still presses Send; we never auto-submit a primed prompt.
  const [input, setInput] = useState(initialInput ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The in-flight assistant reply, streamed token-by-token. `skills` holds any
  // specialized playbooks the model loaded for this turn (shown as "using …").
  const [streaming, setStreaming] = useState<{
    thinking: string
    text: string
    // The model is drafting a tool input (a document body / questionnaire) — show a
    // live "drafting" animation during the otherwise-silent generation.
    drafting: boolean
    skills: { slug: string; name: string }[]
    documents: ProducedDoc[]
    workflowProposals: WorkflowProposal[]
    serviceProposals: ServiceProposal[]
    questionnaireProposals: QuestionnaireProposal[]
    templateProposals: TemplateProposal[]
    costProposals: CostProposal[]
    enableProposals: EnableProposal[]
    buildQuestions: BuildQuestionEvent[]
    kindProposals: KindProposal[]
    notices: TurnNotice[]
  } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  // Bumped whenever the conversation is superseded (a new send, or switching to a
  // prior thread). In-flight stream/load callbacks compare against it and no-op
  // when stale, so an old reply can never land in a newly-opened thread.
  const genRef = useRef(0)
  // Everything needed to re-fire the last FAILED send verbatim ("Try again"):
  // the exact outgoing text (batch answers already folded in), whether it was a
  // hidden continuation, the forced model, and the attachments (which were
  // cleared from the composer when the original send left). Set only on final
  // failure; cleared on success and on thread switch / new chat.
  const retryRef = useRef<{
    message: string
    hidden: boolean
    model?: string
    attachments: { name: string; text: string }[]
  } | null>(null)
  // WP-D2: the saved conversation (assistant_chat_session) the current general
  // chat appends to. Set from `done` on the first turn; resent per turn; cleared
  // by New chat / thread switches. Build turns use buildSessionIdRef instead.
  const chatSessionIdRef = useRef<string | null>(null)
  // WP-D1: persisted settings are applied once on mount; saves only start after
  // that (so the defaults never clobber the stored payload on first render).
  const settingsLoadedRef = useRef(false)
  // The model to restore when the research toggle turns back off.
  const prevModelRef = useRef<string>('')

  // /skills picker — the firm's legal playbooks the attorney can force-load.
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalogItem[] | null>(null)
  const [selectedSkills, setSelectedSkills] = useState<{ slug: string; name: string }[]>([])
  const [skillMenuOpen, setSkillMenuOpen] = useState(false)
  const [skillQuery, setSkillQuery] = useState('')

  // Toolbar panels + settings.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [feedbackMode, setFeedbackMode] = useState(false)
  // The working model to restore when leaving feedback mode — feedback always
  // runs on the cheapest available Claude model (founder rule: triage threads,
  // not legal work).
  const fbPrevModelRef = useRef<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null)
  const [workRate, setWorkRate] = useState<WorkRate>('balanced')
  const [webSearch, setWebSearch] = useState(false)
  // Research mode (WP-D1): route questions to the connected research provider
  // (Perplexity). Activation-gated: disabled unless a research model is
  // connected per Contract A.
  const [research, setResearch] = useState(false)
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[] | null>(null)
  // WP-5 — the attorney's guided builds, each its own titled thread.
  const [buildSessions, setBuildSessions] = useState<BuildSessionSummary[] | null>(null)
  // WP-H2: an editor launch the assistant resolved this turn — renders the real
  // Config*Modal pre-loaded on the existing artifact. Cleared on close.
  const [editorLaunch, setEditorLaunch] = useState<EditorLaunchEvent | null>(null)
  // Secure mode: a lock the attorney sets before pasting sensitive matter/client
  // info — forces web search OFF for the turn so that context can't be put into an
  // outbound search (beta ask). Stays on until toggled off.
  const [secureMode, setSecureMode] = useState(false)
  const [useContext, setUseContext] = useState(true)
  const [contextDepth, setContextDepth] = useState<ContextDepth>('balanced')
  // The unified context control (toolbar). Derives from depth + secureMode; setting
  // a level updates both. Full ⇒ generous depth; Secure ⇒ generous depth + locked.
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const contextLevel = depthToLevel(contextDepth, secureMode)
  const setContextLevel = useCallback((level: ContextLevel) => {
    if (level === 'secure') {
      setSecureMode(true)
      setContextDepth('generous')
    } else {
      setSecureMode(false)
      setContextDepth(level === 'full' ? 'generous' : level)
    }
    setContextMenuOpen(false)
  }, [])

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
        const r = await callAttorneyMcp<{ models: AssistantModel[]; buildWizard?: boolean }>({
          toolName: 'legal.assistant.models',
        })
        if (cancelled) return
        setModels(r.models)
        setBuildWizard(r.buildWizard === true)
        // WP-D1: per-attorney settings persisted through core win over the
        // localStorage nicety; both lose to an explicit in-session pick.
        interface PersistedSettings {
          modelId?: string
          workRate?: WorkRate
          webSearch?: boolean
          research?: boolean
          contextDepth?: ContextDepth
        }
        let persisted: PersistedSettings | null = null
        try {
          const sr = await callAttorneyMcp<{ settings: PersistedSettings | null }>({
            toolName: 'legal.assistant.settings_get',
          })
          persisted = sr.settings
        } catch {
          // No persisted settings (or the read failed) — defaults apply.
        }
        if (cancelled) return
        if (persisted) {
          if (persisted.workRate) setWorkRate(persisted.workRate)
          if (typeof persisted.webSearch === 'boolean') setWebSearch(persisted.webSearch)
          if (typeof persisted.research === 'boolean') setResearch(persisted.research)
          if (persisted.contextDepth) setContextDepth(persisted.contextDepth)
        }
        setModelId((prev) => {
          if (prev) return prev
          const fromSettings = persisted?.modelId
          if (
            fromSettings &&
            r.models.some((m) => m.id === fromSettings && m.available && m.connected)
          ) {
            return fromSettings
          }
          const stored = readStoredModelId()
          if (stored && r.models.some((m) => m.id === stored && m.available && m.connected)) {
            return stored
          }
          return pickDefault(r.models) || ''
        })
        settingsLoadedRef.current = true
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

  // WP-D1: persist the assistant settings through core whenever a knob changes
  // (debounced; whole-payload supersession server-side). Saves only start after
  // the persisted payload was applied on mount.
  useEffect(() => {
    if (!settingsLoadedRef.current) return
    const t = setTimeout(() => {
      void callAttorneyMcp({
        toolName: 'legal.assistant.settings_set',
        input: {
          settings: {
            modelId: modelId || undefined,
            workRate,
            webSearch,
            research,
            contextDepth,
          },
        },
      }).catch(() => {
        // Non-fatal: settings still apply for this session.
      })
    }, 800)
    return () => clearTimeout(t)
  }, [modelId, workRate, webSearch, research, contextDepth])

  // Research mode (WP-D1): ON routes the chat to the connected research model
  // (Perplexity); OFF restores the previous model. Activation-gated: the toggle
  // is disabled when no research provider is connected per Contract A.
  const researchModel =
    models?.find((m) => m.provider === 'perplexity' && m.available && m.connected) ?? null
  function toggleResearch() {
    if (!research) {
      if (!researchModel) return
      prevModelRef.current = modelId
      setModelId(researchModel.id)
      setResearch(true)
    } else {
      setResearch(false)
      const prev = prevModelRef.current
      if (prev && models?.some((m) => m.id === prev && m.available && m.connected)) {
        setModelId(prev)
      } else if (models) {
        const d = pickDefault(models)
        if (d) setModelId(d)
      }
    }
  }

  // WP-H1 → BUILDER-UX-1 WP-4: the attorney hand-edited a proposed artifact in
  // the pop-up editor — record it (service_build.artifact_edited) on the build
  // session so the trail reads proposal → edit → approval. The artifact type is
  // inferred from the note's leading word (each card prefixes it), and the
  // service under construction rides along when known.
  const handleProposalEdited = useCallback((note: string) => {
    const first = note.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? ''
    const artifactType = (
      ['service', 'questionnaire', 'template', 'workflow', 'billing'] as const
    ).find((t) => first.startsWith(t))
    void callAttorneyMcp({
      toolName: 'legal.assistant.build_artifact_edited',
      input: {
        note,
        ...(artifactType ? { artifactType } : {}),
        ...(buildServiceKeyRef.current ? { serviceKey: buildServiceKeyRef.current } : {}),
        ...(buildSessionIdRef.current ? { buildSessionId: buildSessionIdRef.current } : {}),
      },
    }).catch(() => {
      // Best-effort audit note — never blocks the edit itself.
    })
  }, [])

  // Load the persisted thread for a scope into the chat. The history picker calls
  // this with a different scope to reopen another conversation.
  const loadHistory = useCallback(
    async (target: {
      matterEntityId?: string
      contactEntityId?: string
      chatSessionId?: string
    }) => {
      const gen = genRef.current
      try {
        const r = await callAttorneyMcp<{ turns: ThreadTurn[] }>({
          toolName: 'legal.assistant.thread',
          input: target,
        })
        if (genRef.current !== gen) return // a newer send/selection superseded this load
        const display: DisplayTurn[] = r.turns.map((t) =>
          t.role === 'user'
            ? {
                role: 'user' as const,
                content: t.message,
                attachments: t.attachmentNames,
                // Item 9 (UI-BUILDER-FIX-1): a PERSISTED hidden driver turn (auto-
                // continuation, revise payload, stage direction) is orchestration,
                // not attorney prose — on reload it must stay hidden exactly like
                // it was live. Structural test: an attorney never types the ⟦
                // machinery sentinel, so its presence marks the whole turn hidden.
                // The persisted flag (WP-D6) is authoritative; the sentinel
                // sniff keeps pre-flag history hidden too.
                hiddenFromUi:
                  t.syntheticDriver === true || (t.message ?? '').includes(MACHINERY_OPEN),
              }
            : {
                role: 'assistant',
                content: t.reply,
                reasoning: t.reasoning,
                citations: t.citations,
                model: t.model,
                documents: t.documents,
                workflowProposals: t.workflowProposals,
                serviceProposals: t.serviceProposals,
                questionnaireProposals: t.questionnaireProposals,
                templateProposals: t.templateProposals,
                costProposals: t.costProposals,
                enableProposals: t.enableProposals,
                kindProposals: t.kindProposals,
              },
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
    chatSessionIdRef.current = null // a legacy scope thread is not a saved conversation
    setTurns([])
    continuedRef.current.clear() // fresh thread ⇒ forget which approvals already auto-continued
    setBuildMode(false) // a different thread is not the in-progress build
    setApprovedPhases(new Set())
    setMatterFlow(null)
    setMatterFlowText('')
    setDraftPicker(null)
    closeBuildSession('abandoned') // Phase 5: leaving the build closes its session
    setStreaming(null)
    setError(null)
    retryRef.current = null // a superseded exchange can't be retried into the new one
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
      // WP-D2: saved conversations (assistant_chat_session) list alongside the
      // legacy per-scope threads.
      setChatSessions(null)
      callAttorneyMcp<{ sessions: ChatSessionSummary[] }>({
        toolName: 'legal.assistant.chat_sessions',
      })
        .then((r) => setChatSessions(r.sessions))
        .catch(() => setChatSessions([]))
      // WP-5: guided builds list as their own titled threads.
      setBuildSessions(null)
      callAttorneyMcp<{ sessions: BuildSessionSummary[] }>({
        toolName: 'legal.assistant.build_sessions',
      })
        .then((r) => setBuildSessions(r.sessions))
        .catch(() => setBuildSessions([]))
    }
  }

  // WP-5: open a guided build as a READ-ONLY thread — load its transcript and
  // show it; a build's history is a record, not a live chat to resume (a new
  // message starts a fresh conversation).
  function selectBuildSession(sess: BuildSessionSummary) {
    genRef.current++
    setHistoryOpen(false)
    setActiveScope({})
    chatSessionIdRef.current = null
    setBuildMode(false)
    setApprovedPhases(new Set())
    setMatterFlow(null)
    setMatterFlowText('')
    setDraftPicker(null)
    closeBuildSession('abandoned')
    setStreaming(null)
    setError(null)
    retryRef.current = null
    setInput('')
    setBusy(false)
    setTurns([])
    const gen = genRef.current
    void callAttorneyMcp<{ turns: Array<{ role: 'user' | 'assistant'; content: string }> }>({
      toolName: 'legal.assistant.build_thread',
      input: { buildSessionId: sess.buildSessionId },
    })
      .then((r) => {
        if (genRef.current !== gen) return
        setTurns(
          r.turns.map((t) =>
            t.role === 'user'
              ? { role: 'user' as const, content: t.content }
              : { role: 'assistant' as const, content: t.content },
          ),
        )
      })
      .catch(() => {
        if (genRef.current === gen) setError('Could not load that build.')
      })
    setTimeout(() => composerRef.current?.focus(), 0)
  }

  // Reopen a SAVED conversation (WP-D2): re-ground scope from the session, load
  // its turns by session id, and resume appending to it if it is still open (a
  // closed conversation reads back; a new message starts a fresh session).
  function selectSession(sess: ChatSessionSummary) {
    genRef.current++
    setHistoryOpen(false)
    const target =
      sess.scope === 'matter' && sess.scopeEntityId
        ? { matterEntityId: sess.scopeEntityId }
        : sess.scope === 'contact' && sess.scopeEntityId
          ? { contactEntityId: sess.scopeEntityId }
          : {}
    setActiveScope(target)
    chatSessionIdRef.current = sess.status === 'open' ? sess.chatSessionId : null
    setTurns([])
    continuedRef.current.clear()
    setBuildMode(false)
    setApprovedPhases(new Set())
    setMatterFlow(null)
    setMatterFlowText('')
    setDraftPicker(null)
    closeBuildSession('abandoned')
    setStreaming(null)
    setError(null)
    retryRef.current = null
    setInput('')
    setBusy(false)
    setUseContext(true)
    void loadHistory({ chatSessionId: sess.chatSessionId })
    setTimeout(() => composerRef.current?.focus(), 0)
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
    setEditorLaunch(null)
    chatSessionIdRef.current = null // WP-D2: a new chat is a new saved conversation
    setTurns([])
    continuedRef.current.clear() // new conversation ⇒ forget which approvals already auto-continued
    buildServiceKeyRef.current = null // …and which service was under construction
    pendingContinuationRef.current = null // a queued continuation dies with its conversation
    setBuildMode(false) // a fresh chat is not in build mode until the attorney re-enters it
    setApprovedPhases(new Set())
    setMatterFlow(null)
    setMatterFlowText('')
    setDraftPicker(null)
    setTemplatePicker({ open: false, templates: null })
    setModelMenuOpen(false)
    closeBuildSession('abandoned') // Phase 5: a new chat never continues the old build session
    setStreaming(null)
    setError(null)
    retryRef.current = null // a superseded exchange can't be retried into the new one
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

  // Phase 7 fix #1: BUILD MODE. The attorney clicks "Build a service" → we drop a light
  // visual cue (the build-mode banner) AND kick off the guided interview right away, so
  // they don't have to type a magic phrase. We send a HIDDEN priming message that
  // force-loads the firm-admin.build-service playbook and tells the orchestrator to open
  // the interview (ask_build_question), so the FIRST thing the attorney sees is a
  // question card, not a blank composer. Only available when the wizard flag is on.
  function enterBuildMode() {
    if (!buildWizard || busy || !modelId) return
    setBuildMode(true)
    setApprovedPhases(new Set()) // fresh build ⇒ the strip starts at phase 1
    setMatterFlow(null)
    setMatterFlowText('')
    setDraftPicker(null)
    setSettingsOpen(false)
    setHistoryOpen(false)
    setFeedbackMode(false)
    setSkillMenuOpen(false)
    // The guided build is the most complex thing the assistant does (multi-step
    // interview + tool contracts + legal drafting) and runs INFREQUENTLY, so use the
    // STRONGEST model available — Opus — regardless of the picker's current selection;
    // the quality is worth far more than the token cost on this path. Fall back to the
    // recommended model (Sonnet), then any work-rate-capable Claude model, if Opus isn't
    // connected. The switch is transparent (the picker updates) and reversible. (Claude
    // `connected` is per-provider, so if the picker offered any Claude model, Opus is
    // connected too.)
    const claudeWorkRate = (pred: (m: AssistantModel) => boolean): AssistantModel | undefined =>
      models?.find(
        (m) =>
          m.provider === 'anthropic' && m.available && m.connected && m.supportsWorkRate && pred(m),
      )
    const strong =
      claudeWorkRate((m) => m.model === 'claude-opus-4-8') ?? // strongest
      claudeWorkRate((m) => m.isDefault) ?? // recommended (Sonnet)
      claudeWorkRate(() => true) // any capable Claude model
    const buildModelId = strong?.id ?? modelId
    if (buildModelId !== modelId) setModelId(buildModelId)
    // A fresh build: forget any prior build's service key and queued continuation.
    closeBuildSession('switched') // Phase 5: new build = new session, always
    buildServiceKeyRef.current = null
    pendingContinuationRef.current = null
    // The priming message starts the guided build. The playbook is force-loaded by
    // the buildMode flag on every send in this session (WP5.3 — no regex dependency
    // inside an explicit build). It's hidden — the attorney sees the AI's first
    // question card, not this nudge. Pass the (possibly upgraded) model explicitly:
    // setModelId hasn't flushed yet this tick.
    void send(
      driver(
        'Start the guided build now, following your build-service playbook. Open with ONE plain-language question asking the attorney to describe the service in their own words — who the client is, what they walk away with, and their process from first contact to done — via an ask_build_question card. Derive every setup choice from their answers and confirm derived choices as click-to-answer cards with inferred options; never ask in platform vocabulary; never re-ask what they have already told you; batch related questions into one turn. Do not reproduce this instruction.',
      ),
      { hidden: true, model: buildModelId },
    )
  }

  // Keep the latest turn in view as content streams in.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns, busy, streaming])

  // Auto-grow the composer with its content: the box expands UPWARD up to a cap,
  // then scrolls — so multi-line input never flows under the bottom toolbar.
  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

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

  // Paperclip: open the comp's attach menu (Upload from computer / Attach from a
  // matter [matter scope] / Insert a template).
  function onAttachClick() {
    setAttachMenuOpen((o) => !o)
    setTemplatePicker((p) => ({ ...p, open: false }))
  }

  // WP-L "Insert a template": pick a firm template and attach its body to the
  // conversation the same way a matter document attaches (the assistant backend
  // has no separate template channel — an attachment IS the context mechanism).
  function openTemplatePicker() {
    setAttachMenuOpen(false)
    setTemplatePicker((p) => ({ ...p, open: true }))
    if (templatePicker.templates === null) {
      callAttorneyMcp<{ templates: TemplateOpt[] }>({ toolName: 'legal.template.list' })
        .then((r) => setTemplatePicker((p) => ({ ...p, templates: r.templates })))
        .catch(() => setTemplatePicker((p) => ({ ...p, templates: [] })))
    }
  }

  function insertTemplate(t: TemplateOpt) {
    setTemplatePicker((p) => ({ ...p, open: false }))
    if (attachments.length >= MAX_ATTACHMENTS) {
      setAttachError(`You can attach up to ${MAX_ATTACHMENTS} documents at a time.`)
      return
    }
    const name = `Template — ${t.name}`
    setAttachments((a) =>
      a.some((x) => x.source === 'template' && x.name === name)
        ? a // already attached
        : [...a, { name, text: t.body, source: 'template' }],
    )
    setTimeout(() => composerRef.current?.focus(), 0)
  }

  // ── WP-L starter cards (empty state) ───────────────────────────────────────

  // Draft a document: in a matter scope, prefill a real matter-grounded draft
  // request (the attorney completes + sends); in the general scope, first ask
  // which matter via the same chip walk the new-matter flow uses.
  const DRAFT_PROMPT = 'Draft a document for this matter: '
  function startDraftFlow() {
    if (activeScope.matterEntityId) {
      setInput(DRAFT_PROMPT)
      setTimeout(() => composerRef.current?.focus(), 0)
      return
    }
    // General scope: pick the matter first (real matters via legal.matter.list),
    // then re-ground the chat on it and prefill the draft prompt.
    setMatterFlow(null)
    setDraftPicker({ matters: null })
    void callAttorneyMcp<{
      matters: Array<{ matterEntityId: string; matterNumber?: string; serviceLabel?: string }>
    }>({ toolName: 'legal.matter.list' })
      .then((r) => setDraftPicker({ matters: r.matters.slice(0, 8) }))
      .catch(() => setDraftPicker({ matters: [] }))
  }

  function pickDraftMatter(m: { matterEntityId: string; matterNumber?: string }) {
    setDraftPicker(null)
    // Re-ground the conversation on the chosen matter (loads its thread, same as
    // the history picker), then prefill the draft prompt for the attorney to send.
    selectThread({ matterEntityId: m.matterEntityId })
    setInput(DRAFT_PROMPT)
  }

  // Summarize this matter (matter scope only): a REAL grounded send, immediately.
  function startSummarize() {
    if (!activeScope.matterEntityId || busy) return
    void send('Summarize this matter — key facts, current status, and next steps.')
  }

  // Create a new matter: the guided chip walk (see MatterFlow above).
  function startMatterFlow() {
    setDraftPicker(null)
    setMatterFlow({ step: 'service', services: null })
    callAttorneyMcp<{ services: ServiceOpt[] }>({ toolName: 'legal.service.list' })
      .then((r) => {
        // Booking honesty (same filter as NewMatterModal): a service with no active
        // workflow cannot open matters — don't offer it.
        const openable = r.services.filter((s) => s.bookable !== false)
        setMatterFlow((f) => (f && f.step === 'service' ? { ...f, services: openable } : f))
      })
      .catch((e) =>
        setMatterFlow((f) =>
          f ? { ...f, step: 'error', error: e instanceof Error ? e.message : String(e) } : f,
        ),
      )
  }

  function matterFlowPickService(s: ServiceOpt) {
    setMatterFlowText('')
    setMatterFlow((f) =>
      f ? { ...f, step: 'name', serviceKey: s.serviceKey, serviceName: s.displayName } : f,
    )
  }

  function matterFlowSubmitText() {
    const v = matterFlowText.trim()
    if (!v || !matterFlow) return
    if (matterFlow.step === 'name') {
      setMatterFlowText('')
      setMatterFlow({ ...matterFlow, step: 'email', clientFullName: v })
      return
    }
    if (matterFlow.step === 'email') {
      // Light shape check so legal.matter.open doesn't reject a typo'd email.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        setMatterFlow({ ...matterFlow, error: 'That doesn’t look like an email — try again.' })
        return
      }
      const flow = { ...matterFlow, step: 'creating' as const, clientEmail: v, error: undefined }
      setMatterFlowText('')
      setMatterFlow(flow)
      void callAttorneyMcp<{ matterEntityId: string }>({
        toolName: 'legal.matter.open',
        input: {
          serviceKey: flow.serviceKey,
          clientFullName: flow.clientFullName,
          clientEmail: v,
        },
      })
        .then((r) =>
          setMatterFlow((cur) =>
            cur ? { ...cur, step: 'done', matterEntityId: r.matterEntityId } : cur,
          ),
        )
        .catch((e) =>
          setMatterFlow((cur) =>
            cur
              ? {
                  ...cur,
                  step: 'email',
                  error: e instanceof Error ? e.message : String(e),
                }
              : cur,
          ),
        )
    }
  }

  // `overrideMessage` drives an AUTO-CONTINUATION turn (Build-Wizard Phase 6+7): the
  // guided build sends a short nudge on the attorney's behalf after each approval OR
  // question answer, so the AI proceeds to the next step without the attorney having to
  // prompt it. When set, `send` uses it verbatim (not the input box) and never touches
  // the input/attachments. An ordinary send passes nothing and reads the input box as
  // before — so flag-off / non-wizard behaviour is unchanged.
  //
  // `opts.hidden` (Phase 7 fix #4): the model still RECEIVES the message as its latest
  // user turn, but we do NOT render a user bubble for it — so approval/answer
  // continuations no longer show a fake "✓ created — continue…" user message (founder
  // flagged that as bad UX). The thinking indicator still shows because streaming state
  // is set immediately below, so a hidden continuation isn't a silent gap (fix #5).
  // The model-facing record of a card-heavy assistant turn now lives in
  // lib/buildHistoryContent (WP4.1): each proposal's actual substance is replayed
  // (keys, tokens, field ids, workflow steps), not a flattened count.

  async function send(
    overrideMessage?: string,
    opts?: {
      hidden?: boolean
      model?: string
      // Re-fire of a failed send: don't append a new user bubble — the failed one
      // is already in `turns`; clear its failed flag and re-send with the same
      // attachments (passed here, since the composer's were cleared long ago).
      retry?: boolean
      attachments?: { name: string; text: string }[]
    },
  ) {
    const isContinuation = typeof overrideMessage === 'string'
    const isRetry = opts?.retry === true
    const hidden = isContinuation && opts?.hidden === true
    const message = isContinuation ? overrideMessage.trim() : input.trim()
    // A caller may force the model for this turn (build mode upgrades Haiku → the
    // recommended Claude model). Default to the picker's selection. Needed because
    // setModelId() won't have flushed by the time enterBuildMode fires its priming send.
    const turnModelId = opts?.model ?? modelId
    if (!message || busy || !turnModelId) return
    // If the attorney answered SOME cards of a batch then typed a message instead of
    // finishing it, fold the buffered answers into this send — silently dropping them
    // would lose clicks the cards already show as locked answer chips. The bubble
    // shows only what they typed; historyContent carries what the model saw.
    let outgoing = message
    const pendingBatch = batchRef.current
    if (!isContinuation && pendingBatch.answers.size > 0) {
      const partialAnswers = [...pendingBatch.answers.entries()]
        .map(([k, a]) => `"${k}": ${a}`)
        .join('; ')
      outgoing = `My answers so far — ${partialAnswers}.\n\n${message}`
      batchRef.current = { keys: [], answers: new Map() }
    }
    const gen = ++genRef.current // this exchange's generation; stale callbacks no-op
    const live = () => genRef.current === gen
    setError(null)
    setBusy(true)
    setSettingsOpen(false)
    // The model history the server expects: prior user/assistant turns as text.
    // historyContent wins over content (card-only turns have no prose but must not
    // vanish from the model's memory); empty turns are dropped as a backstop — an
    // empty message is invalid at the API and carries no signal. Failed turns are
    // excluded — they were never answered, and re-showing them would present the
    // model the same question twice.
    const fullHistory = turns
      .filter((t) => !t.failed)
      .map((t) => ({ role: t.role, content: (t.historyContent ?? t.content).trim() }))
      .filter((m) => m.content)
    // Cap what we resend: a long conversation otherwise grows the request without
    // bound (every turn re-bills the whole transcript). Trim oldest-first once the
    // transcript passes the budget, but always keep the most recent turns so the
    // model never loses the working context of the current exchange.
    const MAX_HISTORY_CHARS = 100_000
    const MIN_HISTORY_TURNS = 12
    let start = fullHistory.length
    let budget = MAX_HISTORY_CHARS
    for (let i = fullHistory.length - 1; i >= 0; i--) {
      budget -= fullHistory[i]!.content.length
      if (budget < 0 && fullHistory.length - i > MIN_HISTORY_TURNS) break
      start = i
    }
    const history = fullHistory.slice(start)
    // Attachments are per-message and Claude-only; snapshot then clear them. A
    // continuation carries no attachments (it's a system nudge, not a user upload) —
    // except a retry, which re-sends the original turn's attachments verbatim.
    const sentAttachments =
      opts?.attachments ?? (isContinuation ? [] : canAttach ? attachments : [])
    if (isRetry) {
      // The bubble already exists (dimmed as failed) — revive it instead of
      // appending a duplicate. History above was built from the closure value,
      // which still has the flag, so the turn was correctly excluded there and
      // rides again as THIS send's message.
      setTurns((t) => t.map((x) => (x.failed ? { ...x, failed: undefined } : x)))
    } else {
      // A hidden continuation renders NO user bubble, but it MUST still land in
      // `turns`: history is built from `turns`, and a nudge the model never re-sees
      // breaks the guided build — after the next answer the model has no record of
      // the primer or any prior card answer, loses its place, and re-asks earlier
      // questions (the "wizard goes back a step" bug). Persist it flagged hidden.
      setTurns((t) => [
        ...t,
        {
          role: 'user',
          content: message,
          // When buffered batch answers were folded in, the model saw more than the
          // typed bubble — record it so future history matches what was sent.
          historyContent: outgoing !== message ? outgoing : undefined,
          hiddenFromUi: hidden || undefined,
          attachments: sentAttachments.length ? sentAttachments.map((a) => a.name) : undefined,
        },
      ])
    }
    // Only an ordinary send clears the input box / attachments; a continuation must
    // leave whatever the attorney is mid-typing untouched.
    if (!isContinuation) {
      setInput('')
      setAttachments([])
      setAttachMenuOpen(false)
    }

    // Accumulate deltas locally; each handler hands React a fresh object.
    const partial = {
      thinking: '',
      text: '',
      drafting: false,
      skills: [] as { slug: string; name: string }[],
      documents: [] as ProducedDoc[],
      workflowProposals: [] as WorkflowProposal[],
      serviceProposals: [] as ServiceProposal[],
      questionnaireProposals: [] as QuestionnaireProposal[],
      templateProposals: [] as TemplateProposal[],
      costProposals: [] as CostProposal[],
      enableProposals: [] as EnableProposal[],
      buildQuestions: [] as BuildQuestionEvent[],
      kindProposals: [] as KindProposal[],
      notices: [] as TurnNotice[],
    }
    setStreaming({ ...partial })
    let finished = false
    // The failure (if any) of the CURRENT attempt. Transient failures get one
    // silent automatic retry — full conversation context intact, no user action —
    // before surfacing the error with a manual "Try again".
    let errMsg: string | null = null
    const MAX_ATTEMPTS = 2

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      errMsg = null
      finished = false
      if (attempt > 1) {
        // Discard whatever partially streamed on the failed attempt — the retry
        // regenerates the whole reply, so keeping fragments would duplicate text.
        partial.thinking = ''
        partial.text = ''
        partial.drafting = false
        partial.skills = []
        partial.documents = []
        partial.workflowProposals = []
        partial.serviceProposals = []
        partial.questionnaireProposals = []
        partial.templateProposals = []
        partial.costProposals = []
        partial.enableProposals = []
        partial.buildQuestions = []
        partial.kindProposals = []
        partial.notices = []
        setStreaming({ ...partial })
        // Brief pause so a momentary blip (overload spike, dropped socket) has a
        // chance to clear before the re-send.
        await new Promise((r) => setTimeout(r, 750))
        if (!live()) return
      }
      try {
        await streamAssistant(
          {
            message: outgoing,
            modelId: turnModelId,
            history,
            ...scope,
            workRate,
            // Secure mode hard-forces web search off so sensitive context can't be
            // routed into an outbound search, regardless of the web-search setting.
            webSearch: secureMode ? false : webSearch,
            // Only meaningful when scoped; the toggle is hidden otherwise.
            useContext: scoped ? useContext : undefined,
            // Depth only matters when grounded in a matter/client.
            contextDepth: scoped && useContext ? contextDepth : undefined,
            // Attorney-picked skills (Claude only) — force-loaded this turn.
            skillSlugs:
              isClaude && selectedSkills.length ? selectedSkills.map((s) => s.slug) : undefined,
            attachments: sentAttachments.length
              ? sentAttachments.map((a) => ({ name: a.name, text: a.text }))
              : undefined,
            // Path + a live snapshot of what's on screen, so the assistant can
            // answer about the page/matter the attorney is looking at — not just know
            // its route. Page content is Claude-only (the firm's own model); never
            // captured for the external research model.
            pageContext:
              typeof window !== 'undefined'
                ? {
                    path: window.location.pathname,
                    content: isClaude ? capturePageContent() : undefined,
                  }
                : undefined,
            // Explicit build session (WP5.3): force the build-service playbook
            // server-side regardless of how this message is phrased.
            buildMode: buildMode || undefined,
            // The service under construction (WP4.2): the server injects the live
            // BUILD BRIEF for it. Harmless when no build is active (undefined).
            buildServiceKey: buildServiceKeyRef.current ?? undefined,
            // Phase 5: THIS build's session — messages persist to it server-side.
            // Absent on a build's first turn; the server mints one and returns it
            // on `done`. Cleared whenever a build starts/ends/switches services.
            buildSessionId: buildMode ? (buildSessionIdRef.current ?? undefined) : undefined,
            // WP-D2: the saved conversation this general turn continues. Absent
            // on a conversation's first turn; the server mints and returns it.
            chatSessionId: buildMode ? undefined : (chatSessionIdRef.current ?? undefined),
          },
          {
            onThinking: (t) => {
              if (!live()) return
              partial.thinking += t
              setStreaming({ ...partial })
            },
            onDrafting: () => {
              if (!live()) return
              partial.drafting = true
              setStreaming({ ...partial })
            },
            onText: (t) => {
              if (!live()) return
              // Real reply text means the silent drafting phase is over.
              partial.drafting = false
              partial.text += t
              setStreaming({ ...partial })
            },
            onSkill: (s) => {
              if (!live()) return
              if (s.slug && !partial.skills.some((x) => x.slug === s.slug)) partial.skills.push(s)
              setStreaming({ ...partial, skills: [...partial.skills] })
            },
            onNotice: (m, tone) => {
              if (!live()) return
              // A non-fatal warning (e.g. the tool-round cap) — shown on the turn,
              // never treated as a failure (that would trigger a full regenerate).
              // tone 'status' renders muted (a progress line), 'warning' amber.
              if (m) {
                partial.notices.push({ message: m, tone: tone === 'status' ? 'status' : 'warning' })
              }
              setStreaming({ ...partial, notices: [...partial.notices] })
            },
            onDocument: (doc) => {
              if (!live()) return
              if (doc.markdown.trim()) partial.documents.push(doc)
              setStreaming({ ...partial, documents: [...partial.documents] })
            },
            onWorkflowProposal: (p) => {
              if (!live()) return
              if (p.serviceKey && Array.isArray(p.graph) && p.graph.length) {
                const proposal = p as unknown as WorkflowProposal
                // 5c: a proposal that supersedes an earlier one for the same
                // service (a Revise round-trip) carries that graph, so its card
                // diffs revision-vs-live-proposal — unrelated steps must read
                // unchanged. The ref survives across round-trips in this build.
                const prev = lastWorkflowGraphRef.current.get(proposal.serviceKey)
                if (prev) proposal.previousGraph = prev
                lastWorkflowGraphRef.current.set(proposal.serviceKey, proposal.graph)
                partial.workflowProposals.push(proposal)
              }
              setStreaming({ ...partial, workflowProposals: [...partial.workflowProposals] })
            },
            onServiceProposal: (p) => {
              if (!live()) return
              if (p.displayName) partial.serviceProposals.push(p as unknown as ServiceProposal)
              setStreaming({ ...partial, serviceProposals: [...partial.serviceProposals] })
            },
            onQuestionnaireProposal: (p) => {
              if (!live()) return
              if (p.serviceKey && p.schema) {
                partial.questionnaireProposals.push(p as unknown as QuestionnaireProposal)
              }
              setStreaming({
                ...partial,
                questionnaireProposals: [...partial.questionnaireProposals],
              })
            },
            onTemplateProposal: (p) => {
              if (!live()) return
              if (p.serviceKey && p.body && p.docKind) {
                partial.templateProposals.push(p as unknown as TemplateProposal)
              }
              setStreaming({ ...partial, templateProposals: [...partial.templateProposals] })
            },
            onCostProposal: (p) => {
              if (!live()) return
              if (p.serviceKey && p.amount) partial.costProposals.push(p as unknown as CostProposal)
              setStreaming({ ...partial, costProposals: [...partial.costProposals] })
            },
            onEnableProposal: (p) => {
              if (!live()) return
              if (p.serviceKey) partial.enableProposals.push(p as unknown as EnableProposal)
              setStreaming({ ...partial, enableProposals: [...partial.enableProposals] })
            },
            onBuildQuestion: (q) => {
              if (!live()) return
              if (q.question) partial.buildQuestions.push(q)
              setStreaming({ ...partial, buildQuestions: [...partial.buildQuestions] })
            },
            onKindProposal: (p) => {
              if (!live()) return
              if (p.kindName) partial.kindProposals.push(p as unknown as KindProposal)
              setStreaming({ ...partial, kindProposals: [...partial.kindProposals] })
            },
            onEditorLaunch: (l) => {
              if (!live()) return
              // WP-H2: open the real editor pop-up on the resolved artifact.
              setEditorLaunch(l)
            },
            onDone: (d) => {
              if (!live()) return
              finished = true
              // Phase 5: the server minted (or confirmed) this build's session on
              // the turn — resend it on every later turn of the same build.
              if (d.buildSessionId) buildSessionIdRef.current = d.buildSessionId
              // WP-D2: resend the conversation id on every later turn.
              if (d.chatSessionId) chatSessionIdRef.current = d.chatSessionId
              // This turn's cards define the CURRENT answer batch (answers to a
              // multi-card turn buffer and return together; see handleQuestionAnswer).
              batchRef.current = {
                keys: partial.buildQuestions.map((q) => q.key),
                answers: new Map(),
              }
              setTurns((prev) => [
                ...prev,
                {
                  role: 'assistant',
                  content: d.reply,
                  // Relocate the reasoning the "Thinking…" indicator streamed live into
                  // the committed turn's expandable disclosure — not destroyed, moved.
                  reasoning: partial.thinking.trim() || undefined,
                  // notices carry tone objects now — history only counts them.
                  historyContent: assistantHistoryContent(d.reply, {
                    ...partial,
                    notices: partial.notices.map((n) => n.message),
                  }),
                  citations: d.citations,
                  model: d.model,
                  documents: partial.documents.length ? partial.documents : undefined,
                  workflowProposals: partial.workflowProposals.length
                    ? partial.workflowProposals
                    : undefined,
                  serviceProposals: partial.serviceProposals.length
                    ? partial.serviceProposals
                    : undefined,
                  questionnaireProposals: partial.questionnaireProposals.length
                    ? partial.questionnaireProposals
                    : undefined,
                  templateProposals: partial.templateProposals.length
                    ? partial.templateProposals
                    : undefined,
                  costProposals: partial.costProposals.length ? partial.costProposals : undefined,
                  enableProposals: partial.enableProposals.length
                    ? partial.enableProposals
                    : undefined,
                  buildQuestions: partial.buildQuestions.length
                    ? partial.buildQuestions
                    : undefined,
                  kindProposals: partial.kindProposals.length ? partial.kindProposals : undefined,
                  // Status-tone notices are transient progress lines — dropped on
                  // commit. A warning whose text the server also persisted into the
                  // reply (the workflow-exhaust line) is dropped too: the committed
                  // text already says it, and two renders of one line read as a bug.
                  notices: (() => {
                    const kept = partial.notices.filter(
                      (n) => n.tone === 'warning' && !d.reply.includes(n.message),
                    )
                    return kept.length ? kept : undefined
                  })(),
                },
              ])
              setStreaming(null)
            },
            onError: (m) => {
              if (!live()) return
              finished = true
              errMsg = m
            },
          },
        )
      } catch (e) {
        if (!live()) return
        finished = true
        errMsg = e instanceof Error ? e.message : String(e)
      }
      if (!live()) return
      // Snapshot: errMsg is assigned inside stream callbacks, so TS can't narrow
      // the captured `let` across the calls above — read it once here.
      const attemptError: string | null = errMsg
      if (!attemptError) break
      if (attempt < MAX_ATTEMPTS && isTransientAssistantError(attemptError)) continue
      break
    }

    // A newer send or a thread switch superseded this exchange — leave the
    // reopened conversation's state untouched (its reply must not land here).
    if (!live()) return

    // Final failure (auto-retry exhausted or non-transient): keep the attorney's
    // bubble (dimmed), stash everything needed to re-fire it verbatim, and show
    // the error with a one-click "Try again". Nothing about the conversation is
    // lost — the retry re-sends with the full history up to this point.
    const finalError: string | null = errMsg
    if (finalError) {
      retryRef.current = {
        message: outgoing,
        hidden,
        model: turnModelId,
        attachments: sentAttachments.map((a) => ({ name: a.name, text: a.text })),
      }
      setTurns((prev) =>
        prev.map((t, i) =>
          i === prev.length - 1 && t.role === 'user' ? { ...t, failed: true } : t,
        ),
      )
      setError(finalError)
      setStreaming(null)
      setBusy(false)
      // FREEZE FIX (WP li-builder-fix): a continuation queued while THIS turn was
      // mid-stream — e.g. the attorney approved a proposal card as the turn was still
      // streaming — must STILL fire even though the turn ended in error/abort. The
      // drain used to live only on the success path below, so an approval that landed
      // during a turn that then failed was stranded forever: busy is now false, no turn
      // is in flight, and nothing ever advanced the build → permanent freeze. Firing it
      // here starts a fresh turn (which clears this error banner) and advances the build,
      // so an approval ALWAYS moves forward regardless of the concurrent turn's fate.
      const queuedAfterError = pendingContinuationRef.current
      if (queuedAfterError) {
        pendingContinuationRef.current = null
        void send(queuedAfterError, { hidden: true })
      }
      return
    }
    retryRef.current = null

    // Reconcile a stream that ended without a terminal event (e.g. a drop):
    // keep whatever streamed rather than losing it.
    if (
      !finished &&
      (partial.text ||
        partial.thinking ||
        partial.documents.length ||
        partial.workflowProposals.length ||
        partial.serviceProposals.length ||
        partial.questionnaireProposals.length ||
        partial.templateProposals.length ||
        partial.costProposals.length ||
        partial.enableProposals.length ||
        partial.buildQuestions.length ||
        partial.kindProposals.length)
    ) {
      const hasCards =
        partial.documents.length ||
        partial.workflowProposals.length ||
        partial.serviceProposals.length ||
        partial.questionnaireProposals.length ||
        partial.templateProposals.length ||
        partial.costProposals.length ||
        partial.enableProposals.length ||
        partial.buildQuestions.length ||
        partial.kindProposals.length
      // A dropped stream still commits its cards — keep the batch in sync with them.
      batchRef.current = { keys: partial.buildQuestions.map((q) => q.key), answers: new Map() }
      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: partial.text || (hasCards ? '' : '(no response)'),
          historyContent: assistantHistoryContent(partial.text, {
            ...partial,
            notices: partial.notices.map((n) => n.message),
          }),
          model: modelId,
          documents: partial.documents.length ? partial.documents : undefined,
          workflowProposals: partial.workflowProposals.length
            ? partial.workflowProposals
            : undefined,
          serviceProposals: partial.serviceProposals.length ? partial.serviceProposals : undefined,
          questionnaireProposals: partial.questionnaireProposals.length
            ? partial.questionnaireProposals
            : undefined,
          templateProposals: partial.templateProposals.length
            ? partial.templateProposals
            : undefined,
          costProposals: partial.costProposals.length ? partial.costProposals : undefined,
          enableProposals: partial.enableProposals.length ? partial.enableProposals : undefined,
          buildQuestions: partial.buildQuestions.length ? partial.buildQuestions : undefined,
          kindProposals: partial.kindProposals.length ? partial.kindProposals : undefined,
          // Dropped stream: no server reply landed, so warnings keep their box;
          // status-tone progress lines stay transient here too.
          notices: (() => {
            const kept = partial.notices.filter((n) => n.tone === 'warning')
            return kept.length ? kept : undefined
          })(),
        },
      ])
    }
    setStreaming(null)
    setBusy(false)
    // A continuation that arrived while this turn was mid-stream was QUEUED, not
    // dropped (WP5.2 — the silent busy-skip stalled builds right after an approval).
    // Fire it now that the turn is committed.
    const queued = pendingContinuationRef.current
    if (queued) {
      pendingContinuationRef.current = null
      void send(queued, { hidden: true })
    }
  }

  // Re-fire the last failed send exactly as it went out — same text (batch
  // answers folded), same attachments, same model, same hidden-continuation
  // status — with the conversation history rebuilt up to that point. The failed
  // bubble is revived (not duplicated) inside send()'s retry path.
  function retryLastSend() {
    const r = retryRef.current
    if (!r || busy) return
    setError(null)
    void send(r.message, {
      retry: true,
      hidden: r.hidden,
      model: r.model,
      attachments: r.attachments,
    })
  }

  // Tracks approvals we've already auto-continued from, so a re-render of an approved
  // card never fires the continuation twice (the card also disables its own button on
  // success — this is belt-and-suspenders). Keyed by serviceKey+artifact.
  const continuedRef = useRef<Set<string>>(new Set())

  // A continuation that arrived while a turn was mid-stream (WP5.2). The old code
  // dropped it silently ("if (busy) return"), which stalled the build right after an
  // approval; now it queues here and fires when the in-flight turn completes. One
  // slot is enough — approvals are sequential, and the latest continuation wins.
  const pendingContinuationRef = useRef<string | null>(null)

  // FREEZE FIX belt-and-suspenders (WP li-builder-fix): the queued continuation is
  // drained inline on BOTH the success and error/abort paths of send(). This effect is
  // the safety net that covers every OTHER way a turn can end with the flag still set
  // (a superseded !live() return, a future early-return). Whenever the chat settles to
  // idle (busy → false) with a continuation still queued, fire it — an approval must
  // ALWAYS advance the build. sendRef always points at the latest send() so the drain
  // never runs a stale closure whose captured `busy` would no-op the send.
  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  })
  useEffect(() => {
    if (busy || !pendingContinuationRef.current) return
    const queued = pendingContinuationRef.current
    pendingContinuationRef.current = null
    void sendRef.current(queued, { hidden: true })
  }, [busy])

  // The service under construction in the active build — set by the first approval
  // that carries a serviceKey. Sent with every message so the server injects the
  // live BUILD BRIEF (everything already approved + open items) into the model's
  // context (WP4.2). Cleared when a new chat/build starts.
  const buildServiceKeyRef = useRef<string | null>(null)
  // 5c: the last workflow-proposal graph seen per service in THIS conversation —
  // the diff base for a Revise round-trip's superseding proposal.
  const lastWorkflowGraphRef = useRef<Map<string, WorkflowProposal['graph']>>(new Map())
  // Phase 5: THIS build's service_build_session id (server-minted on the build's
  // first turn, resent per turn). New build = new session, ALWAYS: cleared on
  // build start/end/switch; closeBuildSession is fire-and-forget best-effort.
  const buildSessionIdRef = useRef<string | null>(null)
  const closeBuildSession = useCallback((reason: 'completed' | 'switched' | 'abandoned') => {
    const id = buildSessionIdRef.current
    buildSessionIdRef.current = null
    if (!id) return
    void callAttorneyMcp({
      toolName: 'legal.build_session.close',
      input: { buildSessionId: id, reason },
    }).catch(() => {
      /* best-effort: an unclosed session never blocks the next build (which
           always starts fresh); it just reads as open until closed. */
    })
  }, [])

  // The CURRENT question batch (beta feedback: one question per API round-trip made
  // the build crawl). When an assistant turn asks SEVERAL ask_build_question cards,
  // their keys land here; answers buffer locally (each card locks with its chip) and
  // ONE hidden continuation carries them all once the last card is answered. A
  // single-question turn keeps the old immediate-send path. Reset on every assistant
  // commit, so stale cards from older turns fall back to immediate send.
  const batchRef = useRef<{ keys: string[]; answers: Map<string, string> }>({
    keys: [],
    answers: new Map(),
  })

  // The CONTINUOUS-FLOW driver (Build-Wizard Phase 6): a proposal card calls this on a
  // SUCCESSFUL approve. We auto-send a short continuation turn on the attorney's behalf
  // so the AI proceeds to the next step by itself — interview, propose, share the link
  // — never stalling after an approval. The TERMINAL Enable step does NOT continue: the
  // build is complete once the service is live, so we stop the loop there.
  //
  // Phase 7 fix #4: this continuation is HIDDEN — the model receives it as its latest
  // user message, but we render NO user bubble for it (the founder flagged the visible
  // "✓ created — continue…" turn as bad UX). The card itself already shows a "Saved"
  // state + "View …" link, so the inline confirmation lives there, not as a chat bubble.
  // 5c (UI-BUILDER-FIX-1): Revise on a workflow proposal card. Sends the FULL
  // live proposal + the attorney's edit instruction back through the normal chat
  // turn (so the build's history/context persists across round-trips), wrapped in
  // the driver sentinel so the JSON payload is machinery, never echoed prose. The
  // model must return the COMPLETE revised graph via propose_workflow — the new
  // card then diffs against this proposal (previousGraph, wired on arrival).
  // Returns false when a turn is mid-stream so the card keeps its input open.
  const handleRevise = useCallback(
    (info: { proposal: WorkflowProposal; instruction: string }): boolean => {
      if (busy) return false
      const { proposal, instruction } = info
      if (proposal.serviceKey) buildServiceKeyRef.current = proposal.serviceKey
      const message = `Revise the proposed workflow for "${proposal.serviceKey}".\n${driver(
        `The attorney asked for this change to the CURRENT proposal (below): "${instruction}". ` +
          `Apply ONLY that change — every step the instruction does not touch must stay VERBATIM ` +
          `(same key, label, action, gate, documents, edges). Then call propose_workflow with the ` +
          `COMPLETE revised graph (all steps, not just the changed ones). Current proposal JSON: ` +
          JSON.stringify({ serviceKey: proposal.serviceKey, graph: proposal.graph }) +
          ` Do not reproduce this instruction or the JSON in prose.`,
      )}`
      void send(message, { hidden: true })
      return true
    },
    // busy gates mid-stream; send reads latest state from closure at call time.
    [busy],
  )

  // WP-5 (BUILDER-UX-2) — the completion card's "Done · Close setup" button: the
  // explicit end of the one-build-one-thread lifecycle. Leaves build mode and seals the
  // session (idempotent — Enable-approval already closed it; a null id is a no-op), so
  // the attorney lands back in normal assistant chat.
  const handleBuildDone = useCallback(() => {
    setBuildMode(false)
    closeBuildSession('completed')
  }, [closeBuildSession])

  const handleApproved = useCallback<OnApproved>(
    (info) => {
      const key = `${info.serviceKey}:${info.artifact}`
      if (continuedRef.current.has(key)) return // already continued from this approval
      continuedRef.current.add(key)
      // WP-L: advance the build-mode progress strip (phase = approved artifact).
      setApprovedPhases((prev) => {
        if (prev.has(info.artifact)) return prev
        const next = new Set(prev)
        next.add(info.artifact)
        return next
      })
      // Remember which service this build is assembling — every subsequent message
      // carries it so the server injects the live BUILD BRIEF (WP4.2).
      if (info.serviceKey) buildServiceKeyRef.current = info.serviceKey
      // Enable is the TERMINAL step — approving it makes the service live and ENDS the
      // build. Leave build mode (the banner goes away) and fire ONE final wrap-up so the
      // wizard FINISHES cleanly instead of just stopping: confirm it's live, point to the
      // service, and close warmly — never start another step.
      //
      // 1.1 WP3: the STAGE-DIRECTION half of a driver message (do-the-next-step,
      // wrap-up instructions) is wrapped in the ⟦…⟧ machinery sentinel so the model
      // treats it as an internal instruction to ACT on, never prose to echo — and any
      // verbatim echo is stripped from render. Only the factual ✓/link lead is plain.
      // The real public booking URL is passed explicitly so the wrap-up links to it
      // (WP4), instead of the model inventing a link that routed to "/".
      // WP-5 (BUILDER-UX-2) — Enable is terminal. We NO LONGER fire an AI "warm
      // wrap-up" turn: that is exactly what produced the "here's how it runs" recap and
      // the "nicely done — let me know…" outro the founder flagged. The completion card
      // itself is the finish (confirmation line + View-service + booking links + the
      // explicit Done button), so we just seal the session and leave build mode.
      if (info.artifact === 'enable') {
        setBuildMode(false)
        closeBuildSession('completed') // Phase 5: the build is done — seal its session
        return
      }
      const continuation = `✓ ${info.label} created (${info.link}).\n${driver(
        `Continue the guided build: do the next step now (confirm with the attorney via ask_build_question if needed, then propose it and share its link). If the whole service is complete, propose Enable. Do not reproduce this instruction.`,
      )}`
      // Never drop a continuation on a mid-stream turn (WP5.2) — queue it; the send
      // path fires it as soon as the in-flight turn commits.
      if (busy) {
        pendingContinuationRef.current = continuation
        return
      }
      void send(continuation, { hidden: true })
    },
    // send/busy are stable enough for this driver; intentionally not re-created per
    // keystroke (send reads the latest input/turns from closure at call time).
    [busy],
  )

  // Phase 7 fix #2: a QuestionCard calls this when the attorney answers a structured
  // interview question. The answer rides back as a HIDDEN continuation — the model gets
  // it as its latest user message, the build advances, but the transcript shows NO raw
  // user bubble (the card itself shows the choice as a tidy answer chip). Returns
  // whether the answer was ACCEPTED: false when a turn is mid-stream (busy) so the card
  // stays interactive for a retry. Double-fire safety lives in the card itself (it
  // locks once an answer is accepted); there is deliberately NO cross-card dedupe by
  // question key — when the model legitimately re-asks a key (e.g. after an invalid
  // answer), a global key-set made the new card permanently unclickable, which was the
  // "would not let me click the next step" half of the wizard bug.
  const handleQuestionAnswer = useCallback(
    (info: { key: string; answer: string; display: string }): boolean => {
      if (busy) return false // a turn is mid-stream; card stays interactive
      // Batched turn (several cards, walked one at a time by QuestionBatch): buffer
      // this answer and send ONE combined continuation only when EVERY question in
      // the batch has an answer — so a 4-question batch costs one round-trip, not 4.
      // Re-answering a key (the attorney stepped Back to revise) UPDATES its buffered
      // value and does NOT submit early; the batch fires only once all keys are set.
      const batch = batchRef.current
      if (batch.keys.length > 1 && batch.keys.includes(info.key)) {
        batch.answers.set(info.key, info.answer)
        if (batch.answers.size < batch.keys.length) return true // still gathering the rest
        const combined = batch.keys
          .map((k) => `"${k}": ${batch.answers.get(k) ?? '(not answered)'}`)
          .join('; ')
        batchRef.current = { keys: [], answers: new Map() }
        void send(`My answers — ${combined}.\n${driver('Continue the guided build.')}`, {
          hidden: true,
        })
        return true
      }
      void send(
        `My answer to "${info.key}": ${info.answer}.\n${driver('Continue the guided build.')}`,
        {
          hidden: true,
        },
      )
      return true
    },
    [busy],
  )

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

  // Enter feedback mode on the cheapest available Claude model (Haiku),
  // remembering the working model so leaving restores it.
  function enterFeedbackMode() {
    const cheap = models?.find(
      (m) => m.provider === 'anthropic' && m.available && m.connected && /haiku/i.test(m.model),
    )
    if (cheap && cheap.id !== modelId) {
      fbPrevModelRef.current = modelId
      setModelId(cheap.id)
    }
    setFeedbackMode(true)
  }

  // Leave feedback mode. After a submitted thread, start a fresh regular chat;
  // otherwise just drop the banner and keep whatever was said. Either way the
  // pre-feedback model comes back.
  function exitFeedbackMode() {
    const prev = fbPrevModelRef.current
    if (prev) {
      fbPrevModelRef.current = null
      setModelId(prev)
    }
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

  // WP-L: the comp's six-phase progress strip — the first not-yet-approved phase
  // is the one in progress.
  const buildStageIdxRaw = BUILD_PHASES.findIndex((p) => !approvedPhases.has(p.artifact))
  const buildStageIdx = buildStageIdxRaw === -1 ? BUILD_PHASES.length - 1 : buildStageIdxRaw
  // Turns the transcript actually shows (hidden drivers excluded).
  const visibleTurns = turns.filter((t) => !t.hiddenFromUi)
  // The comp's model menu lists only connected, available models.
  const connectedModels = models?.filter((m) => m.available && m.connected) ?? []

  return (
    <div className="uac li-uac">
      {/* ── WP-L header (comp): gemstar + title + model status; settings /
          feedback / history / new / close as translucent icon buttons ───────── */}
      <div className="li-uac-head">
        <div className="li-uac-head-id">
          <GemCluster size={28} />
          <div className="li-uac-head-text">
            <div className="li-uac-head-title">Legal Assistant</div>
            <div className="li-uac-head-status">
              <span className="li-uac-head-dot" aria-hidden="true" />
              <span className="li-uac-head-model">{selected ? selected.label : 'Connecting…'}</span>
              {effectiveWebSearch && (
                <span className="li-uac-head-web" title="Answers cite live web sources">
                  <SearchIcon size={10} /> web
                </span>
              )}
              {scoped && (
                <button
                  type="button"
                  className={`li-uac-scopechip${useContext ? ' on' : ''}`}
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
          </div>
        </div>
        <div className="li-uac-head-btns">
          <button
            type="button"
            className={`li-uac-headbtn${settingsOpen ? ' active' : ''}`}
            onClick={() => {
              setSettingsOpen((o) => !o)
              setHistoryOpen(false)
            }}
            aria-label="Assistant settings"
            title="Settings — work rate, web search, research"
          >
            <SettingsIcon size={16} />
          </button>
          <button
            type="button"
            className={`li-uac-headbtn${feedbackMode ? ' active' : ''}`}
            onClick={() => {
              if (feedbackMode) exitFeedbackMode()
              else enterFeedbackMode()
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
            className={`li-uac-headbtn${historyOpen ? ' active' : ''}`}
            onClick={openHistory}
            aria-label="Chat history"
            aria-expanded={historyOpen}
            aria-haspopup="menu"
            title="History — reopen a prior conversation"
          >
            <ClockIcon size={17} />
          </button>
          <button
            type="button"
            className="li-uac-headbtn"
            onClick={newChat}
            aria-label="New chat"
            title="New chat — clear this conversation"
          >
            <PlusIcon size={17} />
          </button>
          {onClose && (
            <button
              type="button"
              className="li-uac-headbtn"
              onClick={onClose}
              aria-label="Close"
              title="Close"
            >
              <XIcon size={17} />
            </button>
          )}
        </div>
      </div>

      {/* ── History popover (reopen a prior conversation) ─────────────────── */}
      {historyOpen && (
        <div className="uac-popover uac-history">
          {/* WP-5: guided builds, each its own titled thread ("Build: <service>"),
              separate from App help + matter threads. Read-only history. */}
          {buildSessions !== null && buildSessions.length > 0 && (
            <>
              <div className="uac-history-head">Builds</div>
              <ul className="uac-history-list">
                {buildSessions.map((sess) => (
                  <li key={sess.buildSessionId}>
                    <button
                      type="button"
                      className="uac-history-item"
                      onClick={() => selectBuildSession(sess)}
                    >
                      <span className="uac-history-row-top">
                        <span className="uac-history-label">{sess.title}</span>
                        <span
                          className="uac-history-count"
                          title={`${sess.messageCount} ${sess.messageCount === 1 ? 'message' : 'messages'}${sess.status === 'open' ? ' · in progress' : ''}`}
                        >
                          {sess.messageCount}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {chatSessions !== null && chatSessions.length > 0 && (
            <>
              <div className="uac-history-head">Saved chats</div>
              <ul className="uac-history-list">
                {chatSessions.map((sess) => (
                  <li key={sess.chatSessionId}>
                    <button
                      type="button"
                      className="uac-history-item"
                      onClick={() => selectSession(sess)}
                    >
                      <span className="uac-history-row-top">
                        <span className="uac-history-label">{sess.title}</span>
                        <span
                          className="uac-history-count"
                          title={`${sess.turnCount} ${sess.turnCount === 1 ? 'turn' : 'turns'}`}
                        >
                          {sess.turnCount}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="uac-history-head">Matter & client threads</div>
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

      {/* ── Settings popover (model now lives in the composer's comp pill) ──── */}
      {settingsOpen && (
        <div className="uac-popover">
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

          {/* Context depth lives in the toolbar "Context" control now (lean /
              balanced / full / secure) — see the layers icon by the composer. */}

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

          <div className="uac-setting uac-setting-row">
            <label className="uac-setting-label">Research mode</label>
            <button
              type="button"
              role="switch"
              aria-checked={research}
              className={`uac-switch${research ? ' on' : ''}`}
              disabled={!research && !researchModel}
              title={
                researchModel || research
                  ? 'Route questions to the research model (web-grounded, cited)'
                  : 'Connect Perplexity in Settings → Integrations to enable'
              }
              onClick={toggleResearch}
            >
              <span className="uac-switch-knob" />
            </button>
          </div>
          {!researchModel && !research && (
            <p className="uac-hint">Research needs a connected research provider.</p>
          )}
        </div>
      )}

      {/* ── WP-H2 → BUILDER-UX-2 WP-2: assistant-launched editors — the REAL
          per-artifact editors (the same modals the wizard cards mount), pre-loaded
          on the existing artifact and opened DIRECTLY in edit mode; saves go
          through the same core update paths. No View/Edit toggle. ──────────── */}
      {editorLaunch && editorLaunch.artifactType === 'template' && (
        <TemplateEditorModal
          title={`Edit template — ${editorLaunch.name}`}
          initialBody={typeof editorLaunch.content === 'string' ? editorLaunch.content : ''}
          regenerateTargetId={editorLaunch.id}
          onSave={async (body) => {
            await callAttorneyMcp({
              toolName: 'legal.template.update',
              input: { templateEntityId: editorLaunch.id, body },
            })
          }}
          onClose={() => setEditorLaunch(null)}
        />
      )}
      {editorLaunch && editorLaunch.artifactType === 'questionnaire' && (
        // BUILDER-UX-2 WP-2: the general-chat / post-approval questionnaire launch opens
        // the REAL field builder (the same QuestionnaireEditorModal the wizard card uses),
        // not the prohibited JSON textarea; Save persists to the existing artifact.
        <QuestionnaireEditorModal
          title={`Edit questionnaire — ${editorLaunch.name}`}
          initialSchema={(editorLaunch.content ?? { sections: [] }) as QuestionnaireSchema}
          name={editorLaunch.name}
          regenerateTargetId={editorLaunch.id}
          onSave={async (schema) => {
            await callAttorneyMcp({
              toolName: 'legal.questionnaire_template.update',
              input: { questionnaireTemplateId: editorLaunch.id, schema },
            })
          }}
          onClose={() => setEditorLaunch(null)}
        />
      )}
      {editorLaunch && editorLaunch.artifactType === 'workflow' && (
        <WorkflowEditorModal
          title={`Edit workflow — ${editorLaunch.name}`}
          serviceKey={editorLaunch.id}
          initialGraph={
            (Array.isArray(editorLaunch.content) ? editorLaunch.content : []) as WfLifecycle
          }
          onSave={async (graph) => {
            await callAttorneyMcp({
              toolName: 'legal.service.lifecycle.set',
              input: { serviceKey: editorLaunch.id, graph },
            })
          }}
          onClose={() => setEditorLaunch(null)}
        />
      )}

      {/* ── WP-L build-mode progress strip (comp): "Building a service ·
          <phase>", "Step n of 6", six gradient segments, exit ─────────────── */}
      {buildMode && (
        <div className="li-uac-buildstrip" role="region" aria-label="Building a service">
          <div className="li-uac-buildstrip-row">
            <GemSparkle size={18} />
            <span className="li-uac-buildstrip-title">Building a service</span>
            <span className="li-uac-buildstrip-phase">
              ·&nbsp;{BUILD_PHASES[buildStageIdx]!.label}
            </span>
            <span className="li-uac-buildstrip-step">Step {buildStageIdx + 1} of 6</span>
            <button
              type="button"
              className="li-uac-buildstrip-exit"
              onClick={() => {
                setBuildMode(false)
                closeBuildSession('abandoned') // Phase 5: exiting build seals the session
              }}
              title="Exit builder (the conversation stays)"
              aria-label="Exit builder"
            >
              <XIcon size={14} />
            </button>
          </div>
          <div className="li-uac-buildstrip-segs" aria-hidden="true">
            {BUILD_PHASES.map((p, i) => (
              <span
                key={p.artifact}
                className={`li-uac-buildstrip-seg${i <= buildStageIdx ? ' is-on' : ''}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Feedback mode banner ──────────────────────────────────────────── */}
      {feedbackMode && (
        <div className="li-uac-fbstrip" role="region" aria-label="Feedback mode">
          {fbDone ? (
            <div className="li-uac-fbstrip-done">
              <span className="li-uac-fbstrip-thanks">
                <GemCluster size={18} /> Thank you — your feedback is with the team.
              </span>
              {fbRef && (
                <span className="li-uac-fbstrip-refrow">
                  <span className="li-uac-fbstrip-reflabel">Reference</span>
                  <code className="uac-beta-ref" title={`Recorded as event ${fbRef}`}>
                    {fbRef.slice(0, 8)}
                  </code>
                </span>
              )}
              <button type="button" className="li-uac-fbstrip-back" onClick={exitFeedbackMode}>
                Back to chat
              </button>
            </div>
          ) : (
            <>
              <div className="li-uac-fbstrip-row">
                <GemCluster size={18} />
                <span className="li-uac-fbstrip-title">Beta feedback</span>
                <span className="li-uac-fbstrip-phase">·&nbsp;request features or report bugs</span>
                <select
                  className="li-uac-fbstrip-cat"
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
                <button
                  type="button"
                  className="li-uac-fbstrip-send"
                  disabled={fbBusy || turns.length === 0}
                  onClick={() => void submitFeedback()}
                  title={
                    turns.length === 0 ? 'Describe your feedback in the chat first' : undefined
                  }
                >
                  {fbBusy ? 'Submitting…' : 'Submit feedback'}
                </button>
                <button
                  type="button"
                  className="li-uac-fbstrip-exit"
                  onClick={exitFeedbackMode}
                  disabled={fbBusy}
                  title="Exit feedback (the conversation stays)"
                  aria-label="Exit feedback"
                >
                  <XIcon size={14} />
                </button>
              </div>
              <div className="li-uac-fbstrip-sub">
                Tell me what’s working, broken, or missing — I’ll ask a follow-up or two, then log
                the whole thread to the team.
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
        {/* WP-L empty state (comp): serif greeting + starter suggestion cards.
            Each card is a REAL flow — no dead controls (see WIRING §WP-L). */}
        {visibleTurns.length === 0 && !streaming && !matterFlow && !draftPicker && (
          <div className="li-uac-empty">
            <div className="li-uac-empty-title">{intro ?? 'How can I serve you, Counselor?'}</div>
            {!feedbackMode && (
              <div className="li-uac-starters">
                <button
                  type="button"
                  className="li-uac-starter"
                  onClick={startDraftFlow}
                  disabled={busy}
                >
                  <span className="li-uac-starter-icon">
                    <FileTextIcon size={17} />
                  </span>
                  Draft a document
                </button>
                {activeScope.matterEntityId && (
                  <button
                    type="button"
                    className="li-uac-starter"
                    onClick={startSummarize}
                    disabled={busy || !modelId}
                  >
                    <span className="li-uac-starter-icon">
                      <ListIcon size={17} />
                    </span>
                    Summarize this matter
                  </button>
                )}
                <button
                  type="button"
                  className="li-uac-starter"
                  onClick={startMatterFlow}
                  disabled={busy}
                >
                  <span className="li-uac-starter-icon">
                    <CheckCircleIcon size={17} />
                  </span>
                  Create a new matter
                </button>
                {isClaude && buildWizard && (
                  <button
                    type="button"
                    className="li-uac-starter"
                    onClick={enterBuildMode}
                    disabled={busy || !modelId}
                  >
                    <span className="li-uac-starter-icon">
                      <WandIcon size={17} />
                    </span>
                    Create a new service
                  </button>
                )}
                <button
                  type="button"
                  className="li-uac-starter"
                  onClick={enterFeedbackMode}
                  disabled={busy}
                >
                  <span className="li-uac-starter-icon">
                    <MegaphoneIcon size={17} />
                  </span>
                  Request features or report bugs
                </button>
              </div>
            )}
          </div>
        )}

        {/* WP-L "Draft a document" (general scope): pick the matter to ground on,
            then the composer is prefilled with the draft request. */}
        {draftPicker && (
          <div className="li-uac-flow">
            <div className="li-uac-msg li-uac-msg-assistant">Which matter should I draft for?</div>
            {draftPicker.matters === null ? (
              <div className="li-uac-flow-loading">
                <GemSparkle size={16} /> Loading matters…
              </div>
            ) : draftPicker.matters.length === 0 ? (
              <div className="li-uac-msg li-uac-msg-assistant">
                No matters yet — open one first (try “Create a new matter”).
              </div>
            ) : (
              <div className="li-uac-opts">
                {draftPicker.matters.map((m) => (
                  <button
                    key={m.matterEntityId}
                    type="button"
                    className="li-uac-opt"
                    onClick={() => pickDraftMatter(m)}
                  >
                    <span className="li-uac-opt-radio" aria-hidden="true" />
                    {m.matterNumber ?? m.matterEntityId.slice(0, 8)}
                    {m.serviceLabel ? ` — ${m.serviceLabel}` : ''}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="li-uac-flow-cancel"
              onClick={() => setDraftPicker(null)}
            >
              Cancel
            </button>
          </div>
        )}

        {/* WP-L "Create a new matter" — the guided chip walk. Ends in a REAL
            matter via legal.matter.open (the same operation NewMatterModal uses). */}
        {matterFlow && (
          <div className="li-uac-flow">
            <div className="li-uac-msg li-uac-msg-assistant">
              Let’s open a new matter. Which service is it for?
            </div>
            {matterFlow.step === 'service' &&
              (matterFlow.services === null ? (
                <div className="li-uac-flow-loading">
                  <GemSparkle size={16} /> Loading services…
                </div>
              ) : matterFlow.services.length === 0 ? (
                <div className="li-uac-msg li-uac-msg-assistant">
                  No bookable services yet — create one first (try “Create a new service”).
                </div>
              ) : (
                <div className="li-uac-opts">
                  {matterFlow.services.map((s) => (
                    <button
                      key={s.serviceKey}
                      type="button"
                      className="li-uac-opt"
                      onClick={() => matterFlowPickService(s)}
                    >
                      <span className="li-uac-opt-radio" aria-hidden="true" />
                      {s.displayName}
                    </button>
                  ))}
                </div>
              ))}
            {matterFlow.serviceName && (
              <div className="li-uac-answered">
                <CheckIcon size={13} /> {matterFlow.serviceName}
              </div>
            )}

            {(matterFlow.step === 'name' ||
              matterFlow.step === 'email' ||
              matterFlow.step === 'creating' ||
              matterFlow.step === 'done') && (
              <div className="li-uac-msg li-uac-msg-assistant">What’s the client’s full name?</div>
            )}
            {matterFlow.clientFullName && (
              <div className="li-uac-answered">
                <CheckIcon size={13} /> {matterFlow.clientFullName}
              </div>
            )}
            {(matterFlow.step === 'email' ||
              matterFlow.step === 'creating' ||
              matterFlow.step === 'done') && (
              <div className="li-uac-msg li-uac-msg-assistant">And the client’s email?</div>
            )}
            {matterFlow.clientEmail && (
              <div className="li-uac-answered">
                <CheckIcon size={13} /> {matterFlow.clientEmail}
              </div>
            )}

            {(matterFlow.step === 'name' || matterFlow.step === 'email') && (
              <div className="li-uac-flow-inputrow">
                <input
                  className="li-uac-flow-input"
                  value={matterFlowText}
                  onChange={(e) => setMatterFlowText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      matterFlowSubmitText()
                    }
                  }}
                  placeholder={
                    matterFlow.step === 'name' ? 'e.g. Jane Doe' : 'e.g. jane@example.com'
                  }
                  type={matterFlow.step === 'email' ? 'email' : 'text'}
                  aria-label={matterFlow.step === 'name' ? 'Client full name' : 'Client email'}
                  autoFocus
                />
                <button
                  type="button"
                  className="li-uac-flow-submit"
                  onClick={matterFlowSubmitText}
                  disabled={!matterFlowText.trim()}
                  aria-label="Submit answer"
                >
                  <ArrowRightIcon size={15} />
                </button>
              </div>
            )}

            {matterFlow.step === 'creating' && (
              <div className="li-uac-flow-loading">
                <GemSparkle size={16} /> Opening the matter…
              </div>
            )}
            {matterFlow.step === 'done' && matterFlow.matterEntityId && (
              <>
                <div className="li-uac-msg li-uac-msg-assistant">
                  Done — I’ve opened <strong>{matterFlow.serviceName}</strong> for{' '}
                  {matterFlow.clientFullName} and queued the intake questionnaire for the client.
                </div>
                <button
                  type="button"
                  className="li-uac-done-primary"
                  onClick={() => router.push(`/attorney/matters/${matterFlow.matterEntityId}`)}
                >
                  View matter
                </button>
              </>
            )}
            {matterFlow.error && (
              <div role="alert" className="alert alert-error">
                {matterFlow.error}
              </div>
            )}
            {matterFlow.step !== 'done' && matterFlow.step !== 'creating' && (
              <button
                type="button"
                className="li-uac-flow-cancel"
                onClick={() => {
                  setMatterFlow(null)
                  setMatterFlowText('')
                }}
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {/* Hidden continuations stay in `turns` (the model must re-see them in the
            next request's history) but render no bubble — the cards already show
            their outcome. Filtering is key-stable: turns only append, and
            hiddenFromUi never changes after commit. */}
        {visibleTurns.map((t, i) => (
          <div
            key={i}
            className={`li-uac-msg li-uac-msg-${t.role}`}
            // A failed send stays visible but dimmed: the attorney sees what
            // didn't go through, and "Try again" (in the error alert) revives it.
            style={t.failed ? { opacity: 0.55 } : undefined}
            title={t.failed ? 'This message didn’t send — use Try again below.' : undefined}
          >
            {/* Assistant replies are markdown — render so **bold**, lists and
                headings display formatted (not as raw syntax). renderMarkdown
                escapes HTML before formatting, so model output can't inject
                markup. User turns stay verbatim. */}
            {t.role === 'assistant' ? (
              <>
                {/* Founder walk 2026-07-17: on interview turns the question card IS
                    the message — the lead-in prose duplicated it and the Thinking
                    tab added chrome, so both are suppressed when the turn carries
                    build questions. */}
                {!t.buildQuestions?.length && stripMachinery(t.content).trim() && (
                  <div
                    className="assistant-md"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(stripMachinery(t.content)),
                    }}
                  />
                )}
                {/* The model's reasoning/process — a collapsed disclosure in normal
                    chat. Hidden throughout BUILD MODE (founder walk): the progress
                    strip is the activity signal there, so the "Thinking" tab was just
                    chrome on every builder turn (interview cards and proposal cards
                    alike). */}
                {!buildMode && !t.buildQuestions?.length && t.reasoning?.trim() && (
                  <ReasoningDisclosure reasoning={t.reasoning} />
                )}
                {/* Documents the assistant produced — downloadable deliverables
                    (PDF/Word + save to matter), not the prose. Downloads attach
                    here, never to an ordinary reply. */}
                {t.documents?.map((doc, di) => (
                  <DocumentCard key={di} doc={doc} matterEntityId={activeScope.matterEntityId} />
                ))}
                {/* Billing proposals — rendered ABOVE the workflow card so a
                    same-turn pair reads in approve order (pricing first: the
                    workflow's approve validates against the approved billing). */}
                {t.costProposals?.map((p, pi) => (
                  <CostProposalCard
                    key={pi}
                    proposal={p}
                    onApproved={handleApproved}
                    onEdited={handleProposalEdited}
                  />
                ))}
                {/* Workflow proposals (PR5) — inline approval cards. Approving is the
                    live write; nothing was saved by the turn that proposed them. */}
                {t.workflowProposals?.map((p, pi) => (
                  <WorkflowProposalCard
                    key={pi}
                    proposal={p}
                    onApproved={handleApproved}
                    onRevise={handleRevise}
                    onEdited={handleProposalEdited}
                  />
                ))}
                {/* New-service proposals (Build-Wizard Phase 1) — inline approval
                    cards. Approving creates the (disabled) service; nothing was saved
                    by the turn that proposed it. */}
                {t.serviceProposals?.map((p, pi) => (
                  <ServiceProposalCard
                    key={pi}
                    proposal={p}
                    onApproved={handleApproved}
                    onEdited={handleProposalEdited}
                  />
                ))}
                {/* Questionnaire proposals (Build-Wizard Phase 2) — inline approval
                    cards surfacing the variable-contract coverage. Approving writes
                    the service's intake form; nothing was saved by the proposing turn. */}
                {t.questionnaireProposals?.map((p, pi) => (
                  <QuestionnaireProposalCard
                    key={pi}
                    proposal={p}
                    onApproved={handleApproved}
                    onEdited={handleProposalEdited}
                  />
                ))}
                {/* Template proposals (Build-Wizard Phase 3) — inline approval cards
                    flagging orphan tokens. Approving writes the service's document
                    template; nothing was saved by the proposing turn. */}
                {t.templateProposals?.map((p, pi) => (
                  <TemplateProposalCard
                    key={pi}
                    proposal={p}
                    onApproved={handleApproved}
                    onEdited={handleProposalEdited}
                  />
                ))}
                {/* Enable proposals (Build-Wizard Phase 6, terminal) — the final card.
                    Approving flips the service to active/bookable; this ends the build. */}
                {t.enableProposals?.map((p, pi) => (
                  <EnableProposalCard
                    key={pi}
                    proposal={p}
                    onApproved={handleApproved}
                    onDone={handleBuildDone}
                  />
                ))}
                {/* New data-kind proposals (Tier 1 data-as-schema) — approval cards.
                    Approving mints the kind via kind.define; the proposing turn wrote
                    nothing. */}
                {t.kindProposals?.map((p, pi) => (
                  <KindProposalCard key={pi} proposal={p} onApproved={handleApproved} />
                ))}
                {/* Structured interview questions (Phase 7) — walked ONE AT A TIME as
                    a click-through (QuestionBatch), not a stack. Answering sends a
                    HIDDEN continuation (no fake user bubble). */}
                {t.buildQuestions && t.buildQuestions.length > 0 && (
                  <QuestionBatch questions={t.buildQuestions} onAnswer={handleQuestionAnswer} />
                )}
                {/* Non-fatal warnings (e.g. the tool-round cap cut a step off) —
                    visible on the turn, never rendered as a failure (WP5.1).
                    tone 'status' renders muted (a progress line, no glyph). */}
                {t.notices?.map((n, ni) =>
                  n.tone === 'status' ? (
                    <div
                      key={ni}
                      role="status"
                      className="text-muted"
                      style={{ marginTop: 8, fontSize: 13 }}
                    >
                      {n.message}
                    </div>
                  ) : (
                    <div
                      key={ni}
                      role="status"
                      style={{
                        marginTop: 8,
                        padding: '6px 10px',
                        borderRadius: 8,
                        fontSize: 13,
                        background: 'rgba(245, 158, 11, 0.12)',
                        border: '1px solid rgba(245, 158, 11, 0.35)',
                      }}
                    >
                      ⚠️ {n.message}
                    </div>
                  ),
                )}
                {stripMachinery(t.content).trim() && (
                  <div className="uac-reply-actions">
                    <CopyButton text={stripMachinery(t.content)} />
                  </div>
                )}
              </>
            ) : (
              // User bubbles strip machinery too (UI-BUILDER-FIX-1 item 9): a
              // persisted driver/continuation turn must never render its ⟦…⟧
              // payload — structural, not reliant on the model's discipline.
              <div style={{ whiteSpace: 'pre-wrap' }}>{stripMachinery(t.content)}</div>
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
          <div className="li-uac-msg li-uac-msg-assistant">
            {/* "Using <skill>" chips are process signals, not the reply — a live
                progress affordance only. They clear the moment answer text arrives so
                the reply channel reads clean (BUILDER-REASONING-CHANNEL-1). */}
            {/* Founder walk 2026-07-17: in build mode the progress strip already
                says what's running — the skill pill was noise there. */}
            {!streaming.text && !buildMode && streaming.skills.length > 0 && (
              <div className="uac-skill-chips">
                {streaming.skills.map((s) => (
                  <span key={s.slug} className="uac-skill-chip">
                    <SparklesIcon size={11} /> Using {s.name}
                  </span>
                ))}
              </div>
            )}
            {/* THE one loading indicator (UI-BUILDER-FIX-1 Phase 8). Thinking,
                drafting, and pre-first-token waiting used to be three mounts with
                non-exclusive guards — "Thinking…" and "Drafting…" could show at
                once. Now every pre-text state renders exactly ONE WorkingIndicator
                (cycling legal-flavored phrases); it unmounts the moment answer
                text or any artifact card arrives. The model's reasoning prose is
                still machinery — never rendered (1.1 WP1). */}
            {(!streaming.text || streaming.drafting) &&
              streaming.documents.length === 0 &&
              streaming.workflowProposals.length === 0 &&
              streaming.serviceProposals.length === 0 &&
              streaming.questionnaireProposals.length === 0 &&
              streaming.templateProposals.length === 0 &&
              streaming.costProposals.length === 0 &&
              streaming.enableProposals.length === 0 &&
              streaming.buildQuestions.length === 0 &&
              streaming.kindProposals.length === 0 && <WorkingIndicator />}
            {/* A document produced mid-stream appears as a card right away. */}
            {streaming.documents.map((doc, di) => (
              <DocumentCard key={di} doc={doc} matterEntityId={activeScope.matterEntityId} />
            ))}
            {/* A billing proposal mid-stream — above the workflow card so a same-turn
              pair reads in approve order (pricing first). */}
            {streaming.costProposals.map((p, pi) => (
              <CostProposalCard
                key={pi}
                proposal={p}
                onApproved={handleApproved}
                onEdited={handleProposalEdited}
              />
            ))}
            {/* A workflow proposed mid-stream appears as an approval card right away. */}
            {streaming.workflowProposals.map((p, pi) => (
              <WorkflowProposalCard
                key={pi}
                proposal={p}
                onApproved={handleApproved}
                onRevise={handleRevise}
                onEdited={handleProposalEdited}
              />
            ))}
            {/* A service proposed mid-stream appears as an approval card right away. */}
            {streaming.serviceProposals.map((p, pi) => (
              <ServiceProposalCard
                key={pi}
                proposal={p}
                onApproved={handleApproved}
                onEdited={handleProposalEdited}
              />
            ))}
            {/* A questionnaire proposed mid-stream appears as an approval card. */}
            {streaming.questionnaireProposals.map((p, pi) => (
              <QuestionnaireProposalCard
                key={pi}
                proposal={p}
                onApproved={handleApproved}
                onEdited={handleProposalEdited}
              />
            ))}
            {/* A template proposed mid-stream appears as an approval card. */}
            {streaming.templateProposals.map((p, pi) => (
              <TemplateProposalCard
                key={pi}
                proposal={p}
                onApproved={handleApproved}
                onEdited={handleProposalEdited}
              />
            ))}
            {/* The terminal Enable card mid-stream (Phase 6). */}
            {streaming.enableProposals.map((p, pi) => (
              <EnableProposalCard
                key={pi}
                proposal={p}
                onApproved={handleApproved}
                onDone={handleBuildDone}
              />
            ))}
            {/* A new data-kind proposal mid-stream (Tier 1) — an approval card. */}
            {streaming.kindProposals.map((p, pi) => (
              <KindProposalCard key={pi} proposal={p} onApproved={handleApproved} />
            ))}
            {/* Structured interview questions mid-stream (Phase 7) — click-through. */}
            {streaming.buildQuestions.length > 0 && (
              <QuestionBatch questions={streaming.buildQuestions} onAnswer={handleQuestionAnswer} />
            )}
            {streaming.text && streaming.buildQuestions.length === 0 && (
              <StreamingMarkdown text={streaming.text} />
            )}
            {/* Live notices (BUILDER-UX-3 P3): status tone is the muted transient
                progress line ("Taking another pass…") — it renders only here and is
                dropped when the turn commits; warnings keep the amber box. */}
            {streaming.notices.map((n, ni) =>
              n.tone === 'status' ? (
                <div
                  key={ni}
                  role="status"
                  className="text-muted"
                  style={{ marginTop: 8, fontSize: 13 }}
                >
                  {n.message}
                </div>
              ) : (
                <div
                  key={ni}
                  role="status"
                  style={{
                    marginTop: 8,
                    padding: '6px 10px',
                    borderRadius: 8,
                    fontSize: 13,
                    background: 'rgba(245, 158, 11, 0.12)',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                  }}
                >
                  ⚠️ {n.message}
                </div>
              ),
            )}
          </div>
        )}

        {error && (
          <div role="alert" className="alert alert-error">
            <span>{humanizeClientError(error)}</span>
            {/* One-click retry of the failed send — full conversation context is
                rebuilt up to that point, so the exchange picks up where it left
                off (the failed bubble is revived, not duplicated). */}
            {retryRef.current && !busy && (
              <button
                type="button"
                className="uac-retry-btn"
                onClick={retryLastSend}
                style={{
                  marginLeft: 8,
                  padding: '2px 10px',
                  borderRadius: 6,
                  border: '1px solid currentColor',
                  background: 'transparent',
                  color: 'inherit',
                  font: 'inherit',
                  fontSize: '0.85em',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Try again
              </button>
            )}
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
        {/* Picked-skill pills (Claude only) — what the assistant will force-load. */}
        {isClaude && selectedSkills.length > 0 && (
          <div className="uac-staged-skills">
            {selectedSkills.map((s) => (
              <span key={s.slug} className="uac-skill-pill" title={s.name}>
                <SparklesIcon size={11} />
                <span className="uac-skill-pill-name">{s.name}</span>
                <button
                  type="button"
                  className="uac-attach-remove"
                  onClick={() => setSelectedSkills((prev) => prev.filter((x) => x.slug !== s.slug))}
                  aria-label={`Remove ${s.name}`}
                >
                  <XIcon size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="uac-composer">
          {/* WP-L attach menu (comp): Upload from computer / Attach from a matter
              (matter scope) / Insert a template — icon tile + label + description. */}
          {attachMenuOpen && canAttach && (
            <div className="li-uac-menu li-uac-attachmenu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="li-uac-menu-item"
                onClick={() => {
                  setAttachMenuOpen(false)
                  fileInputRef.current?.click()
                }}
              >
                <span className="li-uac-menu-tile">
                  <UploadIcon size={16} />
                </span>
                <span className="li-uac-menu-text">
                  <span className="li-uac-menu-label">Upload from computer</span>
                  <span className="li-uac-menu-desc">PDF, Word, or text</span>
                </span>
              </button>
              {activeScope.matterEntityId && (
                <button
                  type="button"
                  role="menuitem"
                  className="li-uac-menu-item"
                  onClick={() => {
                    setAttachMenuOpen(false)
                    void attachMatterDocument()
                  }}
                >
                  <span className="li-uac-menu-tile">
                    <FileTextIcon size={16} />
                  </span>
                  <span className="li-uac-menu-text">
                    <span className="li-uac-menu-label">Attach from this matter</span>
                    <span className="li-uac-menu-desc">The document already on file</span>
                  </span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="li-uac-menu-item"
                onClick={openTemplatePicker}
              >
                <span className="li-uac-menu-tile">
                  <LayersIcon size={16} />
                </span>
                <span className="li-uac-menu-text">
                  <span className="li-uac-menu-label">Insert a template</span>
                  <span className="li-uac-menu-desc">Start from a saved template</span>
                </span>
              </button>
            </div>
          )}
          {/* WP-L "Insert a template" picker — the firm's real template library. */}
          {templatePicker.open && canAttach && (
            <div className="li-uac-menu li-uac-tplmenu" role="menu" aria-label="Insert a template">
              <div className="li-uac-menu-head">Insert a template</div>
              {templatePicker.templates === null ? (
                <div className="li-uac-menu-empty">
                  <span className="spinner" /> Loading templates…
                </div>
              ) : templatePicker.templates.length === 0 ? (
                <div className="li-uac-menu-empty">No templates in the library yet.</div>
              ) : (
                <div className="li-uac-tplmenu-list">
                  {templatePicker.templates.map((t) => (
                    <button
                      key={t.templateEntityId}
                      type="button"
                      role="menuitem"
                      className="li-uac-menu-item"
                      onClick={() => insertTemplate(t)}
                    >
                      <span className="li-uac-menu-tile">
                        <FileTextIcon size={16} />
                      </span>
                      <span className="li-uac-menu-text">
                        <span className="li-uac-menu-label">{t.name}</span>
                        {t.docKind && (
                          <span className="li-uac-menu-desc">{t.docKind.replace(/_/g, ' ')}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="li-uac-flow-cancel"
                onClick={() => setTemplatePicker((p) => ({ ...p, open: false }))}
              >
                Cancel
              </button>
            </div>
          )}
          {/* The textarea grows upward with content; the toolbar row stays pinned
              at the bottom (it no longer overlays the text). */}
          <textarea
            ref={composerRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={placeholder || 'Message the assistant'}
            rows={2}
          />
          <div className="uac-composer-bar">
            <div className="uac-composer-tools">
              {canAttach && (
                <button
                  type="button"
                  className={`uac-tool-btn${attachMenuOpen ? ' active' : ''}`}
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
              {isClaude && (
                <button
                  type="button"
                  className={`uac-tool-btn${skillMenuOpen ? ' active' : ''}`}
                  onClick={() => setSkillMenuOpen((o) => !o)}
                  aria-label="Legal skills"
                  title="Legal skills — or type / in an empty message"
                >
                  <SparklesIcon size={16} />
                </button>
              )}
              {isClaude && (
                <div className="uac-ctxmenu-wrap">
                  <button
                    type="button"
                    className={`uac-tool-btn${contextMenuOpen ? ' active' : ''}${secureMode ? ' secure-on' : ''}`}
                    onClick={() => setContextMenuOpen((o) => !o)}
                    aria-haspopup="menu"
                    aria-expanded={contextMenuOpen}
                    aria-label={`Context: ${contextLevel}`}
                    title={`Context: ${
                      CONTEXT_LEVELS.find((l) => l.value === contextLevel)?.label ?? 'Balanced'
                    } — how much of the matter the assistant reads (Secure = never used for web search)`}
                  >
                    {secureMode ? <ShieldCheckIcon size={16} /> : <LayersIcon size={16} />}
                  </button>
                  {contextMenuOpen && (
                    <div className="uac-ctxmenu" role="menu" aria-label="Context level">
                      <div className="uac-ctxmenu-head">Context</div>
                      {CONTEXT_LEVELS.map((l) => (
                        <button
                          key={l.value}
                          type="button"
                          role="menuitemradio"
                          aria-checked={contextLevel === l.value}
                          className={`uac-ctxmenu-item${contextLevel === l.value ? ' is-on' : ''}`}
                          onClick={() => setContextLevel(l.value)}
                        >
                          <span className="uac-ctxmenu-icon">
                            {l.value === 'secure' ? (
                              <ShieldCheckIcon size={14} />
                            ) : (
                              <LayersIcon size={14} />
                            )}
                          </span>
                          <span className="uac-ctxmenu-text">
                            <span className="uac-ctxmenu-name">
                              {l.label}
                              {contextLevel === l.value && <CheckIcon size={13} />}
                            </span>
                            <span className="uac-ctxmenu-hint">{l.hint}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* Build with AI (Phase 7) — enters BUILD MODE and kicks off the guided
                  interview. An icon-only tool that matches the others (paperclip /
                  skills / context); the tooltip names it. Only when the wizard flag is
                  on; Claude-only (the wizard tools ride the Claude path). When already
                  in build mode it reads as an active state rather than a second launch. */}
              {isClaude && buildWizard && (
                <button
                  type="button"
                  className={`uac-tool-btn${buildMode ? ' active' : ''}`}
                  onClick={enterBuildMode}
                  disabled={busy}
                  aria-pressed={buildMode}
                  aria-label="Build with AI"
                  title="Build with AI — start the guided service setup"
                >
                  <WandIcon size={16} />
                </button>
              )}
            </div>
            <div className="li-uac-composer-right">
              {/* WP-L model pill + menu (comp): only connected providers listed. */}
              <div className="li-uac-modelwrap">
                <button
                  type="button"
                  className="li-uac-modelpill"
                  onClick={() => setModelMenuOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={modelMenuOpen}
                  aria-label="AI model"
                  title="Choose the AI model"
                  disabled={!models}
                >
                  {selected?.label ?? 'Model'}
                  <ChevronDownIcon size={12} />
                </button>
                {modelMenuOpen && (
                  <div className="li-uac-menu li-uac-modelmenu" role="menu" aria-label="Model">
                    <div className="li-uac-menu-head">Model</div>
                    {connectedModels.length === 0 && (
                      <div className="li-uac-menu-empty">
                        No connected models — connect one in Settings → Integrations.
                      </div>
                    )}
                    {connectedModels.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={m.id === modelId}
                        className="li-uac-menu-item li-uac-modelitem"
                        onClick={() => {
                          setModelId(m.id)
                          storeModelId(m.id) // remember it for next session
                          setModelMenuOpen(false)
                        }}
                      >
                        <span className="li-uac-menu-check">
                          {m.id === modelId ? <CheckIcon size={14} /> : null}
                        </span>
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="uac-send li-uac-send"
                onClick={() => void send()}
                disabled={busy || !input.trim() || !modelId}
                aria-label="Send"
              >
                <SendIcon size={17} />
              </button>
            </div>
          </div>
        </div>
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
