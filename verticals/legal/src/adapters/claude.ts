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

// Plain conversational turn against Claude for the in-app assistant. Separate
// from callClaudeDrafter because this is a lightweight chat (system + history +
// user) with no structured-trace contract to parse — the assistant just replies
// in prose. Reuses resolveAnthropicApiKey so the firm's Settings-managed Vault
// key beats the env default, and mirrors callClaudeDrafter's connection-auth
// error handling so a rejected key flips the integration card to 'error'.
export async function chatWithAssistant(
  tenantId: string | null,
  messages: ChatMessage[],
  model?: string,
): Promise<string> {
  const { apiKey, source } = await resolveAnthropicApiKey(tenantId)
  const anthropic = makeAnthropic(apiKey)

  // Lift a leading system turn into the top-level `system` param; everything
  // else is a user/assistant turn. Anthropic requires the first messages[] entry
  // to be 'user', which the post-system turns satisfy.
  const system = messages[0]?.role === 'system' ? messages[0].content : undefined
  const turns = messages.filter((m) => m.role !== 'system') as Array<{
    role: 'user' | 'assistant'
    content: string
  }>

  let response: Anthropic.Message
  try {
    response = await anthropic.messages.create({
      // The unified assistant chat passes the attorney's chosen Claude model;
      // fall back to the firm default when none is specified.
      model: model ?? DEFAULT_MODEL,
      max_tokens: 1024,
      system,
      messages: turns,
    })
  } catch (err) {
    if (source === 'connection' && tenantId && isAuthError(err)) {
      const msg = redactSecret(err instanceof Error ? err.message : String(err), apiKey)
      await markConnectionError(tenantId, 'anthropic', `Assistant chat failed: ${msg}`)
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
  return textBlock.text
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
