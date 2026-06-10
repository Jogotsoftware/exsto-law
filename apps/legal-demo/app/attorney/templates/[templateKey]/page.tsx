'use client'

import { use, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { TemplateEditor, type TemplateEditorHandle } from '@/components/templates/TemplateEditor'
import { PlusIcon } from '@/components/icons'

type VariableType = 'text' | 'longtext' | 'date' | 'number' | 'email' | 'select'

interface TemplateVariable {
  name: string
  label: string
  type: VariableType
  sample: string | null
  description: string | null
  required: boolean
  options: string[] | null
}

interface Template {
  id: string
  templateKey: string
  displayName: string
  description: string | null
  bodyMd: string
  bodyHtml: string
  variableSchema: TemplateVariable[]
  isActive: boolean
  updatedAt: string
}

const TYPE_LABELS: Record<VariableType, string> = {
  text: 'Text',
  longtext: 'Long text',
  date: 'Date',
  number: 'Number',
  email: 'Email',
  select: 'Select (choices)',
}

const COMMON_VARIABLES: { name: string; label: string }[] = [
  { name: 'company_name', label: 'Company name' },
  { name: 'member_full_name', label: 'Member full name' },
  { name: 'member_address', label: 'Member address' },
  { name: 'effective_date', label: 'Effective date' },
  { name: 'principal_office_address', label: 'Principal office address' },
  { name: 'registered_agent_name', label: 'Registered agent name' },
  { name: 'registered_agent_address', label: 'Registered agent address' },
  { name: 'fiscal_year_end', label: 'Fiscal year end' },
  { name: 'capital_contribution', label: 'Capital contribution' },
  { name: 'company_purpose', label: 'Company purpose' },
  { name: 'client_full_name', label: 'Client full name' },
  { name: 'client_email', label: 'Client email' },
  { name: 'attorney_name', label: 'Attorney name' },
  { name: 'firm_name', label: 'Firm name' },
  { name: 'firm_address', label: 'Firm address' },
]

export default function EditTemplatePage({ params }: { params: Promise<{ templateKey: string }> }) {
  const { templateKey } = use(params)
  const router = useRouter()
  const [template, setTemplate] = useState<Template | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [variables, setVariables] = useState<TemplateVariable[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const editorRef = useRef<TemplateEditorHandle | null>(null)

  useEffect(() => {
    callAttorneyMcp<{ template: Template | null }>({
      toolName: 'legal.template.get',
      input: { templateKey },
    })
      .then((r) => {
        if (!r.template) {
          setError('Template not found')
          return
        }
        setTemplate(r.template)
        setDisplayName(r.template.displayName)
        setDescription(r.template.description ?? '')
        setBodyHtml(r.template.bodyHtml || `<p>${escape(r.template.bodyMd)}</p>`)
        setVariables(r.template.variableSchema ?? [])
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [templateKey])

  async function save() {
    setBusy('save')
    setError(null)
    setSuccess(false)
    try {
      const html = editorRef.current?.getHTML() ?? bodyHtml
      await callAttorneyMcp({
        toolName: 'legal.template.update',
        input: {
          templateKey,
          displayName,
          description: description || null,
          bodyHtml: html,
          variableSchema: variables,
        },
      })
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function cloneNow() {
    setBusy('clone')
    setError(null)
    try {
      // Save current edits to the source first so the clone reflects them.
      const html = editorRef.current?.getHTML() ?? bodyHtml
      await callAttorneyMcp({
        toolName: 'legal.template.update',
        input: {
          templateKey,
          displayName,
          description: description || null,
          bodyHtml: html,
          variableSchema: variables,
        },
      })
      const r = await callAttorneyMcp<{ template: { templateKey: string } }>({
        toolName: 'legal.template.clone',
        input: { templateKey },
      })
      router.push(`/attorney/templates/${r.template.templateKey}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  function insertVariable(name: string) {
    editorRef.current?.insertVariable(name)
    // If the variable isn't in the schema yet, add it as text by default.
    setVariables((prev) => {
      if (prev.some((v) => v.name === name)) return prev
      return [...prev, blankVariable(name)]
    })
  }

  function addBlankVariable() {
    const name = prompt('Variable name (snake_case, no braces):')
    if (!name) return
    const clean = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
    if (!clean) return
    if (variables.some((v) => v.name === clean)) {
      insertVariable(clean)
      return
    }
    setVariables((prev) => [...prev, blankVariable(clean)])
    insertVariable(clean)
  }

  function updateVariable(idx: number, patch: Partial<TemplateVariable>) {
    setVariables((prev) => prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)))
  }

  function removeVariable(idx: number) {
    setVariables((prev) => prev.filter((_, i) => i !== idx))
  }

  const commonNotYetAdded = useMemo(() => {
    const have = new Set(variables.map((v) => v.name))
    return COMMON_VARIABLES.filter((v) => !have.has(v.name))
  }, [variables])

  if (error && !template)
    return (
      <main>
        <pre style={{ color: 'var(--danger)' }}>{error}</pre>
      </main>
    )
  if (!template)
    return (
      <main>
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      </main>
    )

  return (
    <main>
      <p style={{ fontSize: '0.88rem' }}>
        <Link href="/attorney/templates">← All templates</Link>
      </p>

      <div className="attorney-page-head">
        <h1>Edit template</h1>
        <div className="head-actions">
          <button onClick={() => router.push('/attorney/templates')}>Cancel</button>
          <button onClick={cloneNow} disabled={busy !== null}>
            {busy === 'clone' ? 'Cloning…' : 'Save as new'}
          </button>
          <button className="primary" onClick={save} disabled={busy !== null}>
            {busy === 'save' && <span className="spinner" />}
            {busy === 'save' ? ' Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && (
        <div
          className="alert"
          style={{ background: 'var(--ok-soft)', color: '#166534', border: '1px solid #86efac' }}
        >
          Saved.
        </div>
      )}

      <section>
        <div className="settings-grid">
          <label>
            <span>Template name</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>
            <span>Key (URL slug)</span>
            <input value={template.templateKey} disabled readOnly />
          </label>
        </div>
        <label>
          <span>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What this template is for. Shows in the templates list."
          />
        </label>
      </section>

      <div className="tpl-edit-layout">
        <div className="tpl-edit-main">
          <h2 style={{ marginTop: 0 }}>Document body</h2>
          <p style={{ color: 'var(--muted)', fontSize: '0.88rem', marginTop: 0 }}>
            Click a variable on the right to insert it at the cursor. Variables appear as
            <span className="tpl-var-chip tpl-var-chip-inline">{'{{example}}'}</span>
            chips and are filled in at drafting time.
          </p>
          <TemplateEditor
            initialHtml={bodyHtml}
            placeholder="Start drafting…"
            onChange={setBodyHtml}
            editorRef={editorRef}
          />
        </div>

        <aside className="tpl-edit-side">
          <div className="tpl-side-section">
            <div className="tpl-side-head">
              <h3>Variables in this template</h3>
              <button className="tpl-side-add" onClick={addBlankVariable} title="Add variable">
                <PlusIcon size={12} /> Add
              </button>
            </div>
            {variables.length === 0 ? (
              <p className="tpl-side-empty">
                No variables yet. Click a common variable below or add your own.
              </p>
            ) : (
              <ul className="tpl-var-list">
                {variables.map((v, i) => (
                  <li key={v.name + i}>
                    <div className="tpl-var-row">
                      <button
                        type="button"
                        className="tpl-var-chip tpl-var-chip-clickable"
                        onClick={() => insertVariable(v.name)}
                        title={`Insert {{${v.name}}}`}
                      >
                        {`{{${v.name}}}`}
                      </button>
                      <button
                        type="button"
                        className="tpl-var-rm"
                        onClick={() => removeVariable(i)}
                        title="Remove from schema"
                      >
                        ×
                      </button>
                    </div>
                    <div className="tpl-var-fields">
                      <label>
                        <span>Label</span>
                        <input
                          value={v.label}
                          onChange={(e) => updateVariable(i, { label: e.target.value })}
                          placeholder="Human-friendly label"
                        />
                      </label>
                      <label>
                        <span>Type</span>
                        <select
                          value={v.type}
                          onChange={(e) =>
                            updateVariable(i, { type: e.target.value as VariableType })
                          }
                        >
                          {(Object.keys(TYPE_LABELS) as VariableType[]).map((t) => (
                            <option key={t} value={t}>
                              {TYPE_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Sample value</span>
                        <input
                          value={v.sample ?? ''}
                          onChange={(e) => updateVariable(i, { sample: e.target.value || null })}
                          placeholder={v.type === 'date' ? '2026-01-15' : 'Example value'}
                        />
                      </label>
                      {v.type === 'select' && (
                        <label>
                          <span>Options (comma-separated)</span>
                          <input
                            value={(v.options ?? []).join(', ')}
                            onChange={(e) =>
                              updateVariable(i, {
                                options: e.target.value
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              })
                            }
                          />
                        </label>
                      )}
                      <label className="tpl-var-required">
                        <input
                          type="checkbox"
                          checked={v.required}
                          onChange={(e) => updateVariable(i, { required: e.target.checked })}
                        />
                        <span>Required</span>
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="tpl-side-section">
            <div className="tpl-side-head">
              <h3>Common variables</h3>
            </div>
            <p className="tpl-side-hint">Click to insert at the cursor.</p>
            <div className="tpl-common-grid">
              {commonNotYetAdded.length === 0 && (
                <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                  All added to this template.
                </span>
              )}
              {commonNotYetAdded.map((v) => (
                <button
                  key={v.name}
                  type="button"
                  className="tpl-common-chip"
                  onClick={() => insertVariable(v.name)}
                  title={`Insert {{${v.name}}}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}

function escape(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)
}

function blankVariable(name: string): TemplateVariable {
  return {
    name,
    label: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    type: 'text',
    sample: null,
    description: null,
    required: false,
    options: null,
  }
}
