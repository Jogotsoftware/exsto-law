// Capability-library chat tools (Build-Wizard). Two ClientTools the attorney's
// Claude turn registers so the service-builder reasons about the WHOLE platform,
// not just the closed step/field catalogs:
//   • buildCapabilityContextTool — READ-ONLY: the model calls it to learn what
//     the platform can already do (e-signature, document review, payments, …) so
//     it REUSES an existing capability instead of proposing to build from scratch.
//   • buildRequestCapabilityTool — WRITE: when the platform genuinely can't do
//     something (a Tier-3 gap needing code), the model files it into the library
//     as a `requested` capability the team will implement. This is how the
//     library GROWS and how the builder honestly surfaces gaps instead of faking
//     a dead step.
import type { ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'
import { listCapabilities } from '../queries/capabilities.js'
import { requestCapability } from './capabilities.js'
import { isHandlerImplemented } from './capabilityRuntime.js'

const CAPABILITY_CONTEXT_TOOL_DEF = {
  name: 'get_capability_context',
  description:
    "Get the platform's CAPABILITY LIBRARY, split into THREE distinct sections. `executable` = capabilities you can WIRE INTO A WORKFLOW STEP right now as an invoke_capability stage (they are step_invocable) — e.g. document generation, AI document review, request client materials. ONLY `executable` entries may become steps; each carries a `not_yet_executable` flag (true = contracted but no live handler yet, so surface the gap honestly and do NOT wire it in). `features` = platform abilities that back the product but are NOT wired as steps this way (booking, invoicing, Stripe/manual payments, client portal, mail, the template/questionnaire editors, the workflow engine, trust accounting, calendar/Granola sync). `pending_requests` = capabilities ALREADY FILED as build requests (status requested/building) but not live yet. Each entry has a name, what it's FOR, when to use it, and what backs it. Call this when building or extending a service to decide REUSE vs. build-from-scratch: if an `executable` capability covers what the attorney needs, wire it into the workflow rather than inventing a step. BEFORE filing a gap with request_capability, match the ask against `pending_requests` SEMANTICALLY (same ask in different words = the same request) — if it is already pending, tell the attorney it's already logged instead of filing a duplicate. Deprecated capabilities are not returned. Read-only.",
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
}

export function buildCapabilityContextTool(ctx: ActionContext): ClientTool {
  return {
    definition: CAPABILITY_CONTEXT_TOOL_DEF,
    name: 'get_capability_context',
    run: async () => {
      const caps = await listCapabilities(ctx)
      // CAPABILITY-UNIFY-1 (WP4) — separate the two meanings that used to share one
      // list. `executable` = step_invocable capabilities the model may wire into a
      // stage; each names whether it has a live handler (not_yet_executable). `features`
      // = descriptive/platform-backed capabilities that are NOT wired as steps. A
      // contracted-but-unimplemented capability (e.g. esignature) appears under
      // executable WITH not_yet_executable:true — never silently omitted.
      // BUILDER-CERT-1 (WP2.5) — `pending_requests` = already-filed build requests
      // (status requested/building), surfaced so the model dedupes SEMANTICALLY
      // before filing a new one. Deprecated capabilities are excluded everywhere:
      // a retired block must never be offered as real.
      const live = caps.filter((c) => c.status === 'available')
      const executable = live
        .filter((c) => c.spec.step_invocable === true)
        .map((c) => ({
          slug: c.slug,
          status: c.status,
          name: c.spec.name,
          category: c.spec.category,
          purpose: c.spec.purpose,
          when_to_use: c.spec.when_to_use,
          backed_by: c.spec.backed_by,
          default_gate: c.spec.default_gate,
          not_yet_executable: !isHandlerImplemented(c.spec.handler_key),
        }))
      const features = live
        .filter((c) => c.spec.step_invocable !== true)
        .map((c) => ({
          slug: c.slug,
          status: c.status,
          name: c.spec.name,
          category: c.spec.category,
          purpose: c.spec.purpose,
          when_to_use: c.spec.when_to_use,
          backed_by: c.spec.backed_by,
        }))
      const pendingRequests = caps
        .filter((c) => c.status === 'requested' || c.status === 'building')
        .map((c) => ({
          slug: c.slug,
          status: c.status,
          name: c.spec.name,
          category: c.spec.category,
          purpose: c.spec.purpose,
          when_to_use: c.spec.when_to_use,
        }))
      return JSON.stringify({ executable, features, pending_requests: pendingRequests })
    },
  }
}

const REQUEST_CAPABILITY_TOOL_DEF = {
  name: 'request_capability',
  description:
    "File a request for a NEW platform capability the platform can't do yet — a workflow step, gate, integration, or input type that has no implementation (a Tier-3 gap you must NOT fake or silently degrade). This records it in the capability library as `requested` so the team builds it and it becomes reusable. Call this ONLY after checking get_capability_context confirms nothing existing covers it. After filing, tell the attorney in ONE short line that that specific piece needs to be built and you've logged it, then continue the rest of the build with the nearest honest existing step. Returns the slug it was filed under.",
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          'Short name of the missing capability, e.g. "Auto-file with the NC Secretary of State".',
      },
      purpose: {
        type: 'string',
        description: 'What it would do and why the attorney needs it for this service.',
      },
      when_to_use: {
        type: 'string',
        description:
          'When in a service it would be used (e.g. "as a workflow step after the documents are signed").',
      },
      category: {
        type: 'string',
        description: 'Rough type: workflow_step | gate | field_type | integration | other.',
      },
    },
    required: ['name', 'purpose'],
    additionalProperties: false,
  },
}

export function buildRequestCapabilityTool(ctx: ActionContext): ClientTool {
  return {
    definition: REQUEST_CAPABILITY_TOOL_DEF,
    name: 'request_capability',
    run: async (raw) => {
      const args = (raw ?? {}) as {
        name?: string
        purpose?: string
        when_to_use?: string
        category?: string
      }
      const name = (args.name ?? '').trim()
      const purpose = (args.purpose ?? '').trim()
      if (!name || !purpose) {
        return 'A name and purpose are required to file a capability request; nothing was logged.'
      }
      const { slug, alreadyExists, existingStatus } = await requestCapability(ctx, {
        name,
        purpose,
        whenToUse: (args.when_to_use ?? '').trim() || undefined,
        category: (args.category ?? '').trim() || undefined,
      })
      if (alreadyExists && existingStatus === 'available') {
        return `The platform ALREADY has "${slug}" available — do not request it; reuse it instead (see get_capability_context).`
      }
      if (alreadyExists) {
        return `That capability is ALREADY LOGGED as "${slug}" (status ${existingStatus}) — nothing new was filed. Tell the attorney in ONE short line that this piece is already on the build list, then continue the build with the nearest existing step.`
      }
      return `Logged capability request "${slug}". Tell the attorney in ONE short line that this piece needs to be built and you've logged it, then continue the build with the nearest existing step.`
    },
  }
}
