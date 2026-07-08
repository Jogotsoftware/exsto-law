// Data-as-schema chat tools (Build-Wizard, Tier 1). Two ClientTools:
//   • buildKindContextTool — READ-ONLY: existing entity/attribute/relationship/
//     event kinds, so the model REUSES a kind instead of duplicating it, and
//     attaches attributes/relationships to REAL entity kinds.
//   • buildProposeKindTool — CAPTURE-ONLY: validates a proposed new data kind and
//     captures it as an approval card. Nothing is minted until the attorney
//     approves (kind.define runs on approve). Executable capabilities (steps,
//     gates, field types) are NOT proposable here — those go to request_capability.
import type { ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'
import {
  loadKindAuthoringContext,
  validateProposedKind,
  PROPOSABLE_REGISTRIES,
  KIND_VALUE_TYPES,
  type KindProposal,
  type ProposableRegistry,
  type KindValueType,
} from './kindAuthoring.js'

const KIND_CONTEXT_TOOL_DEF = {
  name: 'get_kind_context',
  description:
    "Get the platform's existing DATA kinds for this firm — entity kinds (the things it tracks, e.g. matter, client, document), attribute kinds (fields), relationship kinds, and event kinds — so you REUSE an existing kind instead of proposing a duplicate, and so you attach a new attribute/relationship to a REAL entity kind. Call this before propose_kind. Reminder: workflow steps, gates, and questionnaire FIELD TYPES are NOT data kinds — they are closed executable catalogs; if one is missing use request_capability, never propose_kind. Read-only.",
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
}

export function buildKindContextTool(ctx: ActionContext): ClientTool {
  return {
    definition: KIND_CONTEXT_TOOL_DEF,
    name: 'get_kind_context',
    run: async () => JSON.stringify(await loadKindAuthoringContext(ctx)),
  }
}

const PROPOSE_KIND_TOOL_DEF = {
  name: 'propose_kind',
  description:
    'Propose a genuinely NEW data kind for the attorney to APPROVE — when a novel practice area needs to track something the platform has no kind for yet (e.g. a matter needs a `serial_number` attribute, or an `opposition_deadline` event). This does NOT mint anything — it captures a proposal the attorney approves as a card; the kind is created only on approval. Use ONLY when get_kind_context shows nothing existing fits (reuse first). Registries you may propose: entity (a new thing tracked), attribute (a field on an existing entity — give onEntityKind + valueType), relationship (a link — give sourceEntityKind + targetEntityKind), event (a milestone). NEVER propose a workflow step, gate, or questionnaire field type here — those are closed; use request_capability. Put the proposal ONLY in this tool call.',
  input_schema: {
    type: 'object',
    properties: {
      registry: {
        type: 'string',
        enum: PROPOSABLE_REGISTRIES as unknown as string[],
        description: 'entity | attribute | relationship | event.',
      },
      kind_name: {
        type: 'string',
        description:
          'snake_case identifier, e.g. serial_number, opposition_deadline. Reused as the merge/field id.',
      },
      display_name: { type: 'string', description: 'Human name, e.g. "Trademark serial number".' },
      description: { type: 'string', description: 'What this kind captures and why.' },
      on_entity_kind: {
        type: 'string',
        description:
          'attribute ONLY: the existing entity kind it attaches to (e.g. matter). Must be a real kind from get_kind_context.',
      },
      value_type: {
        type: 'string',
        enum: KIND_VALUE_TYPES as unknown as string[],
        description: 'attribute ONLY: text | number | boolean | date | json.',
      },
      source_entity_kind: {
        type: 'string',
        description: 'relationship ONLY: the source entity kind.',
      },
      target_entity_kind: {
        type: 'string',
        description: 'relationship ONLY: the target entity kind.',
      },
      summary: {
        type: 'string',
        description:
          'One-paragraph WHY, shown to the attorney and recorded as the reasoning trace on approve.',
      },
      confidence: { type: 'number', description: 'Honest confidence 0–1 (never 1.0).' },
    },
    required: ['registry', 'kind_name', 'display_name'],
    additionalProperties: false,
  },
}

export function buildProposeKindTool(ctx: ActionContext, captured: KindProposal[]): ClientTool {
  return {
    definition: PROPOSE_KIND_TOOL_DEF,
    name: 'propose_kind',
    run: async (raw) => {
      const args = (raw ?? {}) as {
        registry?: string
        kind_name?: string
        display_name?: string
        description?: string
        on_entity_kind?: string
        value_type?: string
        source_entity_kind?: string
        target_entity_kind?: string
        summary?: string
        confidence?: number
      }
      const context = await loadKindAuthoringContext(ctx)
      const validation = validateProposedKind(
        {
          registry: (args.registry ?? '').trim(),
          kindName: (args.kind_name ?? '').trim(),
          displayName: (args.display_name ?? '').trim(),
          onEntityKind: (args.on_entity_kind ?? '').trim() || null,
          valueType: (args.value_type ?? '').trim() || null,
          sourceEntityKind: (args.source_entity_kind ?? '').trim() || null,
          targetEntityKind: (args.target_entity_kind ?? '').trim() || null,
        },
        context,
      )
      if (!validation.ok) {
        return `The proposed kind is not valid and was NOT captured. Fix these and call propose_kind AGAIN — NEVER paste the artifact into your prose reply (prose has no Approve button): ${validation.errors.join('; ')}`
      }
      const confidence =
        typeof args.confidence === 'number' && Number.isFinite(args.confidence)
          ? Math.min(0.99, Math.max(0, args.confidence))
          : 0.7
      captured.push({
        registry: (args.registry as ProposableRegistry) ?? 'attribute',
        kindName: validation.normalizedKindName,
        displayName: (args.display_name ?? '').trim(),
        description: (args.description ?? '').trim() || null,
        onEntityKind: (args.on_entity_kind ?? '').trim() || null,
        valueType: ((args.value_type ?? '').trim() as KindValueType) || null,
        sourceEntityKind: (args.source_entity_kind ?? '').trim() || null,
        targetEntityKind: (args.target_entity_kind ?? '').trim() || null,
        summary:
          (args.summary ?? '').trim() ||
          `Proposed new ${args.registry} kind "${validation.normalizedKindName}".`,
        confidence,
      })
      return `The proposed ${args.registry} kind "${validation.normalizedKindName}" is shown to the attorney as an approval card; it is NOT created until they approve. Reply with ONE short sentence pointing them to it; do NOT repeat the proposal in prose.`
    },
  }
}
