'use client'

// BUILDER-UX-2 WP-2 — the template editor pop-up: the REAL TipTap rich-text editor
// (TemplateEditor — the same one the standalone templates page mounts), opened DIRECTLY
// in edit mode and seeded from an in-memory proposal body or a persisted template. No
// View/Edit toggle, no raw-markdown textarea. Save/Cancel live at the top. The body
// crosses the markdown↔HTML bridge (proposals + the library store markdown; TipTap edits
// HTML) so tokens load as atomic chips, never {{raw}} literals. The host decides what
// Save does: update the wizard card's in-memory body, or persist through legal.template.update.
import { useRef, useState } from 'react'
import { Modal } from '@/components/Modal'
import { TemplateEditor, type TemplateEditorHandle } from '@/components/templates/TemplateEditor'
import { TemplatePreview } from '@/components/templates/TemplatePreview'
import { AiRegenerateRail } from '@/components/AiRegenerateRail'
import { markdownToHtml, htmlToMarkdown } from '@/lib/templateBody'

export function TemplateEditorModal({
  title,
  initialBody,
  regenerateTargetId,
  onSave,
  onClose,
}: {
  title: string
  // Markdown (proposal body or persisted template body).
  initialBody: string
  // Enables the "Edit with AI" rail ("proposal:<key>" for wizard proposals, the
  // persisted template's entity id once saved). The worker revises the passed body.
  regenerateTargetId?: string
  // Receives the edited body as MARKDOWN (the storage form).
  onSave: (body: string) => Promise<void> | void
  onClose: () => void
}): React.ReactElement {
  const editorRef = useRef<TemplateEditorHandle | null>(null)
  // The editor's seed: markdown → HTML with {{tokens}} rehydrated as chips. State
  // (not a one-shot) so "Use this" from the AI rail can reseed the live editor —
  // TemplateEditor resyncs when its initialHtml prop changes.
  const [seedHtml, setSeedHtml] = useState(() => markdownToHtml(initialBody))
  // Live HTML, updated on every keystroke so Save reads the latest even if the
  // imperative handle is momentarily null.
  const htmlRef = useRef(seedHtml)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const html = editorRef.current?.getHTML() ?? htmlRef.current
      await onSave(htmlToMarkdown(html))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose} size="wide">
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 12,
          alignItems: 'center',
          justifyContent: 'flex-end',
        }}
      >
        <button type="button" className="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="button button-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && (
        <div role="alert" className="alert alert-error" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}
      {regenerateTargetId && (
        <AiRegenerateRail
          artifactKind="template"
          targetId={regenerateTargetId}
          current={() => htmlToMarkdown(editorRef.current?.getHTML() ?? htmlRef.current)}
          renderProposal={(proposed) => <TemplatePreview body={proposed} />}
          onUse={(proposed) => {
            const html = markdownToHtml(proposed)
            htmlRef.current = html
            // Apply through the imperative handle — the prop-resync path no-ops when
            // the proposal equals the last SEED even though the editor holds unsaved
            // edits. setSeedHtml stays as the pre-mount fallback.
            if (editorRef.current) editorRef.current.setContent(html)
            else setSeedHtml(html)
          }}
        />
      )}
      <TemplateEditor
        initialHtml={seedHtml}
        editorRef={editorRef}
        onChange={(html) => {
          htmlRef.current = html
        }}
      />
    </Modal>
  )
}
