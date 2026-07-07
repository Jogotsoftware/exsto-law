'use client'

// AI usage & cost (Settings → AI usage). A firm-wide view of how much AI is used
// and what it roughly costs, read from the token usage recorded on Claude
// assistant.turn (chat) and draft.generate (document drafting) events
// (legal.assistant.usage), broken down by source. Cost is an ESTIMATE from list
// prices; Perplexity research turns don't report tokens, so they're not counted.
// Each source counts only from when its token instrumentation went live.
import { useCallback, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { CollapsibleSection } from '@/components/CollapsibleSection'

interface ModelRow {
  model: string
  turns: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  estimatedCostUsd: number | null
}
interface DayRow {
  day: string
  turns: number
  totalTokens: number
  estimatedCostUsd: number
}
interface SourceRow {
  source: 'chat' | 'drafting'
  turns: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  estimatedCostUsd: number
}
interface UsageSummary {
  sinceDays: number
  totalTurns: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheCreationTokens: number
  totalCacheReadTokens: number
  estimatedCostUsd: number
  pricedCoverage: number
  byModel: ModelRow[]
  bySource: SourceRow[]
  byDay: DayRow[]
}

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
]

const fmtInt = (n: number) => n.toLocaleString('en-US')
const fmtUsd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtTokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}k`
      : String(n)

function humanModel(model: string): string {
  if (/opus/i.test(model)) return 'Claude Opus'
  if (/sonnet/i.test(model)) return 'Claude Sonnet'
  if (/haiku/i.test(model)) return 'Claude Haiku'
  if (/fable/i.test(model)) return 'Claude Fable'
  return model
}

function humanSource(source: string): string {
  if (source === 'chat') return 'Chat assistant'
  if (source === 'drafting') return 'Document drafting'
  return source
}

export function AiUsageSection() {
  const [windowDays, setWindowDays] = useState(30)
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (days: number) => {
    setLoading(true)
    setError(null)
    try {
      const r = await callAttorneyMcp<UsageSummary>({
        toolName: 'legal.assistant.usage',
        input: { sinceDays: days },
      })
      setSummary(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(windowDays)
  }, [windowDays, load])

  const maxDayCost = summary ? Math.max(0.0001, ...summary.byDay.map((d) => d.estimatedCostUsd)) : 1
  const totalTokens = summary
    ? summary.totalInputTokens +
      summary.totalOutputTokens +
      summary.totalCacheCreationTokens +
      summary.totalCacheReadTokens
    : 0

  return (
    <CollapsibleSection title="AI usage & cost">
      <div style={{ display: 'flex', gap: 4, margin: '0.4rem 0 1rem' }}>
        {WINDOWS.map((w) => {
          const active = w.days === windowDays
          return (
            <button
              key={w.days}
              type="button"
              className={active ? 'primary' : undefined}
              onClick={() => setWindowDays(w.days)}
            >
              {w.label}
            </button>
          )
        })}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && !summary ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      ) : summary ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '0.8rem',
              marginBottom: '1.2rem',
            }}
          >
            <StatCard
              label={`Estimated cost · ${summary.sinceDays}d`}
              value={fmtUsd(summary.estimatedCostUsd)}
              accent
            />
            <StatCard
              label="Total tokens"
              value={fmtTokens(totalTokens)}
              sub={`${fmtInt(totalTokens)} tokens`}
            />
            <StatCard label="Assistant turns" value={fmtInt(summary.totalTurns)} />
          </div>

          {summary.totalTurns === 0 && (
            <p className="text-muted">
              No AI usage recorded in this window yet. Usage accrues from when token tracking went
              live — earlier conversations aren&rsquo;t counted.
            </p>
          )}

          {summary.pricedCoverage < 1 && summary.totalTurns > 0 && (
            <div
              className="alert"
              style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}
            >
              Cost shown for {Math.round(summary.pricedCoverage * 100)}% of turns — some usage is on
              a model without a price in the estimate table.
            </div>
          )}

          {summary.bySource.length > 0 && (
            <section style={{ marginBottom: '1.4rem' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>By source</h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th style={{ textAlign: 'right' }}>Turns</th>
                      <th style={{ textAlign: 'right' }}>Input</th>
                      <th style={{ textAlign: 'right' }}>Output</th>
                      <th style={{ textAlign: 'right' }}>Est. cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.bySource.map((s) => (
                      <tr key={s.source}>
                        <td>{humanSource(s.source)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtInt(s.turns)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtTokens(s.inputTokens)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtTokens(s.outputTokens)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {fmtUsd(s.estimatedCostUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {summary.byModel.length > 0 && (
            <section style={{ marginBottom: '1.4rem' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>By model</h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th style={{ textAlign: 'right' }}>Turns</th>
                      <th style={{ textAlign: 'right' }}>Input</th>
                      <th style={{ textAlign: 'right' }}>Output</th>
                      <th style={{ textAlign: 'right' }}>Cache read</th>
                      <th style={{ textAlign: 'right' }}>Est. cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byModel.map((m) => (
                      <tr key={m.model}>
                        <td title={m.model}>{humanModel(m.model)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtInt(m.turns)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtTokens(m.inputTokens)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtTokens(m.outputTokens)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtTokens(m.cacheReadTokens)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {m.estimatedCostUsd === null ? '—' : fmtUsd(m.estimatedCostUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {summary.byDay.length > 0 && (
            <section style={{ marginBottom: '1.2rem' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>By day</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {summary.byDay.map((d) => (
                  <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ width: 92, fontSize: '0.8rem', color: 'var(--muted)' }}>
                      {d.day}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: 14,
                        background: 'var(--surface-2, #f1f5f9)',
                        borderRadius: 4,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(2, (d.estimatedCostUsd / maxDayCost) * 100)}%`,
                          height: '100%',
                          background: 'var(--accent, #1b2a41)',
                          opacity: 0.85,
                        }}
                      />
                    </div>
                    <span style={{ width: 70, textAlign: 'right', fontSize: '0.8rem' }}>
                      {fmtUsd(d.estimatedCostUsd)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <p className="text-muted" style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
            Cost is an estimate from published list prices (input, output, and prompt-cache tokens),
            not your actual Anthropic invoice. Covers the chat assistant and document drafting;
            Perplexity research turns aren&rsquo;t counted (that provider doesn&rsquo;t report token
            usage). Each source counts only from when its token tracking went live, so older
            activity &mdash; and any drafting before this release &mdash; isn&rsquo;t included.
          </p>
        </>
      ) : null}
    </CollapsibleSection>
  )
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <div
      style={{
        padding: '0.9rem 1rem',
        border: '1px solid var(--border, #e3e8ef)',
        borderRadius: 8,
        background: accent ? 'var(--accent, #1b2a41)' : 'var(--surface, #fff)',
        color: accent ? '#fff' : 'inherit',
      }}
    >
      <div style={{ fontSize: '0.78rem', opacity: 0.8 }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.74rem', opacity: 0.7, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
