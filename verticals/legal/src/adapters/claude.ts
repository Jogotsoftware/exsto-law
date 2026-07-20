import Anthropic from '@anthropic-ai/sdk'
import { loadConnection, markConnectionError } from './connectionStore.js'
import { redactSecret } from './redact.js'
import {
  TIER_MODEL,
  resolveModelForTask,
  type AiTask,
  type RouteSignals,
} from '../lib/modelRouter.js'

// AI-CONTEXT C1 — model selection lives in lib/modelRouter.ts (the central,
// pure router); this adapter stays the only place that actually CALLS the
// Anthropic API (the single-adapter rule — CLAUDE.md, exsto-ai-operation
// skill). There is deliberately no local DEFAULT_MODEL constant anymore — see
// the router's module header for why (`LEGAL_DRAFTING_MODEL=''` is a real
// deploy state that `??` doesn't catch).

// Every Anthropic client in this adapter is constructed here so they all hit the
// same endpoint. We pin baseURL to Anthropic's real API on purpose: the SDK
// otherwise silently honors an ANTHROPIC_BASE_URL env var, and a stray or
// misconfigured value in the deployment (e.g. a leftover LLM-gateway URL)
// redirects every request and returns opaque bodyless 401s — which is exactly
// what broke key verification in Settings on the deployed site. If a deliberate
// proxy is ever needed, set it here intentionally rather than via the environment.
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com'

function makeAnthropic(apiKey: string): Anthropic {
  // maxRetries: 0 — we own retry ourselves (see withTransientRetry / retryDelayMs)
  // so the policy is deterministic, logged, and SIDE-EFFECT-SAFE: retry is scoped
  // to a single messages.create/stream round inside the tool loop, never an outer
  // turn that has already executed a client tool. The SDK's silent built-in retry
  // (default 2) is disabled so the two don't compound into confusing latency.
  return new Anthropic({ apiKey, baseURL: ANTHROPIC_BASE_URL, maxRetries: 0 })
}

// ── Transient-error handling (OVERLOAD-HANDLING-1) ──────────────────────────
// Anthropic API overload (529 overloaded_error), rate limits (429), upstream
// 5xx, and connection blips are TRANSIENT and RETRYABLE — momentary saturation,
// not a caller error. We auto-retry them with backoff before surfacing anything,
// and when retries exhaust we show a plain human sentence — never the raw
// API-error JSON or a request_id.

// Short backoff schedule (ms) applied BEFORE each retry. Most 529s clear by the
// second attempt; the schedule is bounded so a synchronous request doesn't blow
// its route budget (see maxDuration on the stream route). Length = max retries.
const RETRY_BACKOFF_MS = [1000, 2000, 4000]
// Cap on a server-suggested Retry-After so a large value can't hang the request.
const MAX_RETRY_DELAY_MS = 8000

const TRANSIENT_OVERLOAD_MESSAGE =
  'The assistant is briefly overloaded — please try again in a moment.'
const TEMPORARILY_UNAVAILABLE_MESSAGE =
  'The assistant is temporarily unavailable — please try again in a moment.'
const GENERIC_ASSISTANT_ERROR = "The assistant couldn't complete that request. Please try again."

// True when an error is transient and safe to auto-retry. A 4xx that isn't 429
// (400 bad request, 401/403 auth, 404, 422 content policy) is the caller's
// problem — retrying can't fix it, so those surface immediately.
export function isRetryableAnthropicError(err: unknown): boolean {
  // No HTTP response arrived at all (network drop / DNS / timeout). The SDK
  // raises APIConnectionError (incl. its timeout subclass) — transient. A user
  // abort (APIUserAbortError) is a sibling with no `status`; it is NOT caught
  // here and falls through to non-retryable, which is correct.
  if (err instanceof Anthropic.APIConnectionError) return true
  if (err instanceof Anthropic.APIError) {
    const status = err.status
    if (status === 429) return true // rate limited
    if (typeof status === 'number' && status >= 500 && status < 600) return true // incl. 529
    return false
  }
  return false
}

// Pull a Retry-After header (HTTP spec: delay in seconds) off an SDK error,
// converted to ms and capped. Returns null when absent/unparseable.
function retryAfterMs(err: unknown): number | null {
  if (!(err instanceof Anthropic.APIError)) return null
  const headers = (err as { headers?: unknown }).headers
  const raw = readHeader(headers, 'retry-after')
  if (raw == null) return null
  const secs = Number(raw)
  if (!Number.isFinite(secs) || secs < 0) return null
  return Math.min(secs * 1000, MAX_RETRY_DELAY_MS)
}

// err.headers can be a fetch Headers instance or a plain record across SDK
// versions; read both shapes defensively.
function readHeader(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null
  const getter = (headers as { get?: unknown }).get
  if (typeof getter === 'function') {
    const v = (getter as (n: string) => string | null).call(headers, name)
    return typeof v === 'string' ? v : null
  }
  const rec = headers as Record<string, unknown>
  const v = rec[name] ?? rec[name.toLowerCase()]
  return typeof v === 'string' ? v : null
}

