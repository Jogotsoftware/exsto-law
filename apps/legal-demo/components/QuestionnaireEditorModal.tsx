'use client'

// BUILDER-UX-1 WP-4 — the questionnaire editor pop-up: the REAL field-editing
// builder (shared QuestionnaireBuilder) mounted in a modal, opened DIRECTLY in
// edit mode and seeded from an in-memory schema (a wizard proposal or a
// persisted questionnaire). No intermediate View/Edit toggle, no JSON textarea.
// Save/Cancel live at the top; the host decides what Save does (update the
// wizard card's in-memory schema, or persist through the standalone save path).
import { useState } from 'react'
import { Modal } from '@/components/Modal'
import {
  QuestionnaireBuilder,
  schemaToSections,
  sectionsToSchema,
  schemaFieldCount,
  type BSection,
  type QuestionnaireSchema,
} from '@/components/QuestionnaireBuilder'

export function QuestionnaireEditorModal({
  title,
  initialSchema,
  name,
  onSave,
  onClose,
}: {
  title: string
  initialSchema: QuestionnaireSchema
  // Used for the schema id/title on rebuild; the wizard proposal has no separate
  // name, so the schema's own title (or a fallback) is passed.
  name: string
  onSave: (schema: ReturnType<typeof sectionsToSchema>) => Promise<void> | void
  onClose: () => void
}): React.ReactElement {
  const [sections, setSections] = useState<BSection[]>(() => schemaToSections(initialSchema))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canSave = schemaFieldCount(sections) > 0

  async function save() {
    if (!canSave) {
      setError('Add at least one field with a label.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(sectionsToSchema(name || initialSchema.title || 'questionnaire', sections))
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
        <button
          type="button"
          className="button button-primary"
          onClick={save}
          disabled={busy || !canSave}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && (
        <div role="alert" className="alert alert-error" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}
      <QuestionnaireBuilder sections={sections} onChange={setSections} />
    </Modal>
  )
}
