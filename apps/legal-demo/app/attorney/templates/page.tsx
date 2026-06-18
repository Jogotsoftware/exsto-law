'use client'

// Templates tab — the firm's reusable, NOT-service-bound template library (Obj 9).
// The standalone-template backend (legal.template.* + queries/templates.ts) was
// built for "the Templates tab" but never had a surface; this is it. Document and
// email templates with {{tokens}}, edited as markdown/text (the body is text, not
// the service editor's rich HTML). CRUD through the through-core legal.template.* tools.

import { useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

type Category = 'document' | 'email'

interface Template {
  templateEntityId: string
  name: string
  category: Category
  body: string
  docKind: string | null
  updatedAt: string
}

interface Draft {
  templateEntityId: string | null // null = new
  name: string
  category: Category
  body: string
  docKind: string
}

const EMPTY_DRAFT: Draft = {
  templateEntityId: null,
  name: '',
  category: 'document',
  body: '',
  docKind: '',
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  function load() {
    setError(null)
    callAttorneyMcp<{ templates: Template[] }>({ toolName: 'legal.template.list' })
      .then((res) => setTemplates(res.templates))
      .catch((err) => setError(err.message))
  }
  useEffect(load, [])

  function edit(t: Template) {
    setDraft({
      templateEntityId: t.templateEntityId,
      name: t.name,
      category: t.category,
      body: t.body,
      docKind: t.docKind ?? '',
    })
  }

  async function save() {
    if (!draft) return
    if (!draft.name.trim()) {
      setError('Give the template a name.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (draft.templateEntityId) {
        await callAttorneyMcp({
          toolName: 'legal.template.update',
          input: {
            templateEntityId: draft.templateEntityId,
            name: draft.name.trim(),
            body: draft.body,
            docKind: draft.category === 'document' ? draft.docKind.trim() || null : null,
          },
        })
      } else {
        await callAttorneyMcp({
          toolName: 'legal.template.create',
          input: {
            name: draft.name.trim(),
            category: draft.category,
            body: draft.body,
            docKind: draft.category === 'document' ? draft.docKind.trim() || undefined : undefined,
          },
        })
      }
      setDraft(null)
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function archive(t: Template) {
    if (
      !window.confirm(
        `Archive "${t.name}"? It will be removed from the active library (kept as history).`,
      )
    )
      return
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.template.archive',
        input: { templateEntityId: t.templateEntityId },
      })
      if (draft?.templateEntityId === t.templateEntityId) setDraft(null)
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <main>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <h1>Templates</h1>
        {!draft && (
          <button className="primary" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            New template
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: '-0.5rem' }}>
        Reusable document &amp; email templates for the whole firm. Use <code>{'{{tokens}}'}</code>{' '}
        for merge fields.
      </p>

      {error && <pre className="error">{error}</pre>}

      {draft && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ marginTop: 0 }}>
            {draft.templateEntityId ? 'Edit template' : 'New template'}
          </h2>
          <div style={{ display: 'grid', gap: '0.85rem', maxWidth: '52rem' }}>
            <label>
              <span className="field-label">Name</span>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Mutual NDA"
              />
            </label>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <label>
                <span className="field-label">Type</span>
                <select
                  value={draft.category}
                  disabled={!!draft.templateEntityId}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value as Category })}
                >
                  <option value="document">Document</option>
                  <option value="email">Email</option>
                </select>
              </label>
              {draft.category === 'document' && (
                <label>
                  <span className="field-label">Document kind (optional)</span>
                  <input
                    type="text"
                    value={draft.docKind}
                    onChange={(e) => setDraft({ ...draft, docKind: e.target.value })}
                    placeholder="e.g. nda"
                  />
                </label>
              )}
            </div>
            <label>
              <span className="field-label">Body</span>
              <textarea
                rows={16}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                placeholder={'Dear {{client_name}},\n\n…'}
                style={{
                  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                  fontSize: '0.9rem',
                  lineHeight: 1.5,
                }}
              />
            </label>
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button className="primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : draft.templateEntityId ? 'Save changes' : 'Create template'}
              </button>
              <button className="btn-secondary" onClick={() => setDraft(null)} disabled={saving}>
                Cancel
              </button>
            </div>
          </div>
        </section>
      )}

      {templates === null && !error && (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      )}
      {templates && templates.length === 0 && !draft && (
        <section>
          <p>No templates yet. Create your first reusable document or email template.</p>
        </section>
      )}
      {templates && templates.length > 0 && (
        <section style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Document kind</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.templateEntityId}>
                  <td>{t.name || '(untitled)'}</td>
                  <td>
                    <span className={`badge ${t.category === 'email' ? 'info' : ''}`}>
                      {t.category}
                    </span>
                  </td>
                  <td>{t.docKind ?? '—'}</td>
                  <td>{new Date(t.updatedAt).toLocaleDateString()}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn-secondary" onClick={() => edit(t)}>
                      Edit
                    </button>{' '}
                    <button className="btn-secondary" onClick={() => archive(t)}>
                      Archive
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  )
}