// The delay (ms) to wait before retrying `attempt` (0-based), or null when the
// error is non-retryable OR the retry budget is spent. Single source of truth
// for both the non-streaming wrapper and the streaming loop.
export function retryDelayMs(attempt: number, err: unknown): number | null {
  if (!isRetryableAnthropicError(err) || attempt >= RETRY_BACKOFF_MS.length) return null
  return retryAfterMs(err) ?? RETRY_BACKOFF_MS[attempt]!
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Run ONE Anthropic round-trip with automatic retry on transient errors.
// SIDE-EFFECT SAFETY: `call` MUST be a single messages.create/stream call with
// no side effect of its own — never wrap an outer turn that already ran a tool,
// or a retry could re-fire it. A failed call never executed a tool (tools run
// only after a call succeeds with stop_reason 'tool_use'), so this is safe.
// `sleepFn` is injectable so unit tests don't actually wait out the backoff.
export async function withTransientRetry<T>(
  call: () => Promise<T>,
  opts: { label?: string; sleepFn?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const sleep = opts.sleepFn ?? defaultSleep
  for (let attempt = 0; ; attempt++) {
    try {
      return await call()
    } catch (err) {
      const delay = retryDelayMs(attempt, err)
      if (delay == null) throw err
      if (opts.label) {
        console.warn(
          `[claude] transient error on ${opts.label}; retry ${attempt + 1}/${RETRY_BACKOFF_MS.length} in ${delay}ms`,
        )
      }
      await sleep(delay)
    }
  }
}

function looksLikeJson(s: string): boolean {
  const t = s.trim()
  return t.startsWith('{') || t.startsWith('[') || /"type"\s*:\s*"error"/.test(t)
}

// Extract the human `message` from an Anthropic error body (shape:
// { type:'error', error:{ type, message } }) — never the JSON envelope, never a
// request_id. Returns null when nothing clean is available.
export function extractApiErrorMessage(err: unknown): string | null {
  if (!(err instanceof Anthropic.APIError)) return null
  const body = (err as { error?: unknown }).error
  if (!body || typeof body !== 'object') return null
  const inner = (body as { error?: unknown; message?: unknown }).error
  const candidates: unknown[] = [
    inner && typeof inner === 'object' ? (inner as { message?: unknown }).message : undefined,
    (body as { message?: unknown }).message,
  ]
  for (const m of candidates) {
    if (typeof m === 'string' && m.trim() && !looksLikeJson(m)) return m.trim()
  }
  return null
}

// Turn any Anthropic call error into a plain, user-safe sentence. Transient
// errors reach here only after retries are exhausted. NEVER returns raw
// API-error JSON or a request_id — the transcript shows only human text.
export function humanizeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.APIConnectionError) return TEMPORARILY_UNAVAILABLE_MESSAGE
  if (err instanceof Anthropic.APIError) {
    if (isRetryableAnthropicError(err)) return TRANSIENT_OVERLOAD_MESSAGE
    if (err.status === 401 || err.status === 403) {
      return 'Anthropic rejected the API key. Check the connected key in Settings → Integrations.'
    }
    const detail = extractApiErrorMessage(err)
    return detail
      ? `The assistant couldn't complete that request: ${detail}`
      : GENERIC_ASSISTANT_ERROR
  }
  if (err instanceof Error && err.message && !looksLikeJson(err.message)) return err.message
  return GENERIC_ASSISTANT_ERROR
}

type AnthropicSecret = { api_key: string }

export interface ClaudeDraftRequest {
  prompt: string
  maxTokens?: number
  // AI-CONTEXT C1 — REQUIRED so every drafting call site declares what kind of
  // work it is; the router uses it to pick Haiku vs Sonnet (and to know
  // whether LEGAL_DRAFTING_MODEL is allowed to override it). This is
  // deliberately a compile-error safety net: a new call site that forgets to
  // classify itself fails `tsc`, not silently falls back to a guessed model.
  task: AiTask
  // Optional routing signals beyond the default (inputChars defaults to
  // request.prompt.length — see callClaudeDrafter below).
  signals?: RouteSignals
}

export interface ClaudeDraftReasoningTrace {
  prompt_id?: string
  model_identity?: string
  evidence: unknown[]
  alternatives_considered: unknown[]
  conclusion: string
  confidence: number
  ambiguities: unknown[]
}

export interface ClaudeDraftResult {
  documentMarkdown: string
  reasoningTrace: ClaudeDraftReasoningTrace
  modelIdentity: string
  rawResponse: string
  // Per-call token usage (a draft is one non-streaming call) so the AI usage &
  // cost view counts drafting spend alongside chat. Always present — drafting
  // always runs on Claude. See AssistantUsage below.
  usage: AssistantUsage
}

// Key precedence: the tenant's Settings-managed key (Vault, via the
// 'anthropic' integration connection) beats the platform-default env var —
// that is the contract the Settings card promises. Resolved per call so a key
// saved or replaced in the UI takes effect on the next draft, no restart.
export async function resolveAnthropicApiKey(
  tenantId: string | null,
): Promise<{ apiKey: string; source: 'connection' | 'env' }> {
  if (tenantId) {
    const conn = await loadConnection<AnthropicSecret>(tenantId, 'anthropic')
    if (conn?.secret.api_key) return { apiKey: conn.secret.api_key, source: 'connection' }
  }
  const envKey = process.env.ANTHROPIC_API_KEY
  if (envKey) return { apiKey: envKey, source: 'env' }
  throw new Error(
    'No Anthropic API key available. Connect Anthropic in Settings → Integrations, ' +
      'or set ANTHROPIC_API_KEY as the platform default.',
  )
}

