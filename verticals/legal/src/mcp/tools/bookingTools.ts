import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  getService,
  listServices,
  submitBooking,
  updateService,
  attachTemplate,
  detachTemplate,
  type AttachTemplateInput,
  type DetachTemplateInput,
  type IntakeSchema,
  type ServiceDefinition,
  type SubmitBookingInput,
  type UpdateServiceInput,
} from '../../index.js'
import type { ActionContext, ActionResult } from '@exsto/substrate'

const listServicesTool: Tool<Record<string, never>, { services: ServiceDefinition[] }> = {
  name: 'legal.service.list',
  description: 'List all services Pacheco Law offers via the booking page.',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ services: await listServices(ctx) }),
}

const getServiceTool: Tool<{ serviceKey: string }, { service: ServiceDefinition | null }> = {
  name: 'legal.service.get',
  description:
    'Get a service definition by key (used by the booking wizard to render the intake form).',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    service: await getService(ctx, input.serviceKey),
  }),
}

const updateServiceTool: Tool<UpdateServiceInput, { service: ServiceDefinition }> = {
  name: 'legal.service.update',
  description:
    'Attorney-side: update a service definition (display name, description, intake schema, active state).',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => ({ service: await updateService(ctx, input) }),
}

const submitBookingTool: Tool<SubmitBookingInput, ActionResult> = {
  name: 'legal.booking.submit',
  description:
    'Public-facing booking submission: creates matter + client_contact + questionnaire response in one transaction. Records the scheduled time.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => submitBooking(ctx, input),
}

const attachTemplateTool: Tool<AttachTemplateInput, { ok: true }> = {
  name: 'legal.service.template.attach',
  description:
    'Link a document template to a service so it auto-populates when a matter is created for that service.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    await attachTemplate(ctx, input)
    return { ok: true }
  },
}

const detachTemplateTool: Tool<DetachTemplateInput, { ok: true }> = {
  name: 'legal.service.template.detach',
  description: 'Unlink a document template from a service.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    await detachTemplate(ctx, input)
    return { ok: true }
  },
}

registerTool(listServicesTool)
registerTool(getServiceTool)
registerTool(updateServiceTool)
registerTool(submitBookingTool)
registerTool(attachTemplateTool)
registerTool(detachTemplateTool)

// Re-export the schema type so callers can use it.
export type { IntakeSchema }
