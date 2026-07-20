'use client'

// Settings → AI usage (WP-G). Split out of the old settings monolith — same
// legal.assistant.usage tool, restyled to the comp's stat cards + daily bar
// chart + table language. Keeps the app's richer 7/30/90-day window picker
// and By-source/By-model breakdown (the comp hardcodes a fixed "this month"
// with a single by-model table) — no capability dropped.
import { useCallback, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { SettingsHeader, SettingsLoading, SettingsAlert } from '../shared'
import { Tabs, type TabSpec } from '@/components/Tabs'

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
const WINDOW_TABS: TabSpec[] = WINDOWS.map((w) => ({ key: String(w.days), label: w.label }))

const fmtInt = (n: number): string => n.toLocaleString('en-US')
const fmtUsd = (n: number): string =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtTokens = (n: number): string =>
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

export default function AiUsagePage(): React.ReactElement {
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
    <>
      <SettingsHeader title="AI usage" />
      <Tabs
        ariaLabel="Usage window"
        tabs={WINDOW_TABS}
        active={String(windowDays)}
        onSelect={(k) => setWindowDays(Number(k))}
      />

      {error && <SettingsAlert tone="error">{error}</SettingsAlert>}

      {loading && !summary ? (
        <SettingsLoading />
      ) : summary ? (
        <>
          <div className="li-set-stat-row">
            <div className="li-set-stat-card">
              <div className="li-set-stat-label">Estimated cost · {summary.sinceDays}d</div>
              <div className="li-set-stat-value">{fmtUsd(summary.estimatedCostUsd)}</div>
            </div>
            <div className="li-set-stat-card">
              <div className="li-set-stat-label">Total tokens</div>
              <div className="li-set-stat-value">{fmtTokens(totalTokens)}</div>
              <div className="li-set-stat-sub">{fmtInt(totalTokens)} tokens</div>
            </div>
            <div className="li-set-stat-card">
              <div className="li-set-stat-label">Assistant turns</div>
              <div className="li-set-stat-value">{fmtInt(summary.totalTurns)}</div>
            </div>
          </div>

          {summary.totalTurns === 0 && (
            <p className="li-set-hint">
              No AI usage recorded in this window yet. Usage accrues from when token tracking went
              live — earlier conversations aren&rsquo;t counted.
            </p>
          )}

          {summary.pricedCoverage < 1 && summary.totalTurns > 0 && (
            <SettingsAlert tone="warn">
              Cost shown for {Math.round(summary.pricedCoverage * 100)}% of turns — some usage is on
              a model without a price in the estimate table.
            </SettingsAlert>
          )}

          {summary.byDay.length > 0 && (
            <div className="li-set-card li-set-card--narrow">
              <div className="li-set-chart-head">
                <div className="li-set-chart-title">
                  Daily spend — last {summary.byDay.length} days
                </div>
                <div className="li-set-legend">
                  <span>
                    <span className="li-set-legend-dot" style={{ color: 'var(--li-link)' }} />
                    Normal
                  </span>
                  <span>
                    <span className="li-set-legend-dot" style={{ color: 'var(--li-gold)' }} />
                    Peak
                  </span>
                </div>
              </div>
              <div className="li-set-chart">
                {summary.byDay.map((d, i) => {
                  const peak = d.estimatedCostUsd > maxDayCost * 0.82
                  const h = Math.max(3, Math.round((d.estimatedCostUsd / maxDayCost) * 100))
                  return (
                    <div
                      key={d.day}
                      className="li-set-chart-col"
                      title={`${d.day}: ${fmtUsd(d.estimatedCostUsd)}`}
                    >
                      <div
                        className={`li-set-chart-bar${peak ? ' peak' : ''}`}
                        style={{ height: `${h}%` }}
                      />
                      <span className="li-set-chart-label">{i + 1}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {summary.bySource.length > 0 && (
            <div className="li-set-section-block li-set-card li-set-card--narrow li-set-card--flush">
              <div className="li-set-table-title" style={{ padding: '18px 22px 0' }}>
                By source
              </div>
              <table className="li-set-usage-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th className="num">Turns</th>
                    <th className="num">Input</th>
                    <th className="num">Output</th>
                    <th className="num">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.bySource.map((s) => (
                    <tr key={s.source}>
                      <td>{humanSource(s.source)}</td>
                      <td className="num">{fmtInt(s.turns)}</td>
                      <td className="num">{fmtTokens(s.inputTokens)}</td>
                      <td className="num">{fmtTokens(s.outputTokens)}</td>
                      <td className="num" style={{ fontWeight: 600 }}>
                        {fmtUsd(s.estimatedCostUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {summary.byModel.length > 0 && (
            <div className="li-set-section-block li-set-card li-set-card--narrow li-set-card--flush">
              <div className="li-set-table-title" style={{ padding: '18px 22px 0' }}>
                By model
              </div>
              <table className="li-set-usage-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th className="num">Turns</th>
                    <th className="num">Input</th>
                    <th className="num">Output</th>
                    <th className="num">Cache read</th>
                    <th className="num">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byModel.map((m) => (
                    <tr key={m.model}>
                      <td title={m.model}>{humanModel(m.model)}</td>
                      <td className="num">{fmtInt(m.turns)}</td>
                      <td className="num">{fmtTokens(m.inputTokens)}</td>
                      <td className="num">{fmtTokens(m.outputTokens)}</td>
                      <td className="num">{fmtTokens(m.cacheReadTokens)}</td>
                      <td className="num" style={{ fontWeight: 600 }}>
                        {m.estimatedCostUsd === null ? '—' : fmtUsd(m.estimatedCostUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="li-set-hint" style={{ maxWidth: 720 }}>
            Cost is an estimate from published list prices (input, output, and prompt-cache tokens),
            not your actual Anthropic invoice. Covers the chat assistant and document drafting;
            Perplexity research turns aren&rsquo;t counted (that provider doesn&rsquo;t report token
            usage). Each source counts only from when its token tracking went live, so older
            activity &mdash; and any drafting before this release &mdash; isn&rsquo;t included.
          </p>
        </>
      ) : null}
    </>
  )
}
