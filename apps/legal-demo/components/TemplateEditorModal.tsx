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
//
// MODAL-STD-1 (Gap C): the service Templates tab now opens this modal instead of
// its former inline expander, so the modal grew optional host-context props —
// variable validation/suggestion for the `{{` autocomplete, a live-markdown
// callback, an external editor handle, arbitrary context panels (insert-field
// rail, orphan banner, library row), a side-by-side preview toggle, and the
// eSign panel's collect-at-intake action. All optional: hosts that omit them
// see exactly the pre-Gap-C modal.
import { useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { Modal } from '@/components/Modal'
import { EditorActionRow } from '@/components/EditorActionRow'
import { TemplateEditor, type TemplateEditorHandle } from '@/components/templates/TemplateEditor'
import type { VariableStatus } from '@/components/templates/TemplateVariableNode'
import { TemplatePreview } from '@/components/templates/TemplatePreview'
import { TemplateEsignPanel, roleBlockHtml } from '@/components/templates/TemplateEsignPanel'
import { AiRegenerateRail } from '@/components/AiRegenerateRail'
import { EyeIcon } from '@/components/icons'
import { markdownToHtml, htmlToMarkdown } from '@/lib/templateBody'
import type { TemplateEsignConfig, TemplateEsignRole } from '@exsto/legal'

export function TemplateEditorModal({
  title,
  initialBody,
  initialEsignConfig,
  regenerateTargetId,
  onSave,
  onClose,
  saveLabel,
  placeholder,
  validateVariable,
  variableNames,
  onBodyChange,
  editorHandleRef,
  contextPanels,
  enablePreview = false,
  onCollectAtIntake,
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
  saveLabel?: string
  placeholder?: string
  // Chip coloring + `{{` autocomplete for hosts with a bound questionnaire.
  validateVariable?: (name: string) => VariableStatus
  variableNames?: string[]
  // Live markdown mirror on every edit — lets the host drive context panels
  // (orphan banner, library actions) off the current body.
  onBodyChange?: (md: string) => void
  // Host-held editor handle for inserting fields/blocks or replacing the body
  // (library load, host-side AI). The modal reads/writes through the same ref.
  editorHandleRef?: MutableRefObject<TemplateEditorHandle | null>
  // Host context rendered between the action row and the editor.
  contextPanels?: ReactNode
  enablePreview?: boolean
  // Forwarded to the eSign panel (PRESIGN-1 collect-signer-at-intake).
  onCollectAtIntake?: (role: TemplateEsignRole) => Promise<void>
}): React.ReactElement {
  const internalRef = useRef<TemplateEditorHandle | null>(null)
  const editorRef = editorHandleRef ?? internalRef
  // The editor's seed: markdown → HTML with {{tokens}} rehydrated as chips. State
  // (not a one-shot) so "Use this" from the AI rail can reseed the live editor —
  // TemplateEditor resyncs when its initialHtml prop changes.
  const [seedHtml, setSeedHtml] = useState(() => markdownToHtml(initialBody))
  // Live HTML, updated on every keystroke so Save reads the latest even if the
  // imperative handle is momentarily null.
  const htmlRef = useRef(seedHtml)
  // ES-3: the live MARKDOWN mirror, for the eSign panel's marker↔role drift and
  // the preview pane. Only maintained (and only re-rendering) when a consumer
  // (eSign panel, preview, onBodyChange host) needs it.
  const [bodyMd, setBodyMd] = useState(initialBody)
  const [esignConfig, setEsignConfig] = useState<TemplateEsignConfig>(
    () => initialEsignConfig ?? { signable: false, roles: [] },
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  const esignEnabled = initialEsignConfig !== undefined
  const trackMd = esignEnabled || enablePreview || onBodyChange !== undefined

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
        saveLabel={saveLabel}
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
                if (trackMd) setBodyMd(proposed)
                onBodyChange?.(proposed)
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
      {contextPanels}
      {enablePreview && (
        <div className="tpl-insert" style={{ marginBottom: 'var(--space-2)' }}>
          <button
            type="button"
            className={showPreview ? 'primary' : undefined}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
            onClick={() => setShowPreview((v) => !v)}
            title="Preview the finished document with sample data, side by side"
          >
            <EyeIcon size={15} /> Preview
          </button>
        </div>
      )}
      <div className={showPreview ? 'tpl-split' : undefined}>
        <div className={showPreview ? 'tpl-split-col' : undefined}>
          <TemplateEditor
            initialHtml={seedHtml}
            editorRef={editorRef}
            placeholder={placeholder}
            validateVariable={validateVariable}
            variableNames={variableNames}
            onChange={(html) => {
              htmlRef.current = html
              if (trackMd) {
                const md = htmlToMarkdown(html)
                setBodyMd(md)
                onBodyChange?.(md)
              }
            }}
          />
        </div>
        {showPreview && (
          <div className="tpl-split-col">
            <TemplatePreview body={bodyMd} />
          </div>
        )}
      </div>
      {esignEnabled && (
        <TemplateEsignPanel
          body={bodyMd}
          config={esignConfig}
          onChange={setEsignConfig}
          onInsertBlock={insertEsignBlock}
          onCollectAtIntake={onCollectAtIntake}
        />
      )}
    </Modal>
  )
}
