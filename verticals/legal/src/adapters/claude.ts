import Anthropic from '@anthropic-ai/sdk'
import { loadConnection, markConnectionError } from './connectionStore.js'
import { redactSecret } from './redact.js'

// Default to a current Claude 4.x model; allow override via env so we can pin
// a specific model for evaluation or use the latest as Anthropic publishes new
// versions.
const DEFAULT_MODEL = process.env.LEGAL_DRAFTING_MODEL ?? 'claude-sonnet-4-6'

// Every Anthropic client in this adapter is constructed here so they all hit the
// same endpoint. We pin baseURL to Anthropic's real API on purpose: the SDK
// otherwise silently honors an ANTHROPIC_BASE_URL env var, and a stray or
// misconfigured value in the deployment (e.g. a leftover LLM-gateway URL)
// redirects every request and returns opaque bodyless 401s — which is exactly
// what broke key verification in Settings on the deployed site. If a deliberate
// proxy is ever needed, set it here intentionally rather than via the environment.
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com'

function makeAnthropic(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, baseURL: ANTHROPIC_BASE_URL })
}

type AnthropicSecret = { api_key: string }

export interface ClaudeDraftRequest {
  prompt: string
  maxTokens?: number
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
    await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    })
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
  let response: Anthropic.Message
  try {
    response = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: request.maxTokens ?? 8000,
      messages: [{ role: 'user', content: request.prompt }],
    })
  } catch (err) {
    // A rejected Settings-managed key flips the connection to 'error' so the
    // integration card surfaces the broken sync instead of failing silently
    // in the worker log.
    if (source === 'connection' && tenantId && isAuthError(err)) {
      const msg = redactSecret(err instanceof Error ? err.message : String(err), apiKey)
      await markConnectionError(tenantId, 'anthropic', `Drafting failed: ${msg}`)
      throw new Error(
        'Anthropic rejected the connected API key. Replace it in Settings → Integrations.',
      )
    }
    throw err
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude response contained no text block.')
  }
  const raw = textBlock.text
  const { documentMarkdown, reasoningTrace } = splitDocumentAndTrace(raw)

  return {
    documentMarkdown,
    reasoningTrace,
    modelIdentity: response.model,
    rawResponse: raw,
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
}

// A single piece of a streamed assistant reply. `thinking` carries the model's
// summarized reasoning (shown as a live "thinking" trace), `text` the answer
// itself, and a terminal `citations` chunk the web-search sources (if any).
export type AssistantStreamChunk =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'citations'; citations: string[] }

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
  const system = messages[0]?.role === 'system' ? messages[0].content : undefined
  const turns = messages.filter((m) => m.role !== 'system')
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
    // The unified assistant chat passes the attorney's chosen Claude model;
    // fall back to the firm default when none is specified.
    model: opts.model ?? DEFAULT_MODEL,
    // Tool loops (web search / client tools) can run several rounds before the
    // final answer; give them headroom on top of the work-rate budget.
    max_tokens: tools.length ? maxTokens + 1024 : maxTokens,
    system,
    messages: [...turns, ...carryTurns],
    ...(tools.length ? { tools } : {}),
    ...effectiveExtra,
  }
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
// case can't loop forever.
const MAX_PAUSE_CONTINUATIONS = 4

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

// Translate an SDK error into the error to throw: a rejected Settings-managed
// key flips the connection to 'error' (so the integration card surfaces it)
// and reports a clear, actionable message; anything else is rethrown as-is.
async function assistantAuthError(
  err: unknown,
  source: 'connection' | 'env',
  tenantId: string | null,
  apiKey: string,
): Promise<Error> {
  if (source === 'connection' && tenantId && isAuthError(err)) {
    const msg = redactSecret(err instanceof Error ? err.message : String(err), apiKey)
    await markConnectionError(tenantId, 'anthropic', `Assistant chat failed: ${msg}`)
    return new Error(
      'Anthropic rejected the connected API key. Replace it in Settings → Integrations.',
    )
  }
  return err instanceof Error ? err : new Error(String(err))
}

