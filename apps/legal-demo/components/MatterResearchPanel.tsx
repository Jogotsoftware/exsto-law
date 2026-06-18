'use client'

// Research panel (matter-scoped Perplexity). The legal.research.ask/list tools
// were built (Obj: in-app research) but had no UI surface — reachable only via the
// assistant. This drops into the matter page like TimeExpensePanel: ask a question
// scoped to the matter, get an answer + citations, recorded to the matter timeline
// (research.recorded). Uses the firm's Settings-managed Perplexity key.

import { useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

interface ResearchEntry {
  eventId: string
  question: string
  answer: string
  citations: string[]
  model: string
  recordedAt: string
}

export function MatterResearchPanel({ matterEntityId }: { matterEntityId: string }) {
  const [entries, setEntries] = useState<ResearchEntry[] | null>(null)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function load() {
    callAttorneyMcp<{ research: ResearchEntry[] }>({
      toolName: 'legal.research.list',
      input: { matterEntityId },
    })
      .then((r) => setEntries(r.research))
      .catch((e) => setError(e.message))
  }
  useEffect(load, [matterEntityId])

  async function ask() {
    const q = question.trim()
    if (!q) return
    setAsking(true)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.research.ask',
        input: { matterEntityId, question: q },
      })
      setQuestion('')
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setAsking(false)
    }
  }

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Ask Perplexity a question scoped to this matter — the answer and its citations are recorded
        to the matter timeline.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ask()
          }}
          placeholder="e.g. What are NC's annual report requirements for a member-managed LLC?"
          style={{ flex: 1 }}
          disabled={asking}
        />
        <button className="primary" onClick={ask} disabled={asking || !question.trim()}>
          {asking ? 'Researching…' : 'Ask'}
        </button>
      </div>
      {error && <pre className="error">{error}</pre>}
      {entries === null && !error && (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      )}
      {entries && entries.length === 0 && (
        <p className="muted">No research recorded for this matter yet.</p>
      )}
      {entries &&
        entries.map((e) => (
          <div
            key={e.eventId}
            style={{ borderTop: '1px solid var(--border)', padding: '0.85rem 0' }}
          >
            <div style={{ fontWeight: 600 }}>{e.question}</div>
            <div style={{ whiteSpace: 'pre-wrap', margin: '0.4rem 0', lineHeight: 1.55 }}>
              {e.answer}
            </div>
            {e.citations.length > 0 && (
              <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
                {e.citations.map((c, i) => (
                  <li key={i}>
                    <a href={c} target="_blank" rel="noreferrer">
                      {c}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.35rem' }}>
              {e.model} · {new Date(e.recordedAt).toLocaleString()}
            </div>
          </div>
        ))}
    </div>
  )
}
