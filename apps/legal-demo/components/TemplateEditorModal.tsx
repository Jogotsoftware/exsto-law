'use client'

// BUILDER-UX-2 WP-2 — the template editor pop-up: the REAL TipTap rich-text editor
// (TemplateEditor — the same one the standalone templates page mounts), opened DIRECTLY
// in edit mode and seeded from an in-memory proposal body or a persisted template. No
// View/Edit toggle, no raw-markdown textarea. Save/Cancel live at the top. The body
// crosses the markdown↔HTML bridge (proposals + the library store markdown; TipTap edits
// HTML) so tokens load as atomic chips, never {{raw}} literals. The host decides what
// Save does: update the wizard card's in-memory body, or persist through legal.template.update.
//
// ESIGN-UNIFY-1 ES-3: hosts that manage a signable document pass `initialEsignConfig`
// — the modal then shows the shared eSign panel (roles/binds/orders + per-role
// "Insert signature block" into the live editor) and Save delivers the edited
// config as onSave's second argument. Hosts that don't pass it see no panel
// (no dead controls) and their one-argument onSave keeps working unchanged.
import { useRef, useState } from 'react'
import { Modal } from '@/components/Modal'
import { EditorActionRow } from '@/components/EditorActionRow'
import { TemplateEditor, type TemplateEditorHandle } from '@/components/templates/TemplateEditor'
import { TemplatePreview } from '@/components/templates/TemplatePreview'
import { TemplateEsignPanel, roleBlockHtml } from '@/components/templates/TemplateEsignPanel'
import { AiRegenerateRail } from '@/components/AiRegenerateRail'
import { markdownToHtml, htmlToMarkdown } from '@/lib/templateBody'
import type { TemplateEsignConfig, TemplateEsignRole } from '@exsto/legal'

export function TemplateEditorModal({
  title,
  initialBody,
  initialEsignConfig,
  regenerateTargetId,
  onSave,
  onClose,
}: {
  title: string
  // Markdown (proposal body or persisted template body).
  initialBody: string
  // ES-3: pass to enable the eSign panel; the edited config arrives as onSave's
  // second argument. Omit to hide the panel entirely (no dead controls).
  initialEsignConfig?: TemplateEsignConfig
  // Enables the "Edit with AI" rail ("proposal:<key>" for wizard proposals, the
  // persisted template's entity id once saved). The worker revises the passed body.
  regenerateTargetId?: string
  // Receives the edited body as MARKDOWN (the storage form) and, when the eSign
  // panel is enabled, the edited config.
  onSave: (body: string, esignConfig?: TemplateEsignConfig) => Promise<void> | void
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
  // ES-3: the live MARKDOWN mirror, for the eSign panel's marker↔role drift.
  // Only maintained (and only re-rendering) when the panel is enabled.
  const [bodyMd, setBodyMd] = useState(initialBody)
  const [esignConfig, setEsignConfig] = useState<TemplateEsignConfig>(
    () => initialEsignConfig ?? { signable: false, roles: [] },
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const esignEnabled = initialEsignConfig !== undefined

  function insertEsignBlock(role: TemplateEsignRole) {
    const hasExecution = /\{\{\s*sign\s*:/.test(bodyMd)
    editorRef.current?.insertHtml(roleBlockHtml(role, !hasExecution))
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const html = editorRef.current?.getHTML() ?? htmlRef.current
      await onSave(htmlToMarkdown(html), esignEnabled ? esignConfig : undefined)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose} size="wide">
      <EditorActionRow
        busy={busy}
        error={error}
        onCancel={onClose}
        onSave={save}
        ai={
          regenerateTargetId ? (
            <AiRegenerateRail
              artifactKind="template"
              targetId={regenerateTargetId}
              current={() => htmlToMarkdown(editorRef.current?.getHTML() ?? htmlRef.current)}
              renderProposal={(proposed) => <TemplatePreview body={proposed} />}
              onUse={(proposed) => {
                const html = markdownToHtml(proposed)
                htmlRef.current = html
                if (esignEnabled) setBodyMd(proposed)
                // Apply through the imperative handle — the prop-resync path no-ops when
                // the proposal equals the last SEED even though the editor holds unsaved
                // edits. setSeedHtml stays as the pre-mount fallback.
                if (editorRef.current) editorRef.current.setContent(html)
                else setSeedHtml(html)
              }}
            />
          ) : undefined
        }
      />
      <TemplateEditor
        initialHtml={seedHtml}
        editorRef={editorRef}
        onChange={(html) => {
          htmlRef.current = html
          if (esignEnabled) setBodyMd(htmlToMarkdown(html))
        }}
      />
      {esignEnabled && (
        <TemplateEsignPanel
          body={bodyMd}
          config={esignConfig}
          onChange={setEsignConfig}
          onInsertBlock={insertEsignBlock}
        />
      )}
    </Modal>
  )
}
