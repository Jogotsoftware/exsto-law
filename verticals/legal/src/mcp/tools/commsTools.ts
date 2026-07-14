// MACHINE-COMMS-1 (WP2.3/WP3.3) — the AD-HOC voice/memory tools: draft an email
// for a matter or extract a transcript into notes, from any surface (matter page,
// assistant), with NO workflow stage involved. Both only ENQUEUE (the model work
// runs on the worker); the produced email draft lands in the review queue where
// approve = send, and extraction notes land on the matter for review.
import { registerTool, type Tool } from '@exsto/mcp-tools'
import type { ActionContext } from '@exsto/substrate'
import { enqueueAdHocCapabilityJob } from '../../api/capabilityRuntime.js'

const draftEmailTool: Tool<
  {
    matterEntityId: string
    purpose: string
    supersedesDocumentEntityId?: string
    guidance?: string
  },
  { jobId: string; queued: true }
> = {
  name: 'legal.email.draft',
  description:
    'Draft an email to the matter’s client (AI-composed from the matter facts, the client’s full history including archived matters, and your instructions). The draft lands in the attorney review queue — APPROVING IT SENDS IT. Nothing reaches the client unapproved. Returns a queued job id; the draft appears in the review queue when the worker finishes.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string' },
      purpose: {
        type: 'string',
        description: 'What the email should tell the client (the drafting instructions).',
      },
      supersedesDocumentEntityId: {
        type: 'string',
        description:
          'Regenerate: write the new draft as version n+1 on this existing email draft entity.',
      },
      guidance: {
        type: 'string',
        description: 'Revision notes when regenerating (what to change).',
      },
    },
    required: ['matterEntityId', 'purpose'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => {
    const jobId = await enqueueAdHocCapabilityJob(ctx, {
      capabilitySlug: 'email_generation',
      matterEntityId: input.matterEntityId,
      config: {
        purpose: input.purpose,
        ...(input.supersedesDocumentEntityId
          ? { supersedes_document_entity_id: input.supersedesDocumentEntityId }
          : {}),
        ...(input.guidance ? { guidance: input.guidance } : {}),
      },
    })
    return { jobId, queued: true as const }
  },
}

const extractTranscriptTool: Tool<
  { matterEntityId: string; transcriptEntityId?: string; instructions?: string },
  { jobId: string; queued: true }
> = {
  name: 'legal.transcript.extract',
  description:
    'Distill a matter’s consultation transcript into notes: a summary plus extracted facts and action items, attached to the matter (attorney reviews them — extracted facts are AI output). They feed the client’s assembled memory immediately. Returns a queued job id.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string' },
      transcriptEntityId: {
        type: 'string',
        description: 'Optional specific transcript (defaults to the matter’s latest).',
      },
      instructions: { type: 'string', description: 'Optional focus for the extraction.' },
    },
    required: ['matterEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => {
    const jobId = await enqueueAdHocCapabilityJob(ctx, {
      capabilitySlug: 'transcript_extraction',
      matterEntityId: input.matterEntityId,
      config: {
        ...(input.transcriptEntityId ? { transcript_entity_id: input.transcriptEntityId } : {}),
        ...(input.instructions ? { instructions: input.instructions } : {}),
        // An attorney explicitly re-running the extraction wants a re-run: bypass
        // the run-time already-extracted guard that keeps the auto-capture and
        // composed-stage doors idempotent.
        force: true,
      },
    })
    return { jobId, queued: true as const }
  },
}

registerTool(draftEmailTool as Tool)
registerTool(extractTranscriptTool as Tool)
