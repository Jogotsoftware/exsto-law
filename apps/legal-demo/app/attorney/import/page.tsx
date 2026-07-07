'use client'

// Granola folder → matter import. Connect Granola (Settings), pick a folder,
// scan it (auto-match each note to a matter by attendee email), tweak/confirm,
// then import — pulling each transcript and recording it on the matched matter.
// Unmatched notes are shown with a "No match" badge and a manual-pick dropdown;
// they are never silently dropped.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PageHead } from '@/components/PageHead'

interface GranolaFolder {
  id: string
  name: string
}

interface MatterMatch {
  matterEntityId: string
  matterNumber: string
  clientName: string
  matchedEmail: string
}

interface NotePreview {
  noteId: string
  title: string
  date: string | null
  attendeeEmails: string[]
  match: MatterMatch | null
}

interface MatterSummary {
  matterEntityId: string
  matterNumber: string
  clientName: string
}

interface ImportResult {
  noteId: string
  status: 'imported' | 'skipped' | 'error'
  matterEntityId: string | null
  error?: string
}

// Per-note row state the attorney can edit before importing: whether it's
// selected, and which matter it targets (auto-match by default, '' = unmatched).
interface RowState {
  selected: boolean
  matterEntityId: string
}

function isNotConnected(message: string): boolean {
  return /not connected/i.test(message)
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  return new Date(t).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function ImportPage() {
  const [folders, setFolders] = useState<GranolaFolder[] | null>(null)
  const [matters, setMatters] = useState<MatterSummary[]>([])
  const [folderId, setFolderId] = useState('')
  const [notes, setNotes] = useState<NotePreview[] | null>(null)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [results, setResults] = useState<ImportResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notConnected, setNotConnected] = useState(false)
  const [busy, setBusy] = useState<'folders' | 'scan' | 'import' | null>(null)

  // Folders + matters load on mount. A "not connected" error from the folders
  // call switches to the friendly connect-Granola state instead of a raw error.
  useEffect(() => {
    setBusy('folders')
    Promise.all([
      callAttorneyMcp<{ folders: GranolaFolder[] }>({ toolName: 'legal.granola.folders' }),
      callAttorneyMcp<{ matters: MatterSummary[] }>({ toolName: 'legal.matter.list' }),
    ])
      .then(([f, m]) => {
        setFolders(f.folders)
        setMatters(m.matters)
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e)
        if (isNotConnected(message)) setNotConnected(true)
        else setError(message)
        setFolders([])
      })
      .finally(() => setBusy(null))
  }, [])

  async function scan() {
    if (!folderId) return
    setBusy('scan')
    setError(null)
    setResults(null)
    setNotes(null)
    try {
      const r = await callAttorneyMcp<{ notes: NotePreview[] }>({
        toolName: 'legal.granola.preview',
        input: { folderId },
      })
      setNotes(r.notes)
      // Seed each row: selected by default, target = the auto-matched matter.
      const seeded: Record<string, RowState> = {}
      for (const n of r.notes) {
        seeded[n.noteId] = {
          selected: true,
          matterEntityId: n.match?.matterEntityId ?? '',
        }
      }
      setRows(seeded)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (isNotConnected(message)) setNotConnected(true)
      else setError(message)
    } finally {
      setBusy(null)
    }
  }

  const selectedCount = useMemo(() => Object.values(rows).filter((r) => r.selected).length, [rows])

  function setRow(noteId: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [noteId]: { ...prev[noteId], ...patch } }))
  }

  async function runImport() {
    if (!notes) return
    const selections = notes
      .filter((n) => rows[n.noteId]?.selected)
      .map((n) => ({
        noteId: n.noteId,
        matterEntityId: rows[n.noteId].matterEntityId || null,
      }))
    if (selections.length === 0) return
    setBusy('import')
    setError(null)
    try {
      const r = await callAttorneyMcp<{ results: ImportResult[] }>({
        toolName: 'legal.granola.import',
        input: { selections },
      })
      setResults(r.results)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (notConnected) {
    return (
      <main>
        <PageHead title="Import from Granola" />
        <section>
          <div className="alert">
            Granola isn&apos;t connected yet. Add your Granola API key in{' '}
            <Link href="/attorney/settings" className="client-name-link">
              Settings → Integrations
            </Link>{' '}
            to import meeting notes.
          </div>
        </section>
      </main>
    )
  }

  return (
    <main>
      <PageHead title="Import from Granola" />

      {error && <div className="alert alert-error">{error}</div>}

      <section>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label style={{ flex: 1, minWidth: 240 }}>
            <span>Folder</span>
            <select
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              disabled={busy === 'folders' || (folders?.length ?? 0) === 0}
            >
              <option value="">
                {busy === 'folders'
                  ? 'Loading folders…'
                  : (folders?.length ?? 0) === 0
                    ? 'No folders found'
                    : 'Select a folder…'}
              </option>
              {folders?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={scan} disabled={!folderId || busy === 'scan'}>
            {busy === 'scan' ? 'Scanning…' : 'Scan folder'}
          </button>
        </div>
      </section>

      {busy === 'scan' && (
        <div className="loading-block">
          <span className="spinner" /> Scanning notes and matching to matters…
        </div>
      )}

      {notes && notes.length === 0 && !results && (
        <section>
          <div className="loading-block text-muted">No notes in this folder.</div>
        </section>
      )}

      {notes && notes.length > 0 && !results && (
        <section style={{ padding: 0, overflow: 'hidden' }}>
          <table className="client-table">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Note</th>
                <th>Date</th>
                <th>Attendees</th>
                <th>Matched matter</th>
              </tr>
            </thead>
            <tbody>
              {notes.map((n) => {
                const row = rows[n.noteId]
                return (
                  <tr key={n.noteId}>
                    <td>
                      <input
                        type="checkbox"
                        checked={row?.selected ?? false}
                        onChange={(e) => setRow(n.noteId, { selected: e.target.checked })}
                      />
                    </td>
                    <td>{n.title}</td>
                    <td className="text-muted">{formatDate(n.date)}</td>
                    <td className="text-muted text-xs">
                      {n.attendeeEmails.length > 0 ? n.attendeeEmails.join(', ') : '—'}
                    </td>
                    <td>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--space-2)',
                          flexWrap: 'wrap',
                        }}
                      >
                        {n.match ? (
                          <span className="badge ok">Matched</span>
                        ) : (
                          <span className="badge warn">No match</span>
                        )}
                        <select
                          value={row?.matterEntityId ?? ''}
                          onChange={(e) => setRow(n.noteId, { matterEntityId: e.target.value })}
                        >
                          <option value="">Leave unmatched (review queue)</option>
                          {matters.map((m) => (
                            <option key={m.matterEntityId} value={m.matterEntityId}>
                              {m.matterNumber}
                              {m.clientName ? ` — ${m.clientName}` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div
            className="row"
            style={{
              justifyContent: 'flex-end',
              padding: 'var(--space-3) var(--space-4)',
              gap: 'var(--space-3)',
            }}
          >
            <span className="text-muted text-xs">{selectedCount} selected</span>
            <button
              className="primary"
              onClick={runImport}
              disabled={selectedCount === 0 || busy === 'import'}
            >
              {busy === 'import' ? 'Importing…' : `Import ${selectedCount} selected`}
            </button>
          </div>
        </section>
      )}

      {results && (
        <section>
          <h2>Import results</h2>
          <table className="client-table">
            <thead>
              <tr>
                <th>Note</th>
                <th>Result</th>
                <th>Matter</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const note = notes?.find((n) => n.noteId === r.noteId)
                const matter = matters.find((m) => m.matterEntityId === r.matterEntityId)
                return (
                  <tr key={r.noteId}>
                    <td>{note?.title ?? r.noteId}</td>
                    <td>
                      <span
                        className={
                          r.status === 'imported'
                            ? 'badge ok'
                            : r.status === 'skipped'
                              ? 'badge warn'
                              : 'badge danger'
                        }
                      >
                        {r.status}
                      </span>
                      {r.error && (
                        <span
                          className="text-muted text-xs"
                          style={{ marginLeft: 'var(--space-2)' }}
                        >
                          {r.error}
                        </span>
                      )}
                    </td>
                    <td className="text-muted">
                      {r.matterEntityId
                        ? matter
                          ? `${matter.matterNumber}${matter.clientName ? ` — ${matter.clientName}` : ''}`
                          : 'matched'
                        : 'review queue'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 'var(--space-3)' }}>
            <button
              onClick={() => {
                setResults(null)
                setNotes(null)
                setFolderId('')
              }}
            >
              Import another folder
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
