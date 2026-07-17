'use client'

// The shared header action row for the editor pop-ups: the "Edit with AI" rail
// (when present) grows in the left slot — its prompt form and proposal panel
// expand inside it — while Cancel/Save stay pinned top-right. The error alert
// renders below the row, itemized only on newlines: a single server message can
// legally contain "; " (e.g. "use one of: a; b"), so splitting on it would shred
// one error into nonsense fragments.
import type { ReactNode } from 'react'

export function EditorActionRow({
  ai,
  error,
  busy,
  canSave = true,
  saveLabel = 'Save',
  onCancel,
  onSave,
}: {
  ai?: ReactNode
  error?: string | null
  busy: boolean
  canSave?: boolean
  saveLabel?: string
  onCancel: () => void
  onSave: () => void
}): React.ReactElement {
  const errorItems = error
    ? error
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  return (
    <>
      <div className="editor-action-row">
        <div className="editor-action-row-ai">{ai}</div>
        <button type="button" className="li-modal-btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="li-modal-btn-primary"
          onClick={onSave}
          disabled={busy || !canSave}
        >
          {busy ? 'Saving…' : saveLabel}
        </button>
      </div>
      {error && (
        <div role="alert" className="li-modal-alert" style={{ marginBottom: 10 }}>
          {errorItems.length > 1 ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {errorItems.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : (
            error
          )}
        </div>
      )}
    </>
  )
}