// Connectivity check used by Settings before persisting a pasted key. Lives
// here so this adapter stays the only place that talks to the Anthropic API.
// Returns null when the key works, otherwise a user-facing error string.
export async function verifyAnthropicKey(apiKey: string): Promise<string | null> {
  const key = apiKey?.trim()
  if (!key) return 'No API key was provided to verify.'
  try {
    const anthropic = makeAnthropic(key)
    await withTransientRetry(
      () =>
        anthropic.messages.create({
          model: TIER_MODEL.haiku,
          max_tokens: 8,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      { label: 'verifyKey' },
    )
    return null
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      const detail = err.message?.trim() ?? ''
      // Anthropic's own API always returns a JSON error body (e.g.
      // "invalid x-api-key" on a bad key). A bodyless response means an
      // intermediary — a proxy or gateway between us and api.anthropic.com —
      // answered instead of Anthropic. Surface that plainly rather than the
      // SDK's cryptic "<status> status code (no body)".
      if (!detail || /status code \(no body\)/i.test(detail)) {
        return (
          `Could not reach Anthropic at ${ANTHROPIC_BASE_URL} ` +
          `(HTTP ${err.status}, empty response). A proxy or gateway is ` +
          `intercepting the request — this 401 is not coming from Anthropic.`
        )
      }
      return `Anthropic returned ${err.status}: ${detail.slice(0, 200)}`
    }
    return err instanceof Error ? err.message : String(err)
  }
}

function isAuthError(err: unknown): boolean {
  return err instanceof Anthropic.APIError && (err.status === 401 || err.status === 403)
}

// Calls Claude with the assembled drafting prompt and parses the response into
// (a) the document markdown and (b) the structured reasoning trace block.
// The prompt instructs Claude to produce both in a specific order; we split
// on the trailing ```json fence.
export async function callClaudeDrafter(
  tenantId: string | null,
  request: ClaudeDraftRequest,
): Promise<ClaudeDraftResult> {
  const { apiKey, source } = await resolveAnthropicApiKey(tenantId)
  const anthropic = makeAnthropic(apiKey)
  const routed = resolveModelForTask(request.task, {
    ...request.signals,
    inputChars: request.signals?.inputChars ?? request.prompt.length,
  })
  console.log(`[claude] task=${request.task} model=${routed.model} — ${routed.reason}`)
  let response: Anthropic.Message
  try {
    response = await withTransientRetry(
      () =>
        anthropic.messages.create({
          model: routed.model,
          max_tokens: request.maxTokens ?? 8000,
          messages: [{ role: 'user', content: request.prompt }],
        }),
      { label: 'draft' },
    )
  } catch (err) {
    throw await toUserFacingError(err, { source, tenantId, apiKey, context: 'Drafting failed' })
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude response contained no text block.')
  }
  const raw = textBlock.text
  const { documentMarkdown, reasoningTrace } = splitDocumentAndTrace(raw)

  const usage = emptyUsage()
  addUsage(usage, response.usage)

  return {
    documentMarkdown,
    reasoningTrace,
    modelIdentity: response.model,
    rawResponse: raw,
    usage,
  }
}

export interface ChatMessage {
  // 'system' is accepted as the FIRST element only — it is lifted to Anthropic's
  // top-level `system` param (the Messages API does not take a system role in
  // the messages array). The remaining turns must be user/assistant.
  role: 'system' | 'user' | 'assistant'
  content: string
}

// "Work rate" — the attorney's combined effort knob in the chat settings, the
// same mechanics Claude itself exposes: higher rate = more reasoning (adaptive
// extended thinking) + a higher `effort` and more output room. Quick keeps it
// snappy with no thinking.
export type WorkRate = 'quick' | 'balanced' | 'thorough'

// A tool the MODEL can deliberately call, executed by US (not Anthropic's
// servers, unlike web_search). The adapter advertises `definition` to the model,
// and when the model calls it, runs `run(input)` and feeds the string result back
// as a tool_result so the model can finish its turn. Used for the assistant's
// log_feedback capability (see assistantChat.ts) — kept generic so other client
// tools can be added later.
export interface ClientTool {
  // Anthropic tool definition ({ name, description, input_schema }). Plain object
  // (the pinned SDK doesn't type custom tools); forwarded verbatim.
  definition: Record<string, unknown>
  name: string
  run: (input: unknown) => Promise<string>
}

export interface AssistantChatOptions {
  model?: string
  workRate?: WorkRate
  // Whether the chosen model supports the effort/adaptive-thinking controls.
  // Opus 4.8 / Sonnet 4.6 do; Haiku 4.5 rejects `effort`, so the caller passes
  // false and we vary only `max_tokens`.
  supportsWorkRate?: boolean
  // Turn on Claude's server-side web_search tool so answers cite live sources.
  webSearch?: boolean
  // Tools the model may call, executed locally via a tool_use → tool_result loop.
  clientTools?: ClientTool[]
  // Per-turn text (live screen capture, current route, live build brief) that
  // changes EVERY turn. It is injected as a LEADING text block of the CURRENT
  // user message — AFTER the conversation history — so its churn can never
  // invalidate the cached history prefix. (It used to ride a second `system`
  // block, which sat BEFORE the messages and re-billed the whole history every
  // turn.) Built ONCE per turn (see buildVolatileClaudeSystem in
  // assistantChat.ts) and reused across every tool-loop round, so the round-to-
  // round cache within a turn survives.
  volatile?: string
}

// Token usage for an assistant turn, summed across every API call the turn made
// (a turn can span several calls: web-search pauses, client-tool loops). Cache
// tokens are tracked separately because they price differently. This is what the
// AI usage/cost view aggregates — recorded on each assistant.turn event.
export interface AssistantUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

function emptyUsage(): AssistantUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }
}

