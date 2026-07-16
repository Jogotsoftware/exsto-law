'use client'

// Questionnaire library (#4b) — every intake form the firm has: the reusable,
// NOT-service-bound library forms (CRUD here via the through-core
// legal.questionnaire_template.* tools, migration 0067) PLUS each service's
// bound intake form (read via legal.service.questionnaire.get; edited in the
// service builder). Beta feedback: listing only the standalone forms made the
// page claim "no questionnaires exist" while a live service had one.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { useConfirm } from '@/components/ConfirmModal'
import { formatDate } from '@/lib/datetime'
import { PageHead } from '@/components/PageHead'
import { QuestionnaireConfigModal } from '@/components/configEditors'
import {
  QuestionnaireBuilder,
  schemaToSections,
  sectionsToSchema,
  schemaFieldCount,
  NEW_FIELD,
  type BSection,
  type SchemaSection,
} from '@/components/QuestionnaireBuilder'

// BUILDER-UX-1 WP-4: the field-editing builder, its types, helpers, and the
// question-library picker moved to components/QuestionnaireBuilder.tsx so this
// page and the wizard-proposal pop-up share ONE editor. This page keeps only the
// list, the name/description + associated-templates chrome, and the save
// orchestration (create/update + set_templates).
interface AssocTemplate {
  templateEntityId: string
  name: string | null
}
interface QuestionnaireTemplate {
  questionnaireTemplateId: string
  name: string
  description: string | null
  fieldCount: number
  updatedAt: string
  schema: { id?: string; title?: string; sections?: SchemaSection[] }
  associatedTemplates?: AssocTemplate[]
}
interface Draft {
  id: string | null // null = new
  name: string
  description: string
  sections: BSection[]
  // Template entity ids this questionnaire feeds (migration 0109).
  associatedTemplateIds: string[]
}

const EMPTY_DRAFT = (): Draft => ({
  id: null,
  name: '',
  description: '',
  sections: [{ title: 'Details', fields: [NEW_FIELD()] }],
  associatedTemplateIds: [],
})

// A service's bound intake form, shown alongside the library so this page lists
// EVERY questionnaire the firm has. Edited in the service builder, not here.
interface ServiceIntakeForm {
  serviceKey: string
  serviceName: string
  isActive: boolean
  title: string
  fieldCount: number
  updatedAt: string
}

