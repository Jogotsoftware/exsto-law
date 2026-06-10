import Anthropic from '@anthropic-ai/sdk'

// Default to a current Claude 4.x model; allow override via env so we can pin
// a specific model for evaluation or use the latest as Anthropic publishes new
// versions.
const DEFAULT_MODEL = process.env.LEGAL_DRAFTING_MODEL ?? 'claude-sonnet-4-6'

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

let client: Anthropic | undefined

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is required for the legal drafting adapter. ' +
          'Set it in .env.local for local runs or via the worker env in deployment.',
      )
    }
    client = new Anthropic({ apiKey })
  }
  return client
}

// Calls Claude with the assembled drafting prompt and parses the response into
// (a) the document markdown and (b) the structured reasoning trace block.
// The prompt instructs Claude to produce both in a specific order; we split
// on the trailing ```json fence.
export async function callClaudeDrafter(request: ClaudeDraftRequest): Promise<ClaudeDraftResult> {
  const anthropic = getClient()
  const response = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: request.maxTokens ?? 8000,
    messages: [{ role: 'user', content: request.prompt }],
  })

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
