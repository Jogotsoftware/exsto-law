import { submitAction, type ActionContext } from '@exsto/substrate'
import { archiveEntity } from '@exsto/primitives'
import {
  getWorkflowStepTemplate,
  type StepStage,
  type WorkflowStepTemplate,
} from '../queries/workflowStepLibrary.js'

// Write API for the workflow STEP library (migration 0095, ADR 0045 PR4c).
// Create/update go through the legal.workflow_step_template.* actions; archive
// reuses the core entity.archive. Each returns the resolved step template so the
// builder renders immediately. Mirrors the questionnaire library write API.

export interface CreateWorkflowStepTemplateInput {
  name: string
  description?: string | null
  stage: StepStage
}

export async function createWorkflowStepTemplate(
  ctx: ActionContext,
  input: CreateWorkflowStepTemplateInput,
): Promise<WorkflowStepTemplate> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.workflow_step_template.create',
    intentKind: 'enforcement',
    payload: {
      name: input.name,
      description: input.description ?? null,
      stage: input.stage,
    },
  })
  const { workflowStepTemplateId } = res.effects[0] as { workflowStepTemplateId: string }
  const created = await getWorkflowStepTemplate(ctx, workflowStepTemplateId)
  if (!created) throw new Error('Workflow step template created but could not be read back.')
  return created
}

export interface UpdateWorkflowStepTemplateInput {
  workflowStepTemplateId: string
  name?: string
  description?: string | null
  stage?: StepStage
}

export async function updateWorkflowStepTemplate(
  ctx: ActionContext,
  input: UpdateWorkflowStepTemplateInput,
): Promise<WorkflowStepTemplate> {
  await submitAction(ctx, {
    actionKindName: 'legal.workflow_step_template.update',
    intentKind: 'adjustment',
    payload: {
      workflow_step_template_id: input.workflowStepTemplateId,
      name: input.name,
      description: input.description,
      stage: input.stage,
    },
  })
  const updated = await getWorkflowStepTemplate(ctx, input.workflowStepTemplateId)
  if (!updated) throw new Error('Workflow step template updated but could not be read back.')
  return updated
}

// Archive through the core entity.archive action (status 'archived' — kept as
// history, dropped from active listings). Append-only.
export async function archiveWorkflowStepTemplate(
  ctx: ActionContext,
  workflowStepTemplateId: string,
): Promise<{ workflowStepTemplateId: string; archived: true }> {
  await archiveEntity(ctx, workflowStepTemplateId)
  return { workflowStepTemplateId, archived: true }
}