export default function QuestionnaireLibraryPage() {
  const { confirm, confirmElement } = useConfirm()
  const [items, setItems] = useState<QuestionnaireTemplate[] | null>(null)
  // Phase 9: the shared edit-in-modal, opened per library questionnaire row.
  const [modalQuestionnaire, setModalQuestionnaire] = useState<QuestionnaireTemplate | null>(null)
  const [svcForms, setSvcForms] = useState<ServiceIntakeForm[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  // The firm's document templates, for the "Associated templates" picker.
  const [templates, setTemplates] = useState<{ templateEntityId: string; name: string }[]>([])

  function load() {
    setError(null)
    callAttorneyMcp<{ questionnaires: QuestionnaireTemplate[] }>({
      toolName: 'legal.questionnaire_template.list',
    })
      .then((r) => setItems(r.questionnaires))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    // Service-bound intake forms, best-effort: a failure here must not blank the
    // library (the services surface has its own error handling).
    callAttorneyMcp<{
      services: Array<{
        serviceKey: string
        displayName: string
        isActive: boolean
        updatedAt: string
      }>
    }>({ toolName: 'legal.service.list_all' })
      .then((r) =>
        Promise.all(
          r.services.map((s) =>
            callAttorneyMcp<{
              questionnaire: { title?: string; sections?: SchemaSection[] } | null
            }>({ toolName: 'legal.service.questionnaire.get', input: { serviceKey: s.serviceKey } })
              .then((q) =>
                q.questionnaire
                  ? {
                      serviceKey: s.serviceKey,
                      serviceName: s.displayName,
                      isActive: s.isActive,
                      title: q.questionnaire.title?.trim() || `${s.displayName} intake`,
                      fieldCount: (q.questionnaire.sections ?? []).reduce(
                        (n, sec) => n + (sec.fields ?? []).length,
                        0,
                      ),
                      updatedAt: s.updatedAt,
                    }
                  : null,
              )
              .catch(() => null),
          ),
        ),
      )
      .then((forms) => setSvcForms(forms.filter((f): f is ServiceIntakeForm => f !== null)))
      .catch(() => setSvcForms([]))
  }
  useEffect(load, [])

  useEffect(() => {
    callAttorneyMcp<{ templates: { templateEntityId: string; name: string; category: string }[] }>({
      toolName: 'legal.template.list',
    })
      .then((r) => setTemplates(r.templates.filter((t) => t.category === 'document')))
      .catch(() => setTemplates([]))
  }, [])

  function editFrom(t: QuestionnaireTemplate) {
    setDraft({
      id: t.questionnaireTemplateId,
      name: t.name,
      description: t.description ?? '',
      sections: schemaToSections(t.schema),
      associatedTemplateIds: (t.associatedTemplates ?? []).map((a) => a.templateEntityId),
    })
  }

  async function save() {
    if (!draft) return
    if (!draft.name.trim()) {
      setError('Give the questionnaire a name.')
      return
    }
    const schema = sectionsToSchema(draft.name, draft.sections)
    if (schemaFieldCount(draft.sections) === 0) {
      setError('Add at least one field with a label.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      let qtId = draft.id
      if (draft.id) {
        await callAttorneyMcp({
          toolName: 'legal.questionnaire_template.update',
          input: {
            questionnaireTemplateId: draft.id,
            name: draft.name.trim(),
            description: draft.description.trim() || null,
            schema,
          },
        })
      } else {
        const r = await callAttorneyMcp<{ questionnaire: { questionnaireTemplateId: string } }>({
          toolName: 'legal.questionnaire_template.create',
          input: { name: draft.name.trim(), description: draft.description.trim() || null, schema },
        })
        qtId = r.questionnaire.questionnaireTemplateId
      }
      // Persist the questionnaire → document-template association (migration 0109),
      // once the questionnaire entity exists. Sends the full desired set.
      if (qtId) {
        await callAttorneyMcp({
          toolName: 'legal.questionnaire_template.set_templates',
          input: { questionnaireTemplateId: qtId, templateEntityIds: draft.associatedTemplateIds },
        })
      }
      setDraft(null)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function archive(t: QuestionnaireTemplate) {
    const ok = await confirm({
      title: `Archive “${t.name}”?`,
      body: 'It leaves the active library — kept as history, removed from the pickers.',
      confirmLabel: 'Archive',
      danger: true,
    })
    if (!ok) return
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.questionnaire_template.archive',
        input: { questionnaireTemplateId: t.questionnaireTemplateId },
      })
      if (draft?.id === t.questionnaireTemplateId) setDraft(null)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <main>
      {confirmElement}
      <PageHead
        title="Questionnaires"
        actions={
          !draft ? (
            <button className="primary" onClick={() => setDraft(EMPTY_DRAFT())}>
              New questionnaire
            </button>
          ) : undefined
        }
      />
      <p className="text-muted">
        Manage the reusable single questions in the{' '}
        <a href="/attorney/questions">question library →</a>
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {draft && (
        <section style={{ marginBottom: 'var(--space-5)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-3)',
            }}
          >
            <h2>{draft.id ? 'Edit questionnaire' : 'New questionnaire'}</h2>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
              <button className="primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create questionnaire'}
              </button>
              <button onClick={() => setDraft(null)} disabled={saving}>
                Cancel
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 'var(--space-4)',
              flexWrap: 'wrap',
              marginBottom: 'var(--space-4)',
            }}
          >
            <label style={{ flex: '1 1 18rem' }}>
              <span className="field-label">Name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. NC LLC intake"
              />
            </label>
            <label style={{ flex: '2 1 22rem' }}>
              <span className="field-label">Description (optional)</span>
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="What this questionnaire collects"
              />
            </label>
          </div>

          <fieldset className="svc-fieldset" style={{ marginBottom: 'var(--space-4)' }}>
            <legend>Associated document templates</legend>
            <p className="text-muted" style={{ fontSize: '0.82rem', margin: '-0.2rem 0 0.6rem' }}>
              The document template(s) this questionnaire feeds. When a client submits it, the
              answers fill the linked template(s) — and the pairing shows on both sides.
            </p>
            {templates.length === 0 ? (
              <p className="text-muted" style={{ fontSize: '0.82rem', margin: 0 }}>
                No document templates yet — create one in{' '}
                <a href="/attorney/templates">Templates</a>.
              </p>
            ) : (
              <div
                style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2) var(--space-5)' }}
              >
                {templates.map((t) => {
                  const on = draft.associatedTemplateIds.includes(t.templateEntityId)
                  return (
                    <label
                      key={t.templateEntityId}
                      className="svc-check"
                      style={{ flex: '0 0 auto' }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            associatedTemplateIds: e.target.checked
                              ? [...draft.associatedTemplateIds, t.templateEntityId]
                              : draft.associatedTemplateIds.filter(
                                  (id) => id !== t.templateEntityId,
                                ),
                          })
                        }
                      />
                      <span>{t.name}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </fieldset>

          <QuestionnaireBuilder
            sections={draft.sections}
            onChange={(next) => setDraft({ ...draft, sections: next })}
          />
        </section>
      )}

      {items === null && !error && (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      )}
      {items && items.length === 0 && (svcForms?.length ?? 0) === 0 && !draft && (
        <section>
          <p className="text-muted">
            No questionnaires yet. Build your first reusable intake form.
          </p>
        </section>
      )}
      {items && (items.length > 0 || (svcForms?.length ?? 0) > 0) && (
        <section>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th style={{ textAlign: 'right' }}>Fields</th>
                  <th>Feeds</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.questionnaireTemplateId}>
                    <td>
                      <strong>{t.name || '(untitled)'}</strong>
                    </td>
                    <td className="text-muted">{t.description ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{t.fieldCount}</td>
                    <td className="text-muted">
                      {(t.associatedTemplates ?? []).length > 0
                        ? (t.associatedTemplates ?? []).map((a) => a.name || 'untitled').join(', ')
                        : '—'}
                    </td>
                    <td>{formatDate(t.updatedAt)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => setModalQuestionnaire(t)}>Edit in window</button>{' '}
                      <button onClick={() => editFrom(t)}>Edit</button>{' '}
                      <button onClick={() => archive(t)}>Archive</button>
                    </td>
                  </tr>
                ))}
                {/* Service-bound intake forms — every service's questionnaire, so
                    this page is the full inventory. Edited in the service builder. */}
                {(svcForms ?? []).map((f) => (
                  <tr key={`svc-${f.serviceKey}`}>
                    <td>
                      <strong>{f.title}</strong>{' '}
                      <span className={`badge ${f.isActive ? 'ok' : ''}`}>
                        {f.isActive ? 'Live service' : 'Service (disabled)'}
                      </span>
                    </td>
                    <td className="text-muted">Intake form for the {f.serviceName} service</td>
                    <td style={{ textAlign: 'right' }}>{f.fieldCount}</td>
                    <td className="text-muted">{f.serviceName}</td>
                    <td>{formatDate(f.updatedAt)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Link
                        href={`/attorney/services/${encodeURIComponent(f.serviceKey)}/questionnaire`}
                      >
                        <button>Edit in service</button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {/* UI-BUILDER-FIX-1 Phase 9: the shared edit-in-modal (view / edit /
          AI-regenerate via worker_job / save) — no navigation. */}
      {modalQuestionnaire && (
        <QuestionnaireConfigModal
          questionnaire={{
            questionnaireTemplateId: modalQuestionnaire.questionnaireTemplateId,
            name: modalQuestionnaire.name,
            schema: modalQuestionnaire.schema,
          }}
          onClose={() => setModalQuestionnaire(null)}
          onChanged={load}
        />
      )}
    </main>
  )
}
