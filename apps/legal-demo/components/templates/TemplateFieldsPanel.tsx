'use client'

// Fields panel — configure the typed metadata for each {{token}} in the template
// body: its type, whether it's required, a default, and (for a choice) options.
// The panel shows one row per token currently in the body; edits flow up via
// onChange as a TemplateVariables map (keyed by lowercased token id).

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
}: {
  tokens: string[]
  variables: TemplateVariables
  onChange: (next: TemplateVariables) => void
}) {
  function update(token: string, patch: Partial<TemplateVariableSpec>) {
    const current: TemplateVariableSpec = variables[token] ?? { type: 'text' }
    onChange({ ...variables, [token]: { ...current, ...patch } })
  }

  if (tokens.length === 0) {
    return (
      <p className="text-muted text-sm tpl-fields-empty">
        No fields yet. Insert a <code>{'{{token}}'}</code> into the document and it will appear here
        to configure its type, default, and whether it&apos;s required.
      </p>
    )
  }

  return (
    <div className="tpl-fields">
      <table className="tpl-fields-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th style={{ textAlign: 'center' }}>Required</th>
            <th>Default / options</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => {
            const spec: TemplateVariableSpec = variables[t] ?? { type: 'text' }
            return (
              <tr key={t}>
                <td>
                  <code>{`{{${t}}}`}</code>
                  <div className="text-muted text-xs">{humanize(t)}</div>
                </td>
                <td>
                  <select
                    value={spec.type}
                    onChange={(e) => update(t, { type: e.target.value as TemplateVariableType })}
                  >
                    {TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={!!spec.required}
                    onChange={(e) => update(t, { required: e.target.checked })}
                    aria-label={`Require ${humanize(t)}`}
                  />
                </td>
                <td>
                  {spec.type === 'choice' ? (
                    <input
                      type="text"
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
                      placeholder={spec.type === 'date' ? 'e.g. today' : 'Default (optional)'}
                      value={spec.default ?? ''}
                      onChange={(e) => update(t, { default: e.target.value || undefined })}
                    />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