// Fold one API response's usage into the running total. Anthropic's usage fields
// are optional/loosely typed across SDK versions, so read defensively.
function addUsage(acc: AssistantUsage, usage: Anthropic.Message['usage'] | undefined): void {
  if (!usage) return
  const u = usage as {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number | null
    cache_read_input_tokens?: number | null
  }
  acc.inputTokens += u.input_tokens ?? 0
  acc.outputTokens += u.output_tokens ?? 0
  acc.cacheCreationTokens += u.cache_creation_input_tokens ?? 0
  acc.cacheReadTokens += u.cache_read_input_tokens ?? 0
}

// A single piece of a streamed assistant reply. `thinking` carries the model's
// summarized reasoning (shown as a live "thinking" trace), `text` the answer
// itself, and a terminal `citations` chunk the web-search sources (if any).
export type AssistantStreamChunk =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  // The model is generating a TOOL INPUT (e.g. drafting a document body or a
  // questionnaire into a propose_* call). Those deltas are input_json, not text, so
  // without this the stream goes silent for the whole (long) generation — the UI looks
  // frozen and the connection can idle out. Forwarding a throttled `drafting` pulse
  // keeps the SSE warm AND lets the UI show a live "drafting" animation.
  | { type: 'drafting' }
  | { type: 'citations'; citations: string[] }
  // The model invoked a client tool (e.g. load_skill). Surfaced so the UI can
  // show what the assistant is doing — "using NDA review" — while the tool runs.
  | { type: 'tool'; name: string; input: unknown }
  // Terminal chunk carrying the turn's summed token usage (for the AI usage view).
  | { type: 'usage'; usage: AssistantUsage }
  // The tool loop hit MAX_PAUSE_CONTINUATIONS with a client tool_use still pending —
  // the model wanted to keep working but the round cap cut it off. Surfaced (never
  // silent) so the caller can tell the attorney and record an observation.
  | { type: 'tool_cap'; pendingTools: string[] }

// Anthropic's web search server tool. When enabled the model searches the web
// itself and annotates its answer with source URLs (the citation blocks we
// harvest below), giving Claude the same "cites sources" behaviour Perplexity
// has so the chat's web-search toggle works whichever model is selected.
const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }

// Map the attorney's work rate to the request knobs. On models that support it
// (Opus 4.8 / Sonnet 4.6) we use adaptive thinking + the `effort` parameter —
// the current, non-deprecated controls (a fixed `budget_tokens` is rejected on
// these models). On Haiku (no `effort`) we only stretch `max_tokens`.
function workRateParams(
  rate: WorkRate,
  supportsWorkRate: boolean,
): { extra: Record<string, unknown>; maxTokens: number } {
  if (!supportsWorkRate) {
    const maxTokens = rate === 'thorough' ? 3072 : rate === 'balanced' ? 2048 : 1024
    return { extra: {}, maxTokens }
  }
  if (rate === 'quick') {
    // No thinking (omit the field → off on Opus 4.8/4.7) for a fast, direct reply.
    return { extra: { output_config: { effort: 'low' } }, maxTokens: 1024 }
  }
  const effort = rate === 'thorough' ? 'high' : 'medium'
  return {
    extra: {
      output_config: { effort },
      // display:'summarized' surfaces readable reasoning we can stream as the
      // "thinking" animation; the default ('omitted') would stream empty blocks.
      thinking: { type: 'adaptive', display: 'summarized' },
    },
    maxTokens: rate === 'thorough' ? 4096 : 2048,
  }
}

