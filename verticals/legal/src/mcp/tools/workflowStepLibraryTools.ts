import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  listWorkflowStepTemplates,
  getWorkflowStepTemplate,
  createWorkflowStepTemplate,
  updateWorkflowStepTemplate,
  archiveWorkflowStepTemplate,
  STEP_ACTION_KINDS,
  GATE_KINDS,
  type WorkflowStepTemplate,
  type CreateWorkflowStepTemplateInput,
  type UpdateWorkflowStepTemplateInput,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Workflow STEP library (migration 0095, ADR 0045 PR4c) — the firm's reusable,
// NOT-service-bound workflow STEPS, droppable into any service's lifecycle from
// the make.com-style Workflow builder. Mirrors the questionnaire library tools.
// Attorney-only (not in CLIENT_PORTAL_TOOLS / CLIENT_PORTAL_AUTHED_TOOLS;
// clientPolicy.ts is default-deny).
//
// A saved step's STAGE is a LifecycleStage WITHOUT `advances_to` (and without
// key/entry/terminal): { label, client_label?, action {kind,config?}, gate,
// documents?, blocking? }. The builder assigns the outgoing edge + default gate at
// insertion time — a half-edge would fail validateLifecycle. The schema is left
// open (additionalProperties) so the builder can carry step config without a
// schema change here; the action handler enforces the no-edge invariant.
const STAGE_PROP = {
  type: 'object' as const,
  description:
    'The reusable step stage (a LifecycleStage WITHOUT advances_to/key/entry/terminal): { label, client_label?, action: {kind, config?}, gate, documents?, blocking? }.',
  properties: {
    label: { type: 'string' as const },
    client_label: { type: 'string' as const },
    blocking: { type: 'boolean' as const },
    // Closed vocabulary (PR5): the gate is one of GATE_KINDS and the action kind is
    // one of STEP_ACTION_KINDS — the same guardrail validateLifecycle enforces, now
    // on the tool surface so a saved step can never carry an out-of-catalog kind.
    gate: { type: 'string' as const, enum: GATE_KINDS as unknown as string[] },
    action: {
      type: 'object' as const,
      properties: {
        kind: { type: 'string' as const, enum: STEP_ACTION_KINDS },
        config: { type: 'object' as const, additionalProperties: true },
      },
      required: ['kind'],
      additionalProperties: true,
    },
    documents: {
      type: 'array' as const,
      items: { type: 'object' as const, additionalProperties: true },
    },
  },
  required: ['label', 'action', 'gate'],
  additionalProperties: true,
}

const listTool: Tool<Record<string, never>, { steps: WorkflowStepTemplate[] }> = {
  name: 'legal.workflow_step_template.list',
  description:
    "List the firm's reusable workflow step templates — saved steps droppable into any service's workflow. Each includes its name, optional description, and full stage (label, action, gate, documents, blocking).",
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({
    steps: await listWorkflowStepTemplates(ctx),
  }),
}

const getTool: Tool<{ workflowStepTemplateId: string }, { step: WorkflowStepTemplate | null }> = {
  name: 'legal.workflow_step_template.get',
  description: 'Fetch one reusable workflow step template (name, description, stage).',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { workflowStepTemplateId: { type: 'string' } },
    required: ['workflowStepTemplateId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    step: await getWorkflowStepTemplate(ctx, input.workflowStepTemplateId),
  }),
}

const createTool: Tool<CreateWorkflowStepTemplateInput, { step: WorkflowStepTemplate }> = {
  name: 'legal.workflow_step_template.create',
  description:
    'Save a reusable workflow step to the firm library: a name, optional description, and the step stage (label, action, gate, documents, blocking) WITHOUT edges. Droppable into any service workflow; the builder wires its edge on insertion.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string', description: 'Optional short description.' },
      stage: STAGE_PROP,
    },
    required: ['name', 'stage'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    step: await createWorkflowStepTemplate(ctx, input),
  }),
}

const updateTool: Tool<UpdateWorkflowStepTemplateInput, { step: WorkflowStepTemplate }> = {
  name: 'legal.workflow_step_template.update',
  description:
    'Update a reusable workflow step template (name / description / stage). Append-only: a new attribute version supersedes the prior.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      workflowStepTemplateId: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      stage: STAGE_PROP,
    },
    required: ['workflowStepTemplateId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    step: await updateWorkflowStepTemplate(ctx, input),
  }),
}

const archiveTool: Tool<
  { workflowStepTemplateId: string },
  { workflowStepTemplateId: string; archived: true }
> = {
  name: 'legal.workflow_step_template.archive',
  description:
    'Archive a reusable workflow step template (status archived — kept as history, dropped from active listings). Append-only via the core entity.archive.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { workflowStepTemplateId: { type: 'string' } },
    required: ['workflowStepTemplateId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) =>
    archiveWorkflowStepTemplate(ctx, input.workflowStepTemplateId),
}

registerTool(listTool)
registerTool(getTool)
registerTool(createTool)
registerTool(updateTool)
registerTool(archiveTool)
