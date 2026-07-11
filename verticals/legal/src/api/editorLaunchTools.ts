// HARDENING-RESIDUALS-1 (WP-H2) — launch a REAL editor from chat. "Edit the
// lease review questionnaire" opens the same pop-up editor the standalone
// surfaces use (ConfigEditModal + the type's renderers), pre-loaded on the
// existing artifact; saves go through the same core update paths. This
// generalizes the Contract-D launch-UI-from-chat pattern: the tool RESOLVES
// the artifact server-side (and forces a confirmation when the reference is
// ambiguous), captures a launch descriptor, and the chat surfaces it as an
// editor pop-up after the model loop — the tool itself writes nothing.
import type { ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'
import { listStandaloneTemplates } from '../queries/templates.js'
import { listQuestionnaireTemplates } from '../queries/questionnaireLibrary.js'
import { getServiceLifecycle } from './serviceLifecycle.js'

export type EditorArtifactType = 'template' | 'questionnaire' | 'workflow'

// Everything the client needs to open the right Config*Modal without another
// round-trip: the artifact's id, display name, and current content.
export interface EditorLaunch {
  artifactType: EditorArtifactType
  id: string
  name: string
  // template → body (markdown/html); questionnaire → schema JSON;
  // workflow → the service's current lifecycle graph JSON.
  content: unknown
  // Template variables ride along so the template preview renders tokens.
  variables?: unknown
}

const OPEN_EDITOR_TOOL_DEF = {
  name: 'open_artifact_editor',
  description:
    "Open the firm's REAL editor pop-up on an EXISTING artifact when the attorney asks to edit one: a document template ('edit the engagement letter template'), a service's intake questionnaire ('edit the lease review questionnaire'), or a service's workflow ('edit the lease review workflow'). Pass what the attorney called it — the platform resolves it by name/key. If more than one artifact matches, the result lists the candidates: ask the attorney WHICH one (plain language), then call again with the exact name. The editor saves through the same paths as the standalone pages; this tool itself changes nothing. Use ONLY for existing artifacts — proposals inside a guided build already have their own Edit button.",
  input_schema: {
    type: 'object',
    properties: {
      artifact_type: {
        type: 'string',
        enum: ['template', 'questionnaire', 'workflow'],
        description:
          "What kind of artifact to edit: 'template' (a document template), 'questionnaire' (a service's intake form), 'workflow' (a service's step-by-step lifecycle).",
      },
      name: {
        type: 'string',
        description:
          'The artifact as the attorney referred to it — a template/questionnaire name or a service name/key. Partial names are matched case-insensitively.',
      },
    },
    required: ['artifact_type', 'name'],
    additionalProperties: false,
  },
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function matches(candidate: string, query: string): boolean {
  const c = normalize(candidate)
  const q = normalize(query)
  return c === q || c.includes(q) || q.includes(c)
}

export function buildOpenEditorTool(ctx: ActionContext, captured: EditorLaunch[]): ClientTool {
  return {
    definition: OPEN_EDITOR_TOOL_DEF,
    name: 'open_artifact_editor',
    run: async (raw) => {
      const args = (raw ?? {}) as { artifact_type?: string; name?: string }
      const type = (args.artifact_type ?? '').trim() as EditorArtifactType
      const query = (args.name ?? '').trim()
      if (!query || !['template', 'questionnaire', 'workflow'].includes(type)) {
        return 'artifact_type (template | questionnaire | workflow) and name are required; nothing was opened.'
      }

      if (type === 'template') {
        const all = await listStandaloneTemplates(ctx)
        const hits = all.filter((t) => matches(t.name, query))
        if (hits.length === 0) {
          return `No template matched "${query}". The firm's templates: ${all.map((t) => t.name).join('; ') || '(none)'}. Ask the attorney which one they mean.`
        }
        if (hits.length > 1) {
          return `More than one template matches "${query}": ${hits.map((t) => t.name).join('; ')}. Ask the attorney WHICH one, then call again with its exact name.`
        }
        const t = hits[0]!
        captured.push({
          artifactType: 'template',
          id: t.templateEntityId,
          name: t.name,
          content: t.body,
          variables: t.variables,
        })
        return `The editor for template "${t.name}" is open for the attorney. Reply with ONE short sentence pointing them to it; do not repeat its content.`
      }

      if (type === 'questionnaire') {
        const all = await listQuestionnaireTemplates(ctx)
        const hits = all.filter((q) => matches(q.name, query))
        if (hits.length === 0) {
          return `No questionnaire matched "${query}". The firm's questionnaires: ${all.map((q) => q.name).join('; ') || '(none)'}. Ask the attorney which one they mean.`
        }
        if (hits.length > 1) {
          return `More than one questionnaire matches "${query}": ${hits.map((q) => q.name).join('; ')}. Ask the attorney WHICH one, then call again with its exact name.`
        }
        const q = hits[0]!
        captured.push({
          artifactType: 'questionnaire',
          id: q.questionnaireTemplateId,
          name: q.name,
          content: q.schema,
        })
        return `The editor for questionnaire "${q.name}" is open for the attorney. Reply with ONE short sentence pointing them to it; do not repeat its content.`
      }

      // workflow — resolve by service key via the lifecycle read.
      try {
        const lifecycle = await getServiceLifecycle(ctx, query)
        const graph = (lifecycle as { graph?: unknown } | null)?.graph ?? null
        if (!graph) throw new Error('no lifecycle')
        captured.push({
          artifactType: 'workflow',
          id: query,
          name: query,
          content: graph,
        })
        return `The workflow editor for "${query}" is open for the attorney. Reply with ONE short sentence pointing them to it.`
      } catch {
        return `No service workflow matched "${query}" — pass the service's key exactly (call get_workflow_context / get_service_context to list existing services and their keys), or ask the attorney which service they mean.`
      }
    },
  }
}
