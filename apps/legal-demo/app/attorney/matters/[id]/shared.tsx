'use client'

// Shared types + presentation helpers for the matter editor tabs (Overview /
// Activity / Documents / Billing). Not a route — a plain module imported by the
// tab pages and the layout, so humanizers + the questionnaire/transcript renderers
// live in exactly one place.

export interface MatterDetail {
  matterEntityId: string
  matterNumber: string
  clientName: string
  clientEmail: string | null
  practiceArea: string
  status: string
  summary: string
  createdAt: string
  attributes: Record<string, unknown>
  questionnaireResponses: Record<string, unknown> | null
  transcriptText: string | null
  latestDraftVersionId: string | null
  latestDraftStatus: string | null
  clientEntityId: string | null
}

export function humanizeKind(k: string): string {
  return k.replace(/_/g, ' ')
}

export function humanizeService(key: string): string {
  if (!key) return '—'
  if (key === 'llc_formation') return 'NC LLC formation'
  if (key === 'oa_amendment') return 'OA amendment'
  if (key === 'business_formation') return 'NC LLC formation'
  if (key === 'other') return 'Custom'
  return key.replace(/_/g, ' ')
}

export function humanizeStatus(s: string): string {
  return s.replace(/_/g, ' ')
}

export function statusBadgeClass(status: string): string {
  if (['consultation_scheduled', 'consultation_completed'].includes(status)) return 'badge info'
  if (['drafting', 'review_pending'].includes(status)) return 'badge warn'
  if (['engagement_signed', 'matter_active'].includes(status)) return 'badge ok'
  return 'badge'
}

function humanizeKey(key: string): string {
  const s = key.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function humanizeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(value + 'T00:00:00').toLocaleDateString()
    }
    return value.replace(/_/g, ' ')
  }
  if (typeof value === 'number') return String(value)
  // Structured address fields store a StructuredAddress object; show the
  // human-readable line, not the raw JSON.
  if (typeof value === 'object' && value !== null && 'formatted_address' in value) {
    const formatted = (value as { formatted_address?: unknown }).formatted_address
    if (typeof formatted === 'string' && formatted.trim() !== '') return formatted
  }
  return JSON.stringify(value)
}

export function QuestionnaireView({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data)
  const tabular: Array<[string, Array<Record<string, unknown>>]> = []
  const simple: Array<[string, unknown]> = []
  for (const [k, v] of entries) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
      tabular.push([k, v as Array<Record<string, unknown>>])
    } else {
      simple.push([k, v])
    }
  }

  return (
    <>
      {simple.length > 0 && (
        <div className="kv-grid">
          {simple.map(([k, v]) => (
            <div key={k}>
              <div className="kv-label">{humanizeKey(k)}</div>
              <div className="kv-value">{humanizeValue(v)}</div>
            </div>
          ))}
        </div>
      )}
      {tabular.map(([k, rows]) => (
        <div key={k} style={{ marginTop: 'var(--space-5)' }}>
          <h3>{humanizeKey(k)}</h3>
          <RepeaterTable rows={rows} />
        </div>
      ))}
    </>
  )
}

function RepeaterTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (rows.length === 0) return <p className="text-muted">None.</p>
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{humanizeKey(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>{humanizeValue(row[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function TranscriptView({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="transcript">
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={i} className="transcript-spacer" />
        if (/^\[.*\]$/.test(trimmed)) {
          return (
            <div key={i} className="transcript-meta">
              {trimmed}
            </div>
          )
        }
        if (/^Summary:/i.test(trimmed)) {
          return (
            <div key={i} className="transcript-summary">
              <strong>Summary</strong>
              <span>{trimmed.slice('Summary:'.length).trim()}</span>
            </div>
          )
        }
        const m = trimmed.match(/^([A-Za-z][A-Za-z ()'.-]{0,40}):\s*(.*)$/)
        if (m) {
          const speaker = m[1]!
          const dialogue = m[2]!
          const isAttorney = /attorney|juan/i.test(speaker)
          return (
            <div key={i} className={`transcript-line ${isAttorney ? 'attorney' : 'client'}`}>
              <div className="transcript-speaker">{speaker}</div>
              <div className="transcript-text">{dialogue}</div>
            </div>
          )
        }
        return (
          <div key={i} className="transcript-continuation">
            {trimmed}
          </div>
        )
      })}
    </div>
  )
}
