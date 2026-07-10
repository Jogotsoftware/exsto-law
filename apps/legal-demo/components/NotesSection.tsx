'use client'

// MACHINE-COMMS-1 — the shared Notes section (matter page + client page). Lists
// the active notes attached to one entity (legal.note.list), lets the attorney add
// one (legal.note.create) and remove one (legal.note.retire, with an INLINE
// confirm — no browser confirm()). AI-authored notes (transcript summaries /
// extractions) get a subtle distinct treatment + a source badge, so machine
// memory is never mistaken for the attorney's own words.
import { useCallback, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { formatDateTime } from '@/lib/datetime'

interface NoteRow {
  noteEntityId: string
  body: string
  source: string // attorney | ai_summary | ai_extraction
  authorName: string | null
  authorType: string | null // human | agent | system
  aboutEntityId: string | null
  aboutEntityKind: string | null
  createdAt: string
}

function sourceLabel(source: string): string {
  if (source === 'ai_summary') return 'AI summary'
  if (source === 'ai_extraction') return 'AI extracted'
  return 'Attorney'
}

function isAiNote(n: NoteRow): boolean {
  return n.authorType === 'agent' || n.source.startsWith('ai_')
}

export function NotesSection({
  targetEntityId,
  createInput,
}: {
  targetEntityId: string
  // The create tool's anchor: { matterEntityId } on a matter, { clientEntityId }
  // on a client — spread into legal.note.create alongside the body.
  createInput: Record<string, string>
}) {
  const [notes, setNotes] = useState<NoteRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  // Inline remove-confirm: the id whose Remove was clicked once (second click
  // confirms), and the id whose retire call is in flight.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [retiringId, setRetiringId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<{ notes: NoteRow[] }>({
        toolName: 'legal.note.list',
        input: { targetEntityId },
      })
      setNotes(r.notes)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setNotes((prev) => prev ?? [])
    }
  }, [targetEntityId])

  useEffect(() => {
    void load()
  }, [load])

  async function add() {
    if (busy || !body.trim()) return
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.note.create',
        input: { body: body.trim(), ...createInput },
      })
      setBody('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function retire(noteEntityId: string) {
    setRetiringId(noteEntityId)
    setError(null)
    try {
      await callAttorneyMcp({ toolName: 'legal.note.retire', input: { noteEntityId } })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRetiringId(null)
      setConfirmingId(null)
    }
  }

  return (
    <section>
      <h2>Notes</h2>
      <p className="text-muted text-sm">
        Working notes — yours, plus AI summaries and facts extracted from transcripts.
      </p>
      {error && <div className="alert alert-error">{error}</div>}

      {notes === null ? (
        <p className="text-muted text-sm" style={{ marginTop: 'var(--space-3)' }}>
          <span className="spinner" /> Loading notes…
        </p>
      ) : notes.length === 0 ? (
        <p className="text-muted" style={{ marginTop: 'var(--space-3)' }}>
          No notes yet.
        </p>
      ) : (
        <div
          style={{
            marginTop: 'var(--space-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          {notes.map((n) => {
            const ai = isAiNote(n)
            return (
              <div
                key={n.noteEntityId}
                style={{
                  padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: ai ? 'var(--navy-50)' : 'var(--surface)',
                  border: `1px solid ${ai ? 'var(--navy-100)' : 'var(--border)'}`,
                }}
              >
                <div className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>
                  {n.body}
                </div>
                <div
                  className="text-sm text-muted"
                  style={{
                    marginTop: 'var(--space-1)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    flexWrap: 'wrap',
                  }}
                >
                  <span className={ai ? 'badge info' : 'badge'}>{sourceLabel(n.source)}</span>
                  <span>
                    {n.authorName ?? '—'} · {formatDateTime(n.createdAt)}
                  </span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
                    {confirmingId === n.noteEntityId ? (
                      <>
                        <span>Remove this note?</span>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => void retire(n.noteEntityId)}
                          disabled={retiringId !== null}
                        >
                          {retiringId === n.noteEntityId && <span className="spinner" />}
                          {retiringId === n.noteEntityId ? 'Removing…' : 'Remove'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          disabled={retiringId !== null}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingId(n.noteEntityId)}
                        disabled={retiringId !== null}
                        title="Remove this note"
                      >
                        Remove
                      </button>
                    )}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div
        className="row"
        style={{ gap: 'var(--space-2)', alignItems: 'flex-start', marginTop: 'var(--space-3)' }}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Add a note…"
          style={{ flex: 1 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void add()
          }}
        />
        <button className="primary" onClick={() => void add()} disabled={busy || !body.trim()}>
          {busy && <span className="spinner" />}
          {busy ? 'Adding…' : 'Add note'}
        </button>
      </div>
    </section>
  )
}
