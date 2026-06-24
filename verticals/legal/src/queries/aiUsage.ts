import { withActionContext, type ActionContext } from '@exsto/substrate'

// AI usage & cost read layer. Every Claude assistant.turn event records its token
// usage in the payload (see recordAssistantTurn); this aggregates those events
// into a firm-wide usage + estimated-cost summary for the Settings → AI usage tab.
//
// Cost is an ESTIMATE for display only. Prices are Anthropic public list prices
// (USD per 1,000,000 tokens) as of mid-2026 — edit PRICE_BY_FAMILY if they change.
// Matched by model FAMILY (substring) so a version-snapshot bump (e.g. a new Haiku
// build) keeps pricing without a code change. Perplexity turns don't report token
// usage, so they never appear here.

interface ModelPrice {
  inputPer1M: number
  outputPer1M: number
  // Writing to / reading from the prompt cache price differently from fresh input.
  cacheWritePer1M: number
  cacheReadPer1M: number
}

const PRICE_BY_FAMILY: Array<{ match: RegExp; price: ModelPrice }> = [
  {
    // Opus 4.x list price: $5/$25 per 1M (cache write 1.25x input, read 0.1x).
    match: /opus/i,
    price: { inputPer1M: 5, outputPer1M: 25, cacheWritePer1M: 6.25, cacheReadPer1M: 0.5 },
  },
  {
    match: /sonnet/i,
    price: { inputPer1M: 3, outputPer1M: 15, cacheWritePer1M: 3.75, cacheReadPer1M: 0.3 },
  },
  {
    match: /haiku/i,
    price: { inputPer1M: 1, outputPer1M: 5, cacheWritePer1M: 1.25, cacheReadPer1M: 0.1 },
  },
  {
    match: /fable/i,
    price: { inputPer1M: 10, outputPer1M: 50, cacheWritePer1M: 12.5, cacheReadPer1M: 1 },
  },
]

function priceFor(model: string): ModelPrice | null {
  return PRICE_BY_FAMILY.find((p) => p.match.test(model))?.price ?? null
}

interface TokenCounts {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

function costOf(price: ModelPrice | null, t: TokenCounts): number | null {
  if (!price) return null
  return (
    (t.inputTokens / 1e6) * price.inputPer1M +
    (t.outputTokens / 1e6) * price.outputPer1M +
    (t.cacheCreationTokens / 1e6) * price.cacheWritePer1M +
    (t.cacheReadTokens / 1e6) * price.cacheReadPer1M
  )
}

export interface AiUsageModelRow extends TokenCounts {
  model: string
  turns: number
  // null when the model isn't in the price table (cost can't be estimated).
  estimatedCostUsd: number | null
}

export interface AiUsageDayRow {
  day: string // YYYY-MM-DD
  turns: number
  totalTokens: number
  estimatedCostUsd: number
}

// Where the spend came from: the chat assistant (assistant.turn events) vs
// document drafting (draft.generate events). Each is instrumented separately and
// counts from when its tracking went live.
export type AiUsageSource = 'chat' | 'drafting'

export interface AiUsageSourceRow extends TokenCounts {
  source: AiUsageSource
  turns: number
  estimatedCostUsd: number
}

export interface AiUsageSummary {
  sinceDays: number
  totalTurns: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheCreationTokens: number
  totalCacheReadTokens: number
  estimatedCostUsd: number
  // Fraction of turns (0..1) whose model had a price — so the UI can flag when some
  // usage is uncosted (an unrecognized model slips the estimate).
  pricedCoverage: number
  byModel: AiUsageModelRow[]
  bySource: AiUsageSourceRow[]
  byDay: AiUsageDayRow[]
}

// assistant.turn → chat, draft.generate → drafting. Both carry the same snake_case
// usage object in their payload.
const SOURCE_BY_KIND: Record<string, AiUsageSource> = {
  'assistant.turn': 'chat',
  'draft.generate': 'drafting',
}

interface UsageEventRow {
  kind: string
  model: string | null
  usage: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_tokens?: number
    cache_read_tokens?: number
  } | null
  day: string
}

