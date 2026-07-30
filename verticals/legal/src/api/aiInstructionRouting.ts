// CONTEXT-SETTINGS-1 (3) — scope routing for instructions given in chat.
//
// The point of the whole feature: when the attorney says something like
//   "every document we generate should be professional and well formatted"
//   "every letter should have my letterhead"
//   "this is a contract review for medical employee agreements — I look for X"
// the assistant has to decide WHERE that belongs (a firm-wide capability
// default, one specific service, the firm's context file, or this user's own),
// write it there, and SAY which it wrote to. Guessing wrong is the failure
// mode: a service-specific instruction written globally silently changes every
// document the firm produces.
//
// This module owns the write half — one dispatcher over the stores the
// AI-context program already established, so the chat tool never learns eight
// different APIs and never touches the substrate directly. The routing
// DOCTRINE (how the model chooses a scope, and when it must ask instead) lives
// in the tool description + assistantPrompt.ts, because that is what the model
// reads.
//
// Every branch is APPEND, never replace. An instruction given in conversation
// adds to what the attorney already wrote; replacing is an explicit act done on
// the settings page, where they can see what they are overwriting.
import type { ActionContext } from '@exsto/substrate'
import { updateAiContextConfig } from './aiContextConfig.js'
import {
  appendUserContextMd,
  getAssistantSettings,
  setAssistantSettings,
} from './assistantSettings.js'
import { getFirmProfile, setFirmProfile } from './tenantSettings.js'
import { getDraftingPrompt, updateDraftingInstructions } from './services.js'
import { resolveReviewConfig, updateReviewConfig } from './reviewDocument.js'

export const AI_INSTRUCTION_SCOPES = [
  'firm_document_generation',
  'firm_document_review',
  'firm_assistant_chat',
  'firm_context',
  'my_assistant_chat',
  'my_context',
  'service_document_generation',
  'service_document_review',
] as const
export type AiInstructionScope = (typeof AI_INSTRUCTION_SCOPES)[number]

export function isAiInstructionScope(v: unknown): v is AiInstructionScope {
  return typeof v === 'string' && (AI_INSTRUCTION_SCOPES as readonly string[]).includes(v)
}

// Human labels + the settings surface each scope is visible on, so the reply
// can point the attorney at the thing it just changed. Keys mirror the routes
// in apps/legal-demo.
const SCOPE_META: Record<AiInstructionScope, { label: string; where: string }> = {
  firm_document_generation: {
    label: 'Document Generation — firm defaults',
    where: 'Settings → AI Context → Document Generation',
  },
  firm_document_review: {
    label: 'Document Review — firm defaults',
    where: 'Settings → AI Context → Document Review',
  },
  firm_assistant_chat: {
    label: 'Assistant chat — firm instructions',
    where: 'Settings → Assistant → Firm instructions',
  },
  firm_context: {
    label: "The firm's context file",
    where: 'Settings → AI Context → Firm context',
  },
  my_assistant_chat: {
    label: 'Assistant chat — your instructions',
    where: 'Settings → Assistant → My instructions',
  },
  my_context: { label: 'Your context file', where: 'Settings → AI Context → My context' },
  service_document_generation: {
    label: 'this service’s drafting instructions',
    where: 'Services → (this service) → Prompt',
  },
  service_document_review: {
    label: 'this service’s review instructions',
    where: 'Services → (this service) → Review',
  },
}

export interface SaveAiInstructionInput {
  scope: AiInstructionScope
  instruction: string
  // Required for the two service scopes. A service scope with no serviceKey is
  // rejected rather than silently promoted to a firm-wide write — that
  // promotion is exactly the mistake this routing exists to prevent.
  serviceKey?: string
  // Optional for service_document_generation: which document kind's
  // instructions to add to. Defaults to the service's only document kind when
  // it has exactly one; required when it has several.
  documentKind?: string
}

export interface SaveAiInstructionResult {
  scope: AiInstructionScope
  // Human sentence the assistant repeats back: what was written, and where.
  scopeLabel: string
  where: string
  serviceKey?: string
  documentKind?: string
}

// Append one instruction to a list-shaped store (the chat/firm instruction
// pills), preserving what is already there.
function appendItem(existing: string[] | null | undefined, addition: string): string[] {
  return [...(existing ?? []), addition]
}

export async function saveAiInstruction(
  ctx: ActionContext,
  input: SaveAiInstructionInput,
): Promise<SaveAiInstructionResult> {
  const instruction = (input.instruction ?? '').trim()
  if (!instruction) throw new Error('There is no instruction text to save.')
  if (!isAiInstructionScope(input.scope)) {
    throw new Error(
      `Unknown scope "${String(input.scope)}". Valid scopes: ${AI_INSTRUCTION_SCOPES.join(', ')}.`,
    )
  }
  const meta = SCOPE_META[input.scope]
  const base = { scope: input.scope, scopeLabel: meta.label, where: meta.where }

  switch (input.scope) {
    case 'firm_document_generation':
      await updateAiContextConfig(ctx, { appendDocumentGenerationInstruction: instruction })
      return base

    case 'firm_document_review':
      await updateAiContextConfig(ctx, { appendDocumentReviewInstruction: instruction })
      return base

    case 'firm_context':
      await updateAiContextConfig(ctx, { appendFirmContextMd: instruction })
      return base

    case 'my_context':
      await appendUserContextMd(ctx, instruction)
      return base

    case 'firm_assistant_chat': {
      const profile = await getFirmProfile(ctx)
      await setFirmProfile(ctx, {
        assistantInstructions: appendItem(profile.assistantInstructions, instruction),
      })
      return base
    }

    case 'my_assistant_chat': {
      const settings = (await getAssistantSettings(ctx)) ?? {}
      const current = settings.customInstructions
      const asList = Array.isArray(current)
        ? current
        : typeof current === 'string' && current.trim()
          ? [current.trim()]
          : []
      await setAssistantSettings(ctx, {
        ...settings,
        customInstructions: appendItem(asList, instruction),
      })
      return base
    }

    case 'service_document_generation': {
      const serviceKey = (input.serviceKey ?? '').trim()
      if (!serviceKey) {
        throw new Error(
          'A serviceKey is required to save an instruction to one service. Ask the attorney which service they mean rather than saving it firm-wide.',
        )
      }
      const documentKind = (input.documentKind ?? '').trim()
      if (!documentKind) {
        throw new Error(
          'A documentKind is required: name which document of this service the instruction applies to (call get_service_context or ask).',
        )
      }
      const existing = await getDraftingPrompt(ctx, serviceKey, documentKind)
      const prior = existing?.instructionsText ?? ''
      await updateDraftingInstructions(
        ctx,
        serviceKey,
        documentKind,
        prior ? `${prior}\n${instruction}` : instruction,
      )
      return { ...base, serviceKey, documentKind }
    }

    case 'service_document_review': {
      const serviceKey = (input.serviceKey ?? '').trim()
      if (!serviceKey) {
        throw new Error(
          'A serviceKey is required to save an instruction to one service. Ask the attorney which service they mean rather than saving it firm-wide.',
        )
      }
      const current = await resolveReviewConfig(ctx, serviceKey)
      const prior = current.instructions ?? ''
      await updateReviewConfig(ctx, {
        serviceKey,
        instructions: prior ? `${prior}\n${instruction}` : instruction,
      })
      return { ...base, serviceKey }
    }
  }
}
