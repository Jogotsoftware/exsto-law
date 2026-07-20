'use client'

// Questionnaire library (#4b) — every intake form the firm has: the reusable,
// NOT-service-bound library forms (CRUD here via the through-core
// legal.questionnaire_template.* tools, migration 0067) PLUS each service's
// bound intake form (read via legal.service.questionnaire.get; edited in the
// service builder). Beta feedback: listing only the standalone forms made the
// page claim "no questionnaires exist" while a live service had one.
//
// WP-K (Legal Instruments redesign): the table became a visual card gallery —
// each card is a DocumentSheet thumb-form mini rendering of the REAL form
// (icon + decorative title bar, then each real field as a proportional label
// bar + input box, first four fields) plus a status badge. Per D6: no usage
// counts, no "Feeds" column on the card — that data is still real and still
// editable inside the questionnaire itself, just not shown as gallery chrome.

import Link from 'next/link'
import { useEffect, useState, type ReactElement } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { useConfirm } from '@/components/ConfirmModal'
import { QuestionnaireConfigModal } from '@/components/configEditors'
import { DocumentSheet } from '@/components/DocumentSheet'
import {
  FileTextIcon,
  LayoutGridIcon,
  ListIcon,
  MoreHorizontalIcon,
  PlusIcon,
} from '@/components/icons'
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
// gallery, the name/description + associated-templates chrome, and the save
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
  // Real field labels (first few used for the gallery card's mini thumbnail).
  fields: string[]
  updatedAt: string
}

// One field on a gallery card's mini form thumbnail: a proportional label bar
// (width derived from the REAL field's label length, not a decorative
// placeholder) + an input box, per the comp's intake-forms gallery.
interface ThumbField {
  key: string
  widthPct: number
}

function thumbFields(labels: string[]): ThumbField[] {
  return labels.slice(0, 4).map((label, i) => ({
    key: `${i}-${label}`,
    widthPct: Math.max(34, Math.min(92, label.length * 3)),
  }))
}

function IntakeThumb({ fields }: { fields: ThumbField[] }): ReactElement {
  return (
    <div className="li-int-card-thumbwrap">
      <DocumentSheet variant="thumb-form" className="li-int-card-thumb">
        <div className="li-int-thumb-head">
          <span className="li-int-thumb-icon">
            <FileTextIcon size={12} />
          </span>
          <span className="li-int-thumb-title" />
        </div>
        <div className="li-int-thumb-fields">
          {fields.map((f) => (
            <div key={f.key} className="li-int-thumb-field">
              <div className="li-int-thumb-field-label" style={{ width: `${f.widthPct}%` }} />
              <div className="li-int-thumb-field-input" />
            </div>
          ))}
        </div>
      </DocumentSheet>
    </div>
  )
}

// Library questionnaires are always active entities (the list query already
// filters entity.status = 'active'; archived ones never reach this page), so
// their badge is always Active. A service-bound form's badge follows the
// service's own live/disabled state — the one real signal this app has for
// "active vs draft" on an intake form.
function StatusBadge({ active }: { active: boolean }): ReactElement {
  return (
    <span className={`li-int-status ${active ? 'li-int-status--active' : 'li-int-status--draft'}`}>
      <span className="li-int-status-dot" />
      {active ? 'Active' : 'Draft'}
    </span>
  )
}