// Build the Messages API request body for an assistant chat turn. Shared by the
// streaming and non-streaming paths so the two stay in lock-step.
//
// NOTE on typing: the pinned @anthropic-ai/sdk (0.32) predates `output_config`,
// adaptive thinking, and the web_search tool, so its param types don't list
// these fields. The SDK forwards the request body verbatim, so we build a plain
// object and assert the param type — the fields are honoured by the live API.
export function buildChatRequest(
  messages: ChatMessage[],
  opts: AssistantChatOptions,
  // Turns carried over from paused (server-tool) or tool_use responses: the
  // assistant's tool-bearing turn plus, for client tools, our tool_result user
  // turn — appended verbatim so the API resumes where it left off.
  carryTurns: Array<{ role: 'assistant' | 'user'; content: unknown }> = [],
): Record<string, unknown> {
  // Lift a leading system turn into the top-level `system` param; everything
  // else is a user/assistant turn. Anthropic requires the first messages[] entry
  // to be 'user', which the post-system turns satisfy.
  //
  // PROMPT CACHING (three breakpoints, prefix-ordered so each is a stable byte
  // prefix of the next):
  //   1. system — large (base prompt + matter context + wizard blocks + skill
  //      catalog) and stable across a conversation AND across a turn's tool
  //      rounds. Marked here.
  //   2. history tail — the LAST block of the LAST history message (every turn
  //      but the current one). This caches the whole conversation-so-far, so
  //      turn N+1 reads system + everything through turn N at ~10% of the input
  //      price. Only added when there IS history.
  //   3. moving tail — see withCacheBreakpoint; the current user message, or the
  //      last carry turn during a tool loop.
  // Volatile per-turn text (opts.volatile — live screen/route/build brief) is
  // injected as a LEADING block of the CURRENT user message, i.e. AFTER the
  // history-tail breakpoint, so its churn can never invalidate the history
  // prefix. It carries NO breakpoint of its own.
  const systemText = messages[0]?.role === 'system' ? messages[0].content : undefined
  const system = systemText
    ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
    : undefined
  const turns: Array<{ role: string; content: unknown }> = messages.filter(
    (m) => m.role !== 'system',
  )
  // History = every turn before the current (last) user message; that last turn
  // is where the volatile block goes. Injecting volatile there keeps history a
  // byte-stable prefix across turns.
  const finalIdx = turns.length - 1
  const built = turns.map((m, i) =>
    i === finalIdx && opts.volatile
      ? { role: m.role, content: prependVolatile(m.content, opts.volatile) }
      : { role: m.role, content: m.content },
  )
  // Breakpoint 2: cache the conversation history so far. Only when a message
  // precedes the current user turn (finalIdx > 0) — never on empty history.
  if (finalIdx > 0) {
    const lastHistory = built[finalIdx - 1]!
    built[finalIdx - 1] = markTail(lastHistory)
  }
  const { extra, maxTokens } = workRateParams(
    opts.workRate ?? 'balanced',
    opts.supportsWorkRate ?? false,
  )
  const tools: unknown[] = []
  if (opts.webSearch) tools.push(WEB_SEARCH_TOOL)
  for (const t of opts.clientTools ?? []) tools.push(t.definition)
  // On a CONTINUATION (after a web-search pause or a client tool_use) we must NOT
  // re-enable adaptive thinking. The carried assistant turn no longer carries a
  // thinking block (we strip it — see stripThinkingBlocks: the pinned SDK 0.32
  // can't round-trip a streamed thinking block's signature, so re-sending one is
  // rejected as "each thinking block must contain thinking"), and with thinking
  // enabled the API would instead demand a thinking block before the tool_use.
  // Dropping `thinking` on the resume satisfies both: no block sent, none
  // expected. The first turn still thinks; only the post-tool wrap-up doesn't.
  const isContinuation = carryTurns.length > 0
  const effectiveExtra = isContinuation ? withoutThinking(extra) : extra
  return {
    // The unified assistant chat (and every other chat-style caller) passes
    // its own resolved model — see the router's chat_turn/chat_client_portal
    // defaults; this is only a safety net for a caller that truly sets none.
    model: opts.model ?? resolveModelForTask('chat_turn').model,
    // Tool loops (web search / client tools) can run several rounds before the
    // final answer; give them headroom on top of the work-rate budget.
    max_tokens: tools.length ? maxTokens + 1024 : maxTokens,
    system,
    messages: withCacheBreakpoint([...built, ...carryTurns]),
    ...(tools.length ? { tools } : {}),
    ...effectiveExtra,
  }
}

// Block types Anthropic accepts cache_control on. A carry turn can end in other
// block types (e.g. server_tool_use mid web-search pause) — marking those 400s,
// so we skip the breakpoint rather than risk the request.
const CACHEABLE_BLOCK_TYPES = new Set(['text', 'tool_use', 'tool_result', 'image', 'document'])

// Prepend the per-turn volatile block as a LEADING text block of a message,
// AHEAD of the real content but with NO cache_control of its own (the moving
// breakpoint below lands on the message's LAST block). A string body becomes a
// two-block array [volatile, userText]; an array body is prefixed in place.
function prependVolatile(content: unknown, volatile: string): unknown {
  const volBlock = { type: 'text', text: volatile }
  if (typeof content === 'string') return [volBlock, { type: 'text', text: content }]
  if (Array.isArray(content)) return [volBlock, ...content]
  // Unexpected shape — keep the volatile in front, coerce the rest to text.
  return [volBlock, { type: 'text', text: String(content ?? '') }]
}

// Return a copy of one message with a cache_control breakpoint on its LAST
// cacheable block. Returns the message UNCHANGED (same reference) when its tail
// block type can't carry a breakpoint, so callers can detect the no-op.
function markTail(msg: { role: string; content: unknown }): { role: string; content: unknown } {
  if (typeof msg.content === 'string' && msg.content) {
    return {
      role: msg.role,
      content: [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }],
    }
  }
  if (Array.isArray(msg.content) && msg.content.length) {
    const blocks = msg.content as Array<Record<string, unknown>>
    const tail = blocks[blocks.length - 1]!
    if (!CACHEABLE_BLOCK_TYPES.has(String(tail.type))) return msg
    return {
      role: msg.role,
      content: [...blocks.slice(0, -1), { ...tail, cache_control: { type: 'ephemeral' } }],
    }
  }
  return msg
}

// Moving prompt-cache breakpoint on the LAST message: within a turn's tool loop
// each round re-sends the identical, growing message list, so marking the tail
// lets round N+1 read everything through round N from cache — that loop is where
// a guided build burns most of its input tokens. Copies rather than mutates, so
// a carried turn never accumulates stale markers across rounds. Combined with
// the stable-system and history-tail breakpoints this keeps us at ≤3 markers,
// under Anthropic's cap of 4.
function withCacheBreakpoint(
  msgs: Array<{ role: string; content: unknown }>,
): Array<{ role: string; content: unknown }> {
  const last = msgs[msgs.length - 1]
  if (!last) return msgs
  const marked = markTail(last)
  if (marked === last) return msgs
  return [...msgs.slice(0, -1), marked]
}

// Drop the `thinking` request param (used on continuation turns — see above).
function withoutThinking(extra: Record<string, unknown>): Record<string, unknown> {
  if (!('thinking' in extra)) return extra
  const { thinking, ...rest } = extra
  void thinking
  return rest
}

