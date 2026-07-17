'use client'

import { useRef } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { ConfigEditModal } from '@/components/ConfigEditModal'
import { TemplatePreview } from '@/components/templates/TemplatePreview'
import { TemplateEditor, type TemplateEditorHandle } from '@/components/templates/TemplateEditor'
import { WorkflowStepList } from '@/components/WorkflowStepList'
import type { TemplateVariables } from '@exsto/legal'

// UI-BUILDER-FIX-1 Phase 9 — the four pre-wired edit-in-modal launchers. Each is
// ConfigEditModal (the ONE shared shell) + this type's renderers and write
// actions. Every surface mounts one of these; none of them navigates away.

// ── Template: formatted document preview + TipTap rich-text editor ──────────
export function TemplateConfigModal({
  template,
  onClose,
  onChanged,
}: {
  template: {
    templateEntityId: string
    name: string
    body: string
    variables?: TemplateVariables
  }
  onClose: () => void
  onChanged?: () => void
}) {
  const editorRef = useRef<TemplateEditorHandle | null>(null)
  return (
    <ConfigEditModal
      artifactKind="template"
      targetId={template.templateEntityId}
      title={`Template — ${template.name}`}
      initialContent={template.body}
      renderView={(content) => <TemplatePreview body={content} variables={template.variables} />}
      renderEdit={(content, onChange) => (
        <TemplateEditor initialHtml={content} onChange={onChange} editorRef={editorRef} />
      )}
      onSave={async (content) => {
        await callAttorneyMcp({
          toolName: 'legal.template.update',
          input: { templateEntityId: template.templateEntityId, body: content },
        })
      }}
      onClose={onClose}
      onChanged={onChanged}
    />
  )
}

// ── Questionnaire (library template): field read-out + JSON editor ──────────
interface QSchema {
  sections?: Array<{
    id?: string
    title?: string
    fields?: Array<{ id?: string; label?: string; type?: string; required?: boolean }>
  }>
}

export function QuestionnaireView({ content }: { content: string }) {
  let schema: QSchema | null = null
  try {
    schema = JSON.parse(content) as QSchema
  } catch {
    /* fall through to raw */
  }
  if (!schema?.sections) return <pre style={{ whiteSpace: 'pre-wrap' }}>{content}</pre>
  return (
    <div>
      {schema.sections.map((s, i) => (
        <div key={s.id ?? i} style={{ marginBottom: 10 }}>
          <strong>{s.title || s.id || `Section ${i + 1}`}</strong>
          <ul style={{ margin: '4px 0 0 18px' }}>
            {(s.fields ?? []).map((f, j) => (
              <li key={f.id ?? j}>
                {f.label || f.id}{' '}
                <span className="text-muted text-sm">
                  · {f.type ?? 'text'}
                  {f.required ? ' · required' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export function jsonEditor(content: string, onChange: (next: string) => void) {
  return (
    <textarea
      className="input"
      style={{ width: '100%', minHeight: 320, fontFamily: 'monospace', fontSize: 13 }}
      value={content}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
    />
  )
}

export function QuestionnaireConfigModal({
  questionnaire,
  onClose,
  onChanged,
}: {
  questionnaire: { questionnaireTemplateId: string; name: string; schema: unknown }
  onClose: () => void
  onChanged?: () => void
}) {
  return (
    <ConfigEditModal
      artifactKind="questionnaire"
      targetId={questionnaire.questionnaireTemplateId}
      title={`Questionnaire — ${questionnaire.name}`}
      initialContent={JSON.stringify(questionnaire.schema ?? { sections: [] }, null, 2)}
      renderView={(content) => <QuestionnaireView content={content} />}
      renderEdit={jsonEditor}
      onSave={async (content) => {
        await callAttorneyMcp({
          toolName: 'legal.questionnaire_template.update',
          input: {
            questionnaireTemplateId: questionnaire.questionnaireTemplateId,
            schema: JSON.parse(content),
          },
        })
      }}
      onClose={onClose}
      onChanged={onChanged}
    />
  )
}

// ── Workflow: the SAME step-list a live matter renders + JSON editor ─────────
interface WfStageLite {
  key?: string
  label?: string
  client_label?: string
  terminal?: boolean
  action?: { kind?: string }
  advances_to?: Array<{ gate?: string }>
}

export function WorkflowView({ content }: { content: string }) {
  let graph: WfStageLite[] | null = null
  try {
    graph = JSON.parse(content) as WfStageLite[]
  } catch {
    /* raw */
  }
  if (!Array.isArray(graph)) return <pre style={{ whiteSpace: 'pre-wrap' }}>{content}</pre>
  return (
    <WorkflowStepList
      showStatePill={false}
      items={graph.map((s, i) => ({
        key: s.key ?? String(i),
        title: s.label ?? s.key ?? `Step ${i + 1}`,
        subtitle: s.client_label && s.client_label !== s.label ? s.client_label : undefined,
        state: 'pending' as const,
        meta: [
          s.action?.kind?.replace(/_/g, ' '),
          s.terminal ? 'final step' : s.advances_to?.[0]?.gate,
        ]
          .filter(Boolean)
          .join(' · '),
      }))}
    />
  )
}

// ── Billing config: cost summary + JSON editor over the service's cost ───────
interface CostDoc {
  costType?: 'fixed' | 'hourly'
  amount?: string
  hours?: number | null
}

export function BillingView({ content }: { content: string }) {
  let cost: CostDoc | null = null
  try {
    cost = JSON.parse(content) as CostDoc
  } catch {
    /* raw */
  }
  if (!cost) return <pre style={{ whiteSpace: 'pre-wrap' }}>{content}</pre>
  return (
    <ul style={{ margin: '4px 0 0 18px' }}>
      <li>
        <strong>Type:</strong> {cost.costType === 'hourly' ? 'Hourly' : 'Flat fee'}
      </li>
      <li>
        <strong>Amount:</strong> ${cost.amount ?? '—'}
        {cost.costType === 'hourly' ? '/hr' : ''}
      </li>
      {cost.costType === 'hourly' && cost.hours != null && (
        <li>
          <strong>Estimated hours:</strong> {cost.hours}
        </li>
      )}
    </ul>
  )
}
