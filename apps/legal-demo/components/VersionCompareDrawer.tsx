'use client'

// "View Redlines" — compare two versions of a document (B2.3 — SAVE-REDLINES-1).
// Wires up the previously-unshipped compare-versions surface: legal.draft.
// versions (verticals/legal/src/mcp/tools/listDocumentVersions.ts) and the
// .vcmp-drawer / .vdiff CSS (globals.css ~8172) had NO consumer before this.
// Two views of the same pair, toggled: a word-level tracked-changes redline
// (buildRedline — insertions underlined green, deletions struck red, the same
// visual language as the AI-revision flagship editor) and a line-level +/−
// gutter (lineDiff, reusing the shared VersionDiff component — the same
// memo-redline rendering DocumentReviewer's AI-review "Suggested redline"
// uses). Defaults to the two most recent versions; either side is re-pickable
// from the full history.
import { useEffect, useMemo, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { formatDateTimeShort } from '@/lib/datetime'
import { lineDiff, diffStats } from '@/lib/lineDiff'
import { buildRedline, redlineStats, toReadableText } from '@/lib/wordDiff'
import { VersionDiff } from '@/components/VersionDiff'
import { useDialogEscapeStack } from '@/components/Modal'
import { XIcon } from '@/components/icons'

interface DocumentVersionSummary {
  documentVersionId: string
  versionNumber: number
  status: string
  recordedAt: string
  source: 'original' | 'generated' | 'edited'
  note: string | null
  redlineSource: 'human' | 'ai_accepted' | 'mixed' | null
}

const SOURCE_LABEL: Record<DocumentVersionSummary['source'], string> = {
  original: 'Original',
  generated: 'Regenerated',
  edited: 'Edited',
}
const REDLINE_BADGE: Record<'human' | 'ai_accepted' | 'mixed', string> = {
  human: 'Manual',
  ai_accepted: 'AI Revision',
  mixed: 'Mixed',
}

function versionLabel(v: DocumentVersionSummary): string {
  const badge = v.redlineSource ? REDLINE_BADGE[v.redlineSource] : SOURCE_LABEL[v.source]
  return `v${v.versionNumber} — ${badge} — ${formatDateTimeShort(v.recordedAt)}`
}

export function VersionCompareDrawer({
  documentVersionId,
  onClose,
}: {
  // Any version id of the document — legal.draft.versions resolves the whole
  // family from it.
  documentVersionId: string
  onClose: () => void
}) {
  const [versions, setVersions] = useState<DocumentVersionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fromId, setFromId] = useState<string | null>(null)
  const [toId, setToId] = useState<string | null>(null)
  const [fromBody, setFromBody] = useState<string | null>(null)
  const [toBody, setToBody] = useState<string | null>(null)
  const [bodiesLoading, setBodiesLoading] = useState(false)
  const [wordLevel, setWordLevel] = useState(true)

  // Body scroll lock + Escape — joins the shared dialog stack (Modal.tsx) so
  // Escape targets only the topmost dialog when this opens above another
  // modal (the workflow runner's step modal, via DocumentReviewer embedded).
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])
  useDialogEscapeStack(onClose)

  useEffect(() => {
    let cancelled = false
    callAttorneyMcp<{ versions: DocumentVersionSummary[] }>({
      toolName: 'legal.draft.versions',
      input: { documentVersionId },
    })
      .then((r) => {
        if (cancelled) return
        setVersions(r.versions)
        // Newest first — default to comparing the two most recent.
        if (r.versions[0]) setToId(r.versions[0].documentVersionId)
        if (r.versions[1]) setFromId(r.versions[1].documentVersionId)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [documentVersionId])

  useEffect(() => {
    if (!fromId || !toId) return
    let cancelled = false
    setBodiesLoading(true)
    setError(null)
    Promise.all([
      callAttorneyMcp<{ draft: { bodyMarkdown: string } | null }>({
        toolName: 'legal.draft.get',
        input: { documentVersionId: fromId },
      }),
      callAttorneyMcp<{ draft: { bodyMarkdown: string } | null }>({
        toolName: 'legal.draft.get',
        input: { documentVersionId: toId },
      }),
    ])
      .then(([a, b]) => {
        if (cancelled) return
        setFromBody(a.draft?.bodyMarkdown ?? '')
        setToBody(b.draft?.bodyMarkdown ?? '')
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setBodiesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fromId, toId])

  const lineOps = useMemo(
    () => (fromBody !== null && toBody !== null ? lineDiff(fromBody, toBody) : []),
    [fromBody, toBody],
  )
  const lineSummary = useMemo(() => diffStats(lineOps), [lineOps])
  const wordParas = useMemo(
    () =>
      fromBody !== null && toBody !== null
        ? buildRedline(toReadableText(fromBody), toReadableText(toBody))
        : [],
    [fromBody, toBody],
  )
  const wordSummary = useMemo(() => redlineStats(wordParas), [wordParas])

  const toVersion = versions?.find((v) => v.documentVersionId === toId) ?? null
  const identical = fromBody !== null && toBody !== null && fromBody === toBody

  return (
    <div className="trace-drawer-backdrop" onClick={onClose} role="presentation">
      <div
        className="trace-drawer vcmp-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="View redlines"
      >
        <div className="trace-drawer-head">
          <h2>View Redlines</h2>
          <button type="button" className="trace-drawer-close" onClick={onClose} aria-label="Close">
            <XIcon size={18} />
          </button>
        </div>
        <p className="trace-drawer-intro">
          Compare any two versions of this document — what changed, and (when the save was reviewed
          through the tracked-changes editor) whether it was AI or manual.
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        {!versions ? (
          <p className="text-muted text-sm">
            <span className="spinner" /> Loading version history…
          </p>
        ) : versions.length < 2 ? (
          <p className="text-muted text-sm">
            This document has only one version — nothing to compare yet.
          </p>
        ) : (
          <>
            <div className="vcmp-controls">
              <label className="vcmp-pick">
                <span>From</span>
                <select value={fromId ?? ''} onChange={(e) => setFromId(e.target.value)}>
                  {versions.map((v) => (
                    <option key={v.documentVersionId} value={v.documentVersionId}>
                      {versionLabel(v)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="vcmp-pick">
                <span>To</span>
                <select value={toId ?? ''} onChange={(e) => setToId(e.target.value)}>
                  {versions.map((v) => (
                    <option key={v.documentVersionId} value={v.documentVersionId}>
                      {versionLabel(v)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {toVersion?.note && <p className="trace-drawer-intro">Note: “{toVersion.note}”</p>}

            <div className="vcmp-meta">
              <label className="vcmp-toggle">
                <input
                  type="checkbox"
                  checked={wordLevel}
                  onChange={(e) => setWordLevel(e.target.checked)}
                />
                Word-level
              </label>
              {!bodiesLoading && (
                <span className="vcmp-stat">
                  <span className="vcmp-stat-add">
                    +{wordLevel ? wordSummary.insertions : lineSummary.added}
                  </span>{' '}
                  <span className="vcmp-stat-del">
                    −{wordLevel ? wordSummary.deletions : lineSummary.removed}
                  </span>
                </span>
              )}
            </div>

            {bodiesLoading ? (
              <p className="text-muted text-sm">
                <span className="spinner" /> Loading both versions…
              </p>
            ) : identical ? (
              <p className="text-muted text-sm">These two versions are identical.</p>
            ) : wordLevel ? (
              <div className="vcmp-word">
                {wordParas.map((p, i) => (
                  <p key={i}>
                    {p.runs.length === 0
                      ? ' '
                      : p.runs.map((r, j) =>
                          r.kind === 'same' ? (
                            <span key={j}>{r.text}</span>
                          ) : r.kind === 'ins' ? (
                            <ins key={j} className="vcmp-w-ins">
                              {r.text}
                            </ins>
                          ) : (
                            <del key={j} className="vcmp-w-del">
                              {r.text}
                            </del>
                          ),
                        )}
                  </p>
                ))}
              </div>
            ) : (
              <div className="vdiff">
                <VersionDiff ops={lineOps} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