// Remove thinking / redacted_thinking blocks from a carried assistant turn before
// re-sending it. Streamed thinking blocks from SDK 0.32 don't round-trip (the
// signature isn't reconstructed), so re-sending them 400s; the model doesn't need
// its prior thinking to act on a tool result or resume a web search.
export function stripThinkingBlocks(content: unknown): unknown {
  if (!Array.isArray(content)) return content
  return (content as Array<Record<string, unknown>>).filter(
    (b) => b?.type !== 'thinking' && b?.type !== 'redacted_thinking',
  )
}

// Extract the model's client-tool calls from a finished message's content.
// Server tools (web_search) surface as `server_tool_use` and are NOT returned
// here — those are handled by Anthropic and resumed via pause_turn. Exported for
// unit testing the tool loop without a live model.
export function clientToolUses(
  content: unknown,
): Array<{ id: string; name: string; input: unknown }> {
  if (!Array.isArray(content)) return []
  return (content as Array<Record<string, unknown>>)
    .filter(
      (b) => b?.type === 'tool_use' && typeof b?.id === 'string' && typeof b?.name === 'string',
    )
    .map((b) => ({ id: b.id as string, name: b.name as string, input: b.input }))
}

// Run the model's client-tool calls and build the tool_result user turn. Every
// tool_use MUST get a tool_result (Anthropic requirement), so unknown tools and
// thrown errors still return an is_error result rather than stalling the turn.
// Exported for unit testing.
export async function runClientTools(
  uses: Array<{ id: string; name: string; input: unknown }>,
  clientTools: ClientTool[],
): Promise<{ role: 'user'; content: unknown }> {
  const results = await Promise.all(
    uses.map(async (u) => {
      const tool = clientTools.find((t) => t.name === u.name)
      try {
        const text = tool ? await tool.run(u.input) : `Unknown tool: ${u.name}`
        return {
          type: 'tool_result',
          tool_use_id: u.id,
          content: text,
          ...(tool ? {} : { is_error: true }),
        }
      } catch (err) {
        return {
          type: 'tool_result',
          tool_use_id: u.id,
          content: `Tool failed: ${err instanceof Error ? err.message : String(err)}`,
          is_error: true,
        }
      }
    }),
  )
  return { role: 'user', content: results }
}

// Pull web-search source URLs out of a finished message: text blocks carry
// `citations` (web_search_result_location), and web_search_tool_result blocks
// carry the raw results. Defensive about shape since the SDK doesn't type them.
function collectCitations(content: unknown): string[] {
  const urls: string[] = []
  const push = (u: unknown) => {
    if (typeof u === 'string' && u && !urls.includes(u)) urls.push(u)
  }
  if (!Array.isArray(content)) return urls
  for (const block of content as Array<Record<string, unknown>>) {
    const citations = block?.citations
    if (Array.isArray(citations)) {
      for (const c of citations as Array<Record<string, unknown>>) push(c?.url)
    }
    if (block?.type === 'web_search_tool_result' && Array.isArray(block?.content)) {
      for (const r of block.content as Array<Record<string, unknown>>) push(r?.url)
    }
  }
  return urls
}

// A web-search turn runs a server-side tool loop; if that loop hits its
// iteration limit the response comes back with stop_reason 'pause_turn' and a
// partial answer. We resume by re-sending the assistant's content verbatim —
// NO extra "continue" user turn, since the trailing server_tool_use block is
// what tells the API to pick up where it left off. Capped so a pathological
// case can't loop forever. 10 (was 4): a guided-build turn legitimately chains
// context reads + a question batch + a propose + a validation retry, which
// overran 4 rounds and silently truncated the step (BUILDER-HARDENING-1 WP5).
const MAX_PAUSE_CONTINUATIONS = 10

// Concatenate the text blocks of a message's content (ignores thinking /
// server-tool blocks). Used to assemble the reply across resumed segments.
function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return (content as Array<{ type?: string; text?: string }>)
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
}

function mergeCitations(into: string[], more: string[]): void {
  for (const c of more) if (!into.includes(c)) into.push(c)
}

// Translate an SDK error into the error to throw. Two jobs: (1) a rejected
// Settings-managed key flips the connection to 'error' (so the integration card
// surfaces it) with a clear, actionable message; (2) EVERY other error is
// humanized — the raw SDK message can be raw API-error JSON (e.g.
// `529 {"type":"error",...}`), which must never reach the UI. Transient errors
// reach here only after retries are exhausted. The raw detail is logged
// (redacted) for diagnosis.
async function toUserFacingError(
  err: unknown,
  opts: {
    source: 'connection' | 'env'
    tenantId: string | null
    apiKey: string
    context: string
  },
): Promise<Error> {
  const { source, tenantId, apiKey, context } = opts
  if (source === 'connection' && tenantId && isAuthError(err)) {
    const msg = redactSecret(err instanceof Error ? err.message : String(err), apiKey)
    await markConnectionError(tenantId, 'anthropic', `${context}: ${msg}`)
    return new Error(
      'Anthropic rejected the connected API key. Replace it in Settings → Integrations.',
    )
  }
  console.error(
    `[claude] ${context}:`,
    redactSecret(err instanceof Error ? err.message : String(err), apiKey),
  )
  return new Error(humanizeAnthropicError(err))
}

