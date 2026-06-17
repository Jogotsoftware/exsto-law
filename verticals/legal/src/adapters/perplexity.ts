// Perplexity research adapter — the ONLY place that talks to the Perplexity
// API (vertical rule, mirroring the Claude adapter). Key precedence matches
// drafting: the tenant's Settings-managed key (Vault) beats the
// PERPLEXITY_API_KEY platform default, resolved per call so a key saved or
// replaced in the UI takes effect immediately.
import { loadConnection, markConnectionError } from './connectionStore.js'
import { redactSecret } from './redact.js'

type PerplexitySecret = { api_key: string }

const DEFAULT_MODEL = process.env.LEGAL_RESEARCH_MODEL ?? 'sonar'

export interface ResearchRequest {
  question: string
  // Optional short, non-confidential framing (e.g. jurisdiction). Matter PII is
  // deliberately NOT sent — the matter scopes WHERE the answer is recorded, not
  // what leaves the firm.
  context?: string
  maxTokens?: number
  // The attorney's chosen Perplexity model from the unified assistant chat.
  // Falls back to the firm default when omitted.
  model?: string
}

export interface ResearchResult {
  answer: string
  citations: string[]
  model: string
}

// Connectivity check used by Settings before persisting a pasted key. Lives
// here so this adapter stays the only place that talks to the Perplexity API
// (matches verifyAnthropicKey in the claude adapter). Returns null when the key
// works, otherwise a user-facing error string with the key scrubbed.
export async function verifyPerplexityKey(apiKey: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    })
    if (!res.ok) {
      const body = redactSecret((await res.text().catch(() => '')).slice(0, 200), apiKey)
      return `Perplexity returned ${res.status}: ${body}`
    }
    return null
  } catch (err) {
    return redactSecret(err instanceof Error ? err.message : String(err), apiKey)
  }
}

export async function resolvePerplexityApiKey(
  tenantId: string | null,
): Promise<{ apiKey: string; source: 'connection' | 'env' }> {
  if (tenantId) {
    const conn = await loadConnection<PerplexitySecret>(tenantId, 'perplexity')
    if (conn?.secret.api_key) return { apiKey: conn.secret.api_key, source: 'connection' }
  }
  const envKey = process.env.PERPLEXITY_API_KEY
  if (envKey) return { apiKey: envKey, source: 'env' }
  throw new Error(
    'No Perplexity API key available. Connect Perplexity in Settings → Integrations ' +
      'to enable research, or set PERPLEXITY_API_KEY as the platform default.',
  )
}

interface PerplexityResponse {
  choices?: Array<{ message?: { content?: string } }>
  citations?: string[]
  search_results?: Array<{ url?: string }>
}

// Low-level call. `apiKey` is passed in (resolved by the caller) so this stays
// a pure HTTP shim. Throws on a non-OK response with the key scrubbed from any
// echoed body.
export async function callPerplexity(
  apiKey: string,
  request: ResearchRequest,
): Promise<ResearchResult> {
  const system =
    'You are a legal research assistant for a U.S. law firm. Answer precisely, ' +
    'cite primary sources (statutes, regulations, case law) where possible, and ' +
    'flag when something is jurisdiction-specific or uncertain. Do not give a ' +
    'final legal opinion; support the attorney’s own judgment.'
  const user = request.context ? `${request.context}\n\n${request.question}` : request.question
  const model = request.model ?? DEFAULT_MODEL

  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: request.maxTokens ?? 1024,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })

  if (!res.ok) {
    const body = redactSecret((await res.text().catch(() => '')).slice(0, 300), apiKey)
    const err = new Error(`Perplexity returned ${res.status}: ${body}`)
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }

  const data = (await res.json()) as PerplexityResponse
  const answer = data.choices?.[0]?.message?.content?.trim() ?? ''
  const citations =
    data.citations ?? data.search_results?.map((s) => s.url).filter((u): u is string => !!u) ?? []
  if (!answer) throw new Error('Perplexity returned an empty answer.')
  return { answer, citations, model }
}

// Resolve the key, call Perplexity, and on an auth failure with a connected key
// flip the connection to 'error' (with the key scrubbed) so the Settings card
// surfaces the broken integration instead of failing silently.
export async function runPerplexityResearch(
  tenantId: string | null,
  request: ResearchRequest,
): Promise<ResearchResult> {
  const { apiKey, source } = await resolvePerplexityApiKey(tenantId)
  try {
    return await callPerplexity(apiKey, request)
  } catch (err) {
    const status = (err as { status?: number }).status
    if (source === 'connection' && tenantId && (status === 401 || status === 403)) {
      const msg = redactSecret(err instanceof Error ? err.message : String(err), apiKey)
      await markConnectionError(tenantId, 'perplexity', `Research failed: ${msg}`)
      throw new Error(
        'Perplexity rejected the connected API key. Replace it in Settings → Integrations.',
      )
    }
    throw err
  }
}