export default function QuestionnaireLibraryPage(): ReactElement {
  const { confirm, confirmElement } = useConfirm()
  const [items, setItems] = useState<QuestionnaireTemplate[] | null>(null)
  // Phase 9: the shared edit-in-modal, opened per library questionnaire card.
  const [modalQuestionnaire, setModalQuestionnaire] = useState<QuestionnaireTemplate | null>(null)
  const [svcForms, setSvcForms] = useState<ServiceIntakeForm[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Gallery card grid vs. compact list — a display preference only, no data change.
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  // The firm's document templates, for the "Associated templates" picker.
  const [templates, setTemplates] = useState<{ templateEntityId: string; name: string }[]>([])
  // The gallery card kebab menu (Edit in window / Archive) — only one open at a
  // time; the comp's card is a single "open the editor" click target, so these
  // two existing actions live behind a small per-card overflow instead (WP-E
  // precedent, templates gallery).
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

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
                      fields: (q.questionnaire.sections ?? []).flatMap((sec) =>
                        (sec.fields ?? []).map((f) => f.label?.trim() || f.id || '(untitled)'),
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
      {error && <div className="alert alert-error li-int-alert">{error}</div>}

      {!draft && (
        <>
          <div className="li-int-gallery-head">
            <div>
              <h1 className="li-int-title">Intake Forms</h1>
              <p className="li-int-sub">Forms clients complete before a matter opens.</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="li-viewtoggle" role="group" aria-label="View">
                <button
                  type="button"
                  className={view === 'grid' ? 'on' : ''}
                  aria-label="Grid view"
                  onClick={() => setView('grid')}
                >
                  <LayoutGridIcon size={15} />
                </button>
                <button
                  type="button"
                  className={view === 'list' ? 'on' : ''}
                  aria-label="List view"
                  onClick={() => setView('list')}
                >
                  <ListIcon size={15} />
                </button>
              </div>
              <button
                type="button"
                className="li-int-new-btn"
                onClick={() => setDraft(EMPTY_DRAFT())}
              >
                <PlusIcon size={16} />
                New intake form
              </button>
            </div>
          </div>

          {items === null && !error && (
            <div className="loading-block" role="status">
              <span className="spinner" /> Loading…
            </div>
          )}
          {items && items.length === 0 && (svcForms?.length ?? 0) === 0 && (
            <p className="li-int-empty">
              No questionnaires yet. Build your first reusable intake form.
            </p>
          )}
          {items && (items.length > 0 || (svcForms?.length ?? 0) > 0) && view === 'grid' && (
            <div className="li-int-grid">
              {items.map((t) => {
                const fields = thumbFields(
                  (t.schema.sections ?? [])
                    .flatMap((s) => s.fields ?? [])
                    .map((f) => f.label?.trim() || 'Field'),
                )
                const menuOpen = openMenuId === t.questionnaireTemplateId
                return (
                  <div key={t.questionnaireTemplateId} className="li-int-card-wrap">
                    <button
                      type="button"
                      className="li-int-card"
                      onClick={() => editFrom(t)}
                      aria-label={`Open ${t.name || 'untitled intake form'}`}
                    >
                      <IntakeThumb fields={fields} />
                      <div className="li-int-card-meta">
                        <div className="li-int-card-row">
                          <span className="li-int-card-name">{t.name || '(untitled)'}</span>
                          <StatusBadge active />
                        </div>
                        <div className="li-int-card-sub">
                          {t.fieldCount} question{t.fieldCount === 1 ? '' : 's'}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="li-int-card-menu-btn"
                      aria-label={`More actions for ${t.name || 'untitled intake form'}`}
                      aria-expanded={menuOpen}
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenMenuId(menuOpen ? null : t.questionnaireTemplateId)
                      }}
                    >
                      <MoreHorizontalIcon size={16} />
                    </button>
                    {menuOpen && (
                      <div className="li-int-card-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenMenuId(null)
                            setModalQuestionnaire(t)
                          }}
                        >
                          Edit in window
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="li-int-card-menu-danger"
                          onClick={() => {
                            setOpenMenuId(null)
                            void archive(t)
                          }}
                        >
                          Archive
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
              {/* Service-bound intake forms — every service's questionnaire, so
                  this page is the full inventory. Edited in the service builder. */}
              {(svcForms ?? []).map((f) => (
                <Link
                  key={`svc-${f.serviceKey}`}
                  href={`/attorney/services/${encodeURIComponent(f.serviceKey)}/questionnaire`}
                  className="li-int-card li-int-card--link"
                  aria-label={`Open ${f.title} (edited in the ${f.serviceName} service)`}
                >
                  <IntakeThumb fields={thumbFields(f.fields)} />
                  <div className="li-int-card-meta">
                    <div className="li-int-card-row">
                      <span className="li-int-card-name">{f.title}</span>
                      <StatusBadge active={f.isActive} />
                    </div>
                    <div className="li-int-card-sub">
                      {f.fieldCount} question{f.fieldCount === 1 ? '' : 's'}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
          {items && (items.length > 0 || (svcForms?.length ?? 0) > 0) && view === 'list' && (
            <div className="li-viewlist">
              {items.map((t) => {
                const menuOpen = openMenuId === t.questionnaireTemplateId
                return (
                  <div key={t.questionnaireTemplateId} className="li-int-card-wrap">
                    <button
                      type="button"
                      className="li-viewlist-row"
                      onClick={() => editFrom(t)}
                      aria-label={`Open ${t.name || 'untitled intake form'}`}
                    >
                      <span className="li-viewlist-name">{t.name || '(untitled)'}</span>
                      <StatusBadge active />
                      <span className="li-viewlist-meta">
                        {t.fieldCount} question{t.fieldCount === 1 ? '' : 's'}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="li-int-card-menu-btn"
                      aria-label={`More actions for ${t.name || 'untitled intake form'}`}
                      aria-expanded={menuOpen}
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenMenuId(menuOpen ? null : t.questionnaireTemplateId)
                      }}
                    >
                      <MoreHorizontalIcon size={16} />
                    </button>
                    {menuOpen && (
                      <div className="li-int-card-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenMenuId(null)
                            setModalQuestionnaire(t)
                          }}
                        >
                          Edit in window
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="li-int-card-menu-danger"
                          onClick={() => {
                            setOpenMenuId(null)
                            void archive(t)
                          }}
                        >
                          Archive
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
              {/* Service-bound intake forms — every service's questionnaire, so
                  this page is the full inventory. Edited in the service builder. */}
              {(svcForms ?? []).map((f) => (
                <Link
                  key={`svc-${f.serviceKey}`}
                  href={`/attorney/services/${encodeURIComponent(f.serviceKey)}/questionnaire`}
                  className="li-viewlist-row"
                  aria-label={`Open ${f.title} (edited in the ${f.serviceName} service)`}
                >
                  <span className="li-viewlist-name">{f.title}</span>
                  <StatusBadge active={f.isActive} />
                  <span className="li-viewlist-meta">
                    {f.fieldCount} question{f.fieldCount === 1 ? '' : 's'}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

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
                placeholder="e.g. LLC formation intake"
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