// Non-streaming assistant turn returning the reply plus any web-search citations.
// Reuses resolveAnthropicApiKey so the firm's Settings-managed Vault key beats
// the env default. Separate from callClaudeDrafter because this is a lightweight
// chat with no structured-trace contract to parse — the assistant replies in prose.
export async function chatWithAssistantDetailed(
  tenantId: string | null,
  messages: ChatMessage[],
  opts: AssistantChatOptions = {},
): Promise<{ reply: string; citations: string[]; usage: AssistantUsage; toolCapHit: boolean }> {
  const { apiKey, source } = await resolveAnthropicApiKey(tenantId)
  const anthropic = makeAnthropic(apiKey)

  const carryTurns: Array<{ role: 'assistant' | 'user'; content: unknown }> = []
  const citations: string[] = []
  const usage = emptyUsage()
  let reply = ''
  let toolCapHit = false

  for (let i = 0; ; i++) {
    const body = buildChatRequest(messages, opts, carryTurns)
    let response: Anthropic.Message
    try {
      response = await withTransientRetry(
        () =>
          anthropic.messages.create(body as unknown as Anthropic.MessageCreateParamsNonStreaming),
        { label: 'assistant.chat' },
      )
    } catch (err) {
      throw await toUserFacingError(err, {
        source,
        tenantId,
        apiKey,
        context: 'Assistant chat failed',
      })
    }
    // Rounds are separate prose fragments — join with a paragraph break so a
    // post-tool reply never glues mid-sentence onto the framing line (the
    // streaming path has done this since the founder-reported formatting bug;
    // UI-BUILDER-FIX-1 item 8 brings the non-streaming path in line).
    {
      const roundText = extractText(response.content)
      reply = reply && roundText ? `${reply}\n\n${roundText}` : reply + roundText
    }
    addUsage(usage, response.usage)
    mergeCitations(citations, collectCitations(response.content))

    // Resume a paused server-tool (web-search) turn until it finishes.
    const stop = response.stop_reason as string | null
    if (stop === 'pause_turn' && i < MAX_PAUSE_CONTINUATIONS) {
      carryTurns.push({ role: 'assistant', content: stripThinkingBlocks(response.content) })
      continue
    }
    // The model called a client tool (e.g. log_feedback): run it, feed the
    // result back, and let the model finish its turn.
    if (stop === 'tool_use' && (opts.clientTools?.length ?? 0) > 0) {
      const uses = clientToolUses(response.content)
      if (uses.length && i < MAX_PAUSE_CONTINUATIONS) {
        carryTurns.push({ role: 'assistant', content: stripThinkingBlocks(response.content) })
        carryTurns.push(await runClientTools(uses, opts.clientTools!))
        continue
      }
      // Round cap with a tool call still pending: the step the model wanted to run
      // never happens. Flag it so the caller can surface it — never a silent break.
      if (uses.length) toolCapHit = true
    }
    break
  }

  if (!reply) throw new Error('Claude response contained no text block.')
  return { reply, citations, usage, toolCapHit }
}

// Back-compat thin wrapper: prose reply only. Kept for the legacy assistant and
// any caller that doesn't need citations or the work-rate knobs.
export async function chatWithAssistant(
  tenantId: string | null,
  messages: ChatMessage[],
  model?: string,
): Promise<string> {
  const { reply } = await chatWithAssistantDetailed(tenantId, messages, { model })
  return reply
}

