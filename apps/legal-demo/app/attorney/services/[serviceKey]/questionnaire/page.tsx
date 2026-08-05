'use client'

// The service intake questionnaire tab. MODAL-STD-1 (Gap A): this page used to
// carry a complete second questionnaire editor (its own EditorField/EditorSection
// model, ~1,000 lines); it now hosts the ONE shared QuestionnaireBuilder — the
// same field editor the questionnaires page and the wizard-proposal pop-up mount.
// The page keeps only host chrome: form title + jurisdiction, start-from-library,
// save-to-library (whole form and single question), and the service-scoped save.
// Round-trip safety: schemaToSections/sectionsToSchema preserve every wire
// property (types incl. members_repeater/file_upload, humane-intake flags,
// locale maps, stable field/section ids), and sectionsToSchema's opts keep the
// persisted schema's id/version instead of re-slugging from the title.

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { useConfirm, usePrompt } from '@/components/ConfirmModal'
import {
  QuestionnaireBuilder,
  schemaToSections,
  sectionsToSchema,
  NEW_SECTION,
  OPTION_TYPES,
  type BField,
  type BSection,
  type QuestionnaireSchema,
} from '@/components/QuestionnaireBuilder'

// Select a reusable questionnaire from the firm library (#4b) to seed this
// service's form, or jump to the library builder. Applying loads the chosen
// schema into the editor (in memory) — the attorney reviews and Saves a version.
function StartFromLibrary({ onApply }: { onApply: (schema: QuestionnaireSchema) => void }) {
  const { confirm, confirmElement } = useConfirm()
  const [items, setItems] = useState<
    { questionnaireTemplateId: string; name: string; schema: QuestionnaireSchema }[]
  >([])
  useEffect(() => {
    callAttorneyMcp<{
      questionnaires: {
        questionnaireTemplateId: string
        name: string
        schema: QuestionnaireSchema
      }[]
    }>({ toolName: 'legal.questionnaire_template.list' })
      .then((r) => setItems(r.questionnaires))
      .catch(() => setItems([]))
  }, [])
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        flexWrap: 'wrap',
      }}
    >
      {confirmElement}
      {items.length > 0 && (
        <select
          value=""
          aria-label="Start from a library questionnaire"
          onChange={(e) => {
            const it = items.find((i) => i.questionnaireTemplateId === e.target.value)
            e.target.value = ''
            if (!it) return
            void confirm({
              title: 'Replace this questionnaire?',
              body: `Replaces this service’s questionnaire with “${it.name}” from the library. You can edit it before saving.`,
              confirmLabel: 'Replace',
            }).then((ok) => {
              if (ok) onApply(it.schema)
            })
          }}
        >
          <option value="">Start from a library questionnaire…</option>
          {items.map((i) => (
            <option key={i.questionnaireTemplateId} value={i.questionnaireTemplateId}>
              {i.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

export default function QuestionnaireEditorPage() {
  const { prompt, promptElement } = usePrompt()
  const params = useParams<{ serviceKey: string }>()
  const serviceKey = params.serviceKey

  // The persisted schema's identity, preserved VERBATIM on save — including its
  // absence: a stored schema without id/version must not grow them on a
  // no-change save (round-trip fidelity). Null until loaded.
  const [meta, setMeta] = useState<{ id?: string; version?: number } | null>(null)
  const [title, setTitle] = useState('')
  const [jurisdiction, setJurisdiction] = useState('')
  const [sections, setSections] = useState<BSection[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  // A transient confirmation distinct from the questionnaire "Saved a new version"
  // banner (e.g. "Saved to the question library").
  const [notice, setNotice] = useState<string | null>(null)

  const applySchema = useCallback((schema: QuestionnaireSchema) => {
    setMeta({ id: schema.id, version: schema.version })
    setTitle(schema.title ?? '')
    setJurisdiction(schema.jurisdiction ?? '')
    setSections(schema.sections?.length ? schemaToSections(schema) : [NEW_SECTION()])
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await callAttorneyMcp<{ questionnaire: QuestionnaireSchema | null }>({
        toolName: 'legal.service.questionnaire.get',
        input: { serviceKey },
      })
      applySchema(r.questionnaire ?? {})
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [serviceKey, applySchema])

  useEffect(() => {
    load()
  }, [load])

  function currentSchema(name: string): QuestionnaireSchema {
    const out: QuestionnaireSchema = sectionsToSchema(name, sections, {
      id: meta?.id,
      version: meta?.version,
      jurisdiction,
    })
    // sectionsToSchema always emits id/version (its library hosts need them);
    // here absence is part of the stored shape and must round-trip.
    if (meta?.id === undefined) delete out.id
    if (meta?.version === undefined) delete out.version
    return out
  }

  async function save() {
    if (!meta) return
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.service.questionnaire.update',
        input: { serviceKey, intakeSchema: currentSchema(title) },
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Promote a single question into the firm QUESTION library (migration 0077) so
  // it can be reused in any questionnaire, carrying its stable {{answer}} token.
  async function saveQuestionToLibrary(field: BField) {
    if (!field.label.trim()) {
      setError('Give the question a label before saving it to the library.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // The library entry is a COPY: the questionnaire field keeps its own token,
      // so a template already bound to {{token}} is never silently re-pointed even
      // if the library de-duplicates it (e.g. company_name → company_name_2).
      await callAttorneyMcp({
        toolName: 'legal.question_template.create',
        input: {
          label: field.label.trim(),
          type: field.type,
          token: field.token?.trim() || undefined,
          ...(OPTION_TYPES.has(field.type)
            ? {
                options: field.options
                  .split('\n')
                  .map((o) => o.trim())
                  .filter(Boolean),
              }
            : {}),
        },
      })
      setNotice(`“${field.label.trim()}” saved to the question library.`)
      setTimeout(() => setNotice(null), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Promote the current in-editor form into the firm questionnaire library so it
  // can seed other services (a copy outward — this service is untouched).
  async function saveToLibrary() {
    if (!meta) return
    const name = await prompt({
      title: 'Save To The Library',
      body: 'Adds a copy of this questionnaire to the firm library so it can seed other services.',
      label: 'Name in the library',
      defaultValue: 'Untitled questionnaire',
      confirmLabel: 'Save To Library',
    })
    if (!name) return
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.questionnaire_template.create',
        input: { name: name.trim(), schema: currentSchema(name.trim()) },
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {promptElement}
      {/* UIWALK-2: the {{token}} helper renders once, inside QuestionnaireBuilder
          (qb-intro) — this page's duplicate copy is gone. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          flexWrap: 'wrap',
        }}
      >
        <StartFromLibrary
          onApply={(schema) => {
            applySchema(schema)
            setSaved(false)
          }}
        />
        <button
          type="button"
          className="li-svc-btn"
          style={{ marginLeft: 'auto' }}
          onClick={() => void saveToLibrary()}
          disabled={busy || !meta}
        >
          Save To Library
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {saved && <div className="alert alert-success">Saved a new version.</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {!meta ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      ) : (
        <div className="li-svc-body">
          <div className="li-svc-panel li-svc-panel--accent">
            <div className="form-grid">
              <label>
                <span>Form title</span>
                <input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value)
                    setSaved(false)
                  }}
                  placeholder="e.g. LLC operating agreement intake"
                />
              </label>
              <label>
                <span>Jurisdiction</span>
                <input
                  value={jurisdiction}
                  onChange={(e) => {
                    setJurisdiction(e.target.value)
                    setSaved(false)
                  }}
                  placeholder="e.g. NC"
                />
              </label>
            </div>
          </div>

          <QuestionnaireBuilder
            sections={sections}
            onChange={(next) => {
              setSections(next)
              setSaved(false)
            }}
            onSaveQuestionToLibrary={(f) => void saveQuestionToLibrary(f)}
          />

          <div className="li-svc-footrow">
            <button
              type="button"
              className="li-svc-btn-primary"
              onClick={save}
              disabled={busy || !meta}
            >
              {busy ? 'Saving…' : 'Save intake form'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
