'use client'

// Merge-fields panel — the right rail of the WP-E template editor (comp:
// docs/design/legal-instruments TEMPLATE EDITOR § "Merge fields"). One card per
// {{token}} already used in the body: the token chip (click to insert it again
// at the cursor), a Required toggle, the humanized field label, and a type
// select (7 types — text/textarea/date/number/currency/boolean/choice). Editing
// type/required/default flows up via onChange as a TemplateVariables map, same
// contract as before this restyle (this component's only consumer is
// app/attorney/templates/page.tsx).

import type { TemplateVariables, TemplateVariableSpec, TemplateVariableType } from '@exsto/legal'

const TYPE_OPTIONS: { value: TemplateVariableType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'date', label: 'Date' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'choice', label: 'Choice' },
]

function humanize(token: string): string {
  const s = token.replace(/_/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : token
}

export function TemplateFieldsPanel({
  tokens,
  variables,
  onChange,
  onInsert,
}: {
  tokens: string[]
  variables: TemplateVariables
  onChange: (next: TemplateVariables) => void
  // Click the token chip to insert {{token}} at the editor cursor again.
  onInsert?: (token: string) => void
}) {
  function update(token: string, patch: Partial<TemplateVariableSpec>) {
    const current: TemplateVariableSpec = variables[token] ?? { type: 'text' }
    onChange({ ...variables, [token]: { ...current, ...patch } })
  }

  if (tokens.length === 0) {
    return (
      <p className="li-tpl-fields-empty">
        No fields yet. Insert a <code>{'{{token}}'}</code> into the document and it will appear here
        to configure its type, default, and whether it&apos;s required.
      </p>
    )
  }

  return (
    <div className="li-tpl-fields">
      {tokens.map((t) => {
        const spec: TemplateVariableSpec = variables[t] ?? { type: 'text' }
        return (
          <div key={t} className="li-tpl-field-card">
            <div className="li-tpl-field-row">
              <button
                type="button"
                className="li-tpl-field-chip"
                onClick={() => onInsert?.(t)}
                title={`Insert {{${t}}} at the cursor`}
              >
                {`{{${t}}}`}
              </button>
              <label className="li-tpl-field-required">
                <input
                  type="checkbox"
                  checked={!!spec.required}
                  onChange={(e) => update(t, { required: e.target.checked })}
                  aria-label={`Require ${humanize(t)}`}
                />
                Required
              </label>
            </div>
            <div className="li-tpl-field-row li-tpl-field-row--meta">
              <span className="li-tpl-field-label">{humanize(t)}</span>
              <select
                className="li-tpl-field-type"
                value={spec.type}
                onChange={(e) => update(t, { type: e.target.value as TemplateVariableType })}
                aria-label={`${humanize(t)} type`}
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {spec.type === 'choice' ? (
              <input
                type="text"
                className="li-tpl-field-default"
                placeholder="Option A, Option B, …"
                value={(spec.options ?? []).join(', ')}
                onChange={(e) =>
                  update(t, {
                    options: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            ) : (
              <input
                type="text"
                className="li-tpl-field-default"
                placeholder={spec.type === 'date' ? 'Default, e.g. today' : 'Default (optional)'}
                value={spec.default ?? ''}
                onChange={(e) => update(t, { default: e.target.value || undefined })}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