// Non-streaming assistant turn returning the reply plus any web-search citations.
// Reuses resolveAnthropicApiKey so the firm's Settings-managed Vault key beats
// the env default. Separate from callClaudeDrafter because this is a lightweight
// chat with no structured-trace contract to parse — the assistant replies in prose.
export async function chatWithAssistantDetailed(
  tenantId: string | null,
  messages: ChatMessage[],
  opts: AssistantChatOptions = {},
): Promise<{ reply: string; citations: string[] }> {
  const { apiKey, source } = await resolveAnthropicApiKey(tenantId)
  const anthropic = makeAnthropic(apiKey)

  const carryTurns: Array<{ role: 'assistant' | 'user'; content: unknown }> = []
  const citations: string[] = []
  let reply = ''

  for (let i = 0; ; i++) {
    const body = buildChatRequest(messages, opts, carryTurns)
    let response: Anthropic.Message
    try {
      response = await anthropic.messages.create(
        body as unknown as Anthropic.MessageCreateParamsNonStreaming,
      )
    } catch (err) {
      throw await assistantAuthError(err, source, tenantId, apiKey)
    }
    reply += extractText(response.content)
    mergeCitations(citations, collectCitations(response.content))

    // Resume a paused server-tool (web-search) turn until it finishes.
    const stop = response.stop_reason as string | null
    if (stop === 'pause_turn' && i < MAX_PAUSE_CONTINUATIONS) {
      carryTurns.push({ role: 'assistant', content: stripThinkingBlocks(response.content) })
      continue
    }
    // The model called a client tool (e.g. log_feedback): run it, feed the
    // result back, and let the model finish its turn.
    if (stop === 'tool_use' && i < MAX_PAUSE_CONTINUATIONS && (opts.clientTools?.length ?? 0) > 0) {
      const uses = clientToolUses(response.content)
      if (uses.length) {
        carryTurns.push({ role: 'assistant', content: stripThinkingBlocks(response.content) })
        carryTurns.push(await runClientTools(uses, opts.clientTools!))
        continue
      }
    }
    break
  }

  if (!reply) throw new Error('Claude response contained no text block.')
  return { reply, citations }
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

  for (let i = 0; ; i++) {
    const body = buildChatRequest(messages, opts, carryTurns)
    const stream = anthropic.messages.stream(
      body as unknown as Anthropic.MessageCreateParamsStreaming,
    )
    let final: Anthropic.Message
    try {
      for await (const event of stream) {
        if (event.type !== 'content_block_delta') continue
        // SDK 0.32 doesn't type thinking_delta; read defensively.
        const delta = event.delta as { type?: string; text?: string; thinking?: string }
        if (delta.type === 'text_delta' && delta.text) {
          yield { type: 'text', text: delta.text }
        } else if (delta.type === 'thinking_delta' && delta.thinking) {
          yield { type: 'thinking', text: delta.thinking }
        }
      }
      final = await stream.finalMessage()
    } catch (err) {
      throw await assistantAuthError(err, source, tenantId, apiKey)
    }
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
    if (stop === 'tool_use' && i < MAX_PAUSE_CONTINUATIONS && (opts.clientTools?.length ?? 0) > 0) {
      const uses = clientToolUses(final.content)
      if (uses.length) {
        carryTurns.push({ role: 'assistant', content: stripThinkingBlocks(final.content) })
        carryTurns.push(await runClientTools(uses, opts.clientTools!))
        continue
      }
    }
    break
  }

  if (citations.length) yield { type: 'citations', citations }
}

function splitDocumentAndTrace(raw: string): {
  documentMarkdown: string
  reasoningTrace: ClaudeDraftReasoningTrace
} {
  const jsonFenceMatch = raw.match(/```json\s*\n([\s\S]*?)\n```/)
  if (!jsonFenceMatch || !jsonFenceMatch[1]) {
    throw new Error(
      'Claude response did not include a fenced ```json reasoning trace block. ' +
        'Check the drafting prompt and rerun.',
    )
  }

  const traceJson = jsonFenceMatch[1]
  let parsed: ClaudeDraftReasoningTrace
  try {
    parsed = JSON.parse(traceJson) as ClaudeDraftReasoningTrace
  } catch (error) {
    throw new Error(
      `Failed to parse reasoning trace JSON from Claude response: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  // Document is everything before the first ```json fence, with the trailing
  // horizontal rule trimmed if present.
  const fenceStart = raw.indexOf('```json')
  const before = raw.slice(0, fenceStart).trimEnd()
  const documentMarkdown = before.replace(/\n---\s*$/m, '').trimEnd()

  return { documentMarkdown, reasoningTrace: parsed }
}
