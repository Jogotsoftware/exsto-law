import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  getService,
  listServices,
  submitBooking,
  submitSomethingElseRequest,
  type IntakeSchema,
  type ServiceDefinition,
  type SomethingElseInput,
  type SubmitBookingInput,
} from '../../index.js'
import type { ActionContext, ActionResult } from '@exsto/substrate'

const listServicesTool: Tool<Record<string, never>, { services: ServiceDefinition[] }> = {
  name: 'legal.service.list',
  description:
    'List the service kinds Pacheco Law offers via the booking page (workflow_definition rows: route + intake form binding).',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ services: await listServices(ctx) }),
}

const getServiceTool: Tool<{ serviceKey: string }, { service: ServiceDefinition | null }> = {
  name: 'legal.service.get',
  description: 'Get a service kind by key (used by the booking wizard to render the intake form).',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    service: await getService(ctx, input.serviceKey),
  }),
}

const submitBookingTool: Tool<SubmitBookingInput, ActionResult> = {
  name: 'legal.booking.submit',
  description:
    'Public-facing booking submission. Orchestrates the Phase 0 action vocabulary: intake.submit (client_contact + questionnaire_response) → matter.open (matter + relationships) → booking.create (slot arbitration + calendar attrs). The Google Calendar event is created first so its id lands on the matter.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => submitBooking(ctx, input),
}

// "Something else" public intake (UI-BUILDER-FIX-1 Phase 3): the picker tile for
// a need no live service covers. Creates a client_request (attorney triage) —
// deliberately NOT a booking: no matter, no workflow, no slot.
const somethingElseTool: Tool<SomethingElseInput, { requestId: string; clientContactId: string }> =
  {
    name: 'legal.intake.something_else',
    description:
      'Public-facing "Something else" intake: capture a visitor\'s free-text request + contact details as a client_request flagged for attorney triage. Starts no workflow and opens no matter.',
    mode: 'write',
    handler: async (ctx: ActionContext, input) => submitSomethingElseRequest(ctx, input),
  }

registerTool(listServicesTool)
registerTool(getServiceTool)
registerTool(submitBookingTool)
registerTool(somethingElseTool)

// Service editing and template linkage move to the Phase 1 library layer
// (REQ-LIBRARY-*); Phase 0 service kinds are seed-defined configuration.

// Re-export the schema type so callers can use it.
export type { IntakeSchema }