// Firm-wide AI token usage + estimated cost over the trailing `sinceDays` window
// (default 30, clamped 1..365), broken down by model, by source (chat vs
// drafting), and by day. Reads the Claude assistant.turn (chat) and draft.generate
// (drafting) events that carry a usage object (`payload->>'usage'` is a JSON object
// — json-null and pre-instrumentation events are excluded). Drafting uses
// model_identity for the model; chat uses model — COALESCE picks whichever is set.
export async function getAiUsageSummary(
  ctx: ActionContext,
  opts: { sinceDays?: number } = {},
): Promise<AiUsageSummary> {
  const days = Math.min(Math.max(Math.floor(opts.sinceDays ?? 30) || 30, 1), 365)

  const rows = await withActionContext(ctx, async (client) => {
    const res = await client.query<UsageEventRow>(
      `SELECT ekd.kind_name AS kind,
              COALESCE(e.payload->>'model', e.payload->>'model_identity') AS model,
              e.payload->'usage' AS usage,
              to_char(e.occurred_at, 'YYYY-MM-DD') AS day
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       WHERE e.tenant_id = $1
         AND ekd.kind_name IN ('assistant.turn', 'draft.generate')
         AND e.payload->>'usage' IS NOT NULL
         AND e.occurred_at >= now() - make_interval(days => $2)
       ORDER BY e.occurred_at ASC`,
      [ctx.tenantId, days],
    )
    return res.rows
  })

  const totals: TokenCounts = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  }
  let totalTurns = 0
  let estimatedCostUsd = 0
  let pricedTurns = 0
  const byModel = new Map<string, AiUsageModelRow>()
  const bySource = new Map<AiUsageSource, AiUsageSourceRow>()
  const byDay = new Map<string, AiUsageDayRow>()

  for (const r of rows) {
    const model = r.model ?? 'unknown'
    const t: TokenCounts = {
      inputTokens: r.usage?.input_tokens ?? 0,
      outputTokens: r.usage?.output_tokens ?? 0,
      cacheCreationTokens: r.usage?.cache_creation_tokens ?? 0,
      cacheReadTokens: r.usage?.cache_read_tokens ?? 0,
    }
    const price = priceFor(model)
    const cost = costOf(price, t)
    const rowTokens = t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens

    totalTurns += 1
    totals.inputTokens += t.inputTokens
    totals.outputTokens += t.outputTokens
    totals.cacheCreationTokens += t.cacheCreationTokens
    totals.cacheReadTokens += t.cacheReadTokens
    if (cost !== null) {
      estimatedCostUsd += cost
      pricedTurns += 1
    }

    const m = byModel.get(model) ?? {
      model,
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      estimatedCostUsd: price ? 0 : null,
    }
    m.turns += 1
    m.inputTokens += t.inputTokens
    m.outputTokens += t.outputTokens
    m.cacheCreationTokens += t.cacheCreationTokens
    m.cacheReadTokens += t.cacheReadTokens
    if (cost !== null) m.estimatedCostUsd = (m.estimatedCostUsd ?? 0) + cost
    byModel.set(model, m)

    const d = byDay.get(r.day) ?? { day: r.day, turns: 0, totalTokens: 0, estimatedCostUsd: 0 }
    d.turns += 1
    d.totalTokens += rowTokens
    d.estimatedCostUsd += cost ?? 0
    byDay.set(r.day, d)

    const source = SOURCE_BY_KIND[r.kind] ?? 'chat'
    const s = bySource.get(source) ?? {
      source,
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      estimatedCostUsd: 0,
    }
    s.turns += 1
    s.inputTokens += t.inputTokens
    s.outputTokens += t.outputTokens
    s.cacheCreationTokens += t.cacheCreationTokens
    s.cacheReadTokens += t.cacheReadTokens
    s.estimatedCostUsd += cost ?? 0
    bySource.set(source, s)
  }

  // Round money to cents to avoid float dust leaking into the UI.
  const round2 = (n: number) => Math.round(n * 100) / 100
  for (const m of byModel.values())
    if (m.estimatedCostUsd !== null) m.estimatedCostUsd = round2(m.estimatedCostUsd)
  for (const s of bySource.values()) s.estimatedCostUsd = round2(s.estimatedCostUsd)
  for (const d of byDay.values()) d.estimatedCostUsd = round2(d.estimatedCostUsd)

  return {
    sinceDays: days,
    totalTurns,
    totalInputTokens: totals.inputTokens,
    totalOutputTokens: totals.outputTokens,
    totalCacheCreationTokens: totals.cacheCreationTokens,
    totalCacheReadTokens: totals.cacheReadTokens,
    estimatedCostUsd: round2(estimatedCostUsd),
    pricedCoverage: totalTurns ? pricedTurns / totalTurns : 1,
    byModel: [...byModel.values()].sort(
      (a, b) => (b.estimatedCostUsd ?? 0) - (a.estimatedCostUsd ?? 0),
    ),
    bySource: [...bySource.values()].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd),
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
  }
}