// Streaming assistant turn: yields thinking/text deltas as the model produces
// them (token-by-token, the Claude-app feel), then a terminal `citations` chunk.
// Used by the attorney chat's streaming endpoint.
export async function* streamChatWithAssistant(
  tenantId: string | null,
  messages: ChatMessage[],
  opts: AssistantChatOptions = {},
): AsyncGenerator<AssistantStreamChunk> {
  const { apiKey, source } = await resolveAnthropicApiKey(tenantId)
  const anthropic = makeAnthropic(apiKey)

  const carryTurns: Array<{ role: 'assistant' | 'user'; content: unknown }> = []
  const citations: string[] = []
  const usage = emptyUsage()
  // Whether any prose has streamed this turn, and whether the NEXT round's first
  // text delta needs a paragraph break before it. A client-tool round ends one
  // prose fragment and the post-tool reply starts another; without a separator
  // they concatenate mid-sentence ("…services first.No existing…" — founder-
  // reported formatting bug). pause_turn continuations (web search) deliberately
  // do NOT set the flag — their text resumes mid-sentence by design.
  let textEmitted = false
  let needsBreak = false

  for (let i = 0; ; i++) {
    const body = buildChatRequest(messages, opts, carryTurns)
    let final: Anthropic.Message
    // Retry THIS round's stream on transient errors — but only while nothing has
    // yet streamed to the consumer (roundEmitted). Once a delta is out, re-
    // streaming would duplicate it, so a mid-stream failure surfaces instead.
    // In practice a 529/overload happens at connection setup, before any delta,
    // so the exact bug this fixes is retried invisibly. State is preserved: each
    // attempt re-sends the identical `body`; a failed stream ran no client tool
    // (tools run only after finalMessage() succeeds), so retry can't double-fire.
    let roundEmitted = false
    // Throttle the `drafting` pulse: input_json deltas arrive rapidly, so emit one
    // every Nth (≈ one pulse per second of active generation) — enough to keep the
    // connection warm and drive the animation, without flooding the stream.
    const DRAFT_PULSE_EVERY = 6
    for (let attempt = 0; ; attempt++) {
      const stream = anthropic.messages.stream(
        body as unknown as Anthropic.MessageCreateParamsStreaming,
      )
      let draftDeltas = 0
      try {
        for await (const event of stream) {
          if (event.type !== 'content_block_delta') continue
          // SDK 0.32 doesn't type thinking_delta / input_json_delta; read defensively.
          const delta = event.delta as {
            type?: string
            text?: string
            thinking?: string
            partial_json?: string
          }
          if (delta.type === 'text_delta' && delta.text) {
            if (needsBreak) {
              needsBreak = false
              yield { type: 'text', text: '\n\n' }
            }
            textEmitted = true
            roundEmitted = true
            yield { type: 'text', text: delta.text }
          } else if (delta.type === 'thinking_delta' && delta.thinking) {
            roundEmitted = true
            yield { type: 'thinking', text: delta.thinking }
          } else if (delta.type === 'input_json_delta') {
            // The model is building a tool call's input (e.g. a document body). Pulse so
            // the stream isn't silent during a long generation.
            if (draftDeltas % DRAFT_PULSE_EVERY === 0) {
              roundEmitted = true
              yield { type: 'drafting' }
            }
            draftDeltas++
          }
        }
        final = await stream.finalMessage()
        break
      } catch (err) {
        const delay = roundEmitted ? null : retryDelayMs(attempt, err)
        if (delay == null) {
          throw await toUserFacingError(err, {
            source,
            tenantId,
            apiKey,
            context: 'Assistant chat failed',
          })
        }
        console.warn(
          `[claude] transient error on assistant.stream; retry ${attempt + 1}/${RETRY_BACKOFF_MS.length} in ${delay}ms`,
        )
        await defaultSleep(delay)
      }
    }
    addUsage(usage, final.usage)
    mergeCitations(citations, collectCitations(final.content))

    // If a web-search turn paused at the server tool-loop limit, resume it: re-
    // send the partial assistant content (its trailing server_tool_use block
    // tells the API to continue). The next stream's text deltas pick up exactly
    // where this one paused, so the UI keeps appending seamlessly.
    const stop = final.stop_reason as string | null
    if (stop === 'pause_turn' && i < MAX_PAUSE_CONTINUATIONS) {
      carryTurns.push({ role: 'assistant', content: stripThinkingBlocks(final.content) })
      continue
    }
    // The model called a client tool (e.g. log_feedback): run it, feed the result
    // back, and continue — the next stream is the model's post-tool reply, whose
    // text deltas keep flowing to the UI seamlessly.
    if (stop === 'tool_use' && (opts.clientTools?.length ?? 0) > 0) {
      const uses = clientToolUses(final.content)
      if (uses.length && i < MAX_PAUSE_CONTINUATIONS) {
        // Surface each tool call so the UI can show what the assistant is doing
        // (e.g. "using NDA review") before the tool runs and the answer resumes.
        for (const u of uses) yield { type: 'tool', name: u.name, input: u.input }
        carryTurns.push({ role: 'assistant', content: stripThinkingBlocks(final.content) })
        carryTurns.push(await runClientTools(uses, opts.clientTools!))
        // The post-tool reply is a NEW prose fragment — separate it from whatever
        // streamed before the tool call (see needsBreak above).
        if (textEmitted) needsBreak = true
        continue
      }
      // Round cap with a tool call still pending — surface it (never a silent
      // break) so the caller can tell the attorney and record an observation.
      if (uses.length) yield { type: 'tool_cap', pendingTools: uses.map((u) => u.name) }
    }
    break
  }

  if (citations.length) yield { type: 'citations', citations }
  // Terminal usage chunk so the streaming caller can record token cost.
  yield { type: 'usage', usage }
}

function splitDocumentAndTrace(raw: string): {
  documentMarkdown: string
  reasoningTrace: ClaudeDraftReasoningTrace
} {
  // BACKHALF-BLOCKS-1 WP5 — TOLERANT parse (defense in depth). A drafting prompt that
  // never instructed the model to emit the fenced ```json trace used to THROW here,
  // dead-lettering every ai_draft on that service (the Jun 20 → Jul 9 outage). Prompt
  // save now auto-appends the trace contract (services.validateDraftingPrompt), but a
  // legacy/hand-run prompt might still lack it — so a MISSING or UNPARSEABLE trace no
  // longer fails the draft: the whole response is the document and the trace defaults
  // to an empty-evidence trace. The document still drafts; the trace is just thin.
  const jsonFenceMatch = raw.match(/```json\s*\n([\s\S]*?)\n```/)
  const emptyTrace = (): ClaudeDraftReasoningTrace => ({
    evidence: [],
    alternatives_considered: [],
    conclusion:
      'Draft produced without a structured reasoning trace (prompt omitted the trace contract).',
    confidence: 0.5,
    ambiguities: [],
  })
  if (!jsonFenceMatch || !jsonFenceMatch[1]) {
    return { documentMarkdown: raw.trimEnd(), reasoningTrace: emptyTrace() }
  }

  const traceJson = jsonFenceMatch[1]
  let parsed: ClaudeDraftReasoningTrace
  try {
    parsed = JSON.parse(traceJson) as ClaudeDraftReasoningTrace
    if (!Array.isArray(parsed.evidence)) parsed.evidence = []
  } catch {
    // Unparseable trace → keep the document, fall back to an empty-evidence trace.
    return {
      documentMarkdown: raw.replace(/```json[\s\S]*$/, '').trimEnd(),
      reasoningTrace: emptyTrace(),
    }
  }

  // Document is everything before the first ```json fence, with the trailing
  // horizontal rule trimmed if present.
  const fenceStart = raw.indexOf('```json')
  const before = raw.slice(0, fenceStart).trimEnd()
  const documentMarkdown = before.replace(/\n---\s*$/m, '').trimEnd()

  return { documentMarkdown, reasoningTrace: parsed }
}
