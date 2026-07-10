// Seed the platform capability library (migration 0117) with EVERYTHING the
// platform can do today — the living catalog the service-builder reads to decide
// reuse vs. build. Idempotent (upsert by slug through the action layer). Run with
// the prod DATABASE_URL:
//   tsx --env-file=<main-worktree>/.env.local verticals/legal/demo/seed-capabilities.ts
//
// DISCIPLINE: whenever a NEW capability ships, add it here (and re-run) — the
// library is only as useful as it is complete. A capability the builder can't see
// is one it will wastefully try to build from scratch or wrongly say is missing.
//
// PROMOTION DOCTRINE (MACHINE-COMMS-1 WP4): anything that ACTS at runtime inside
// a matter must be STEP-INVOCABLE — an INVOCABLE_CONTRACTS entry with handler_key,
// config_schema, and default_gate, composable as an invoke_capability stage (and
// runnable ad hoc where that makes sense). "Features" are only what cannot be a
// step by nature: front doors (booking precedes the matter), the chassis (engine,
// review queue, portal, assistant), authoring editors, and payment rails (the step
// is await_payment; the rail satisfies its gate). Runtime behavior that is not yet
// invocable is a PROMOTION GAP — file it via request_capability, don't wire around
// it. Known-promotable, deliberately not built yet: calendar event creation,
// client-message post, trust retainer request, portal invite.
import { pathToFileURL } from 'node:url'
import { upsertCapability, type UpsertCapabilityInput } from '@exsto/legal'
import { type ActionContext } from '@exsto/substrate'

// Registry contract upgrades apply wherever the capabilities live. Defaults to
// tenant zero (Pacheco pilot — where the 21 live); SEED_TENANT overrides it so the
// same contract can be provisioned into the sandbox tenant for runtime testing.
const TENANT = process.env.SEED_TENANT ?? '00000000-0000-0000-0000-000000000001'
const ADMIN = '00000000-0000-0000-0001-000000000004' // seeded Claude agent actor

// The current platform surface. `backed_by` names the workflow step / tool /
// feature that implements it, so the builder knows HOW to wire it in.
export const CAPABILITIES: Array<Omit<UpsertCapabilityInput, 'status'>> = [
  {
    slug: 'booking_scheduling',
    spec: {
      name: 'Booking & scheduling',
      category: 'intake',
      purpose:
        'A public booking page where clients pick a service, fill its intake, and (if offered) pick a consultation time that auto-schedules on the firm calendar. Submitting intake creates the matter and starts the workflow.',
      when_to_use:
        'Every enabled service is bookable here — this is the client’s front door. Add a consultation slot when the service needs a meeting.',
      backed_by: ['public booking page', 'submitBooking', 'booking.create'],
    },
  },
  {
    slug: 'intake_document_upload',
    spec: {
      name: 'Intake document upload',
      category: 'intake',
      purpose:
        'Let a client attach documents during intake (a file_upload questionnaire field); the files bind to the matter on submit.',
      when_to_use:
        'Add a file_upload question when the service needs the client to send a document (e.g. a contract to review).',
      backed_by: ['file_upload field type', 'intake staging + document.upload'],
    },
  },
  {
    slug: 'document_generation',
    spec: {
      name: 'Document generation',
      category: 'documents',
      purpose:
        'Produce a service’s documents from intake answers — either deterministic template-merge (no AI) or AI drafting from the answers + the firm’s legal skills.',
      when_to_use:
        'The core of any service that hands the client a document. Choose template_merge or ai_draft as the generation mode.',
      backed_by: ['draft.generate', 'generation_mode', 'document templates'],
    },
  },
  {
    slug: 'ai_document_review',
    spec: {
      name: 'AI document review',
      category: 'documents',
      purpose:
        'Auto-review a client-uploaded document against an attorney-preconfigured prompt; a review memo (and optional redline) lands in the review queue for the attorney to edit or approve.',
      when_to_use:
        'For a service where the client submits a document for the firm to review (e.g. contract review). Enable it on the service’s AI-review tab.',
      backed_by: ['legal.document.review.run', 'transitions.review'],
    },
  },
  {
    slug: 'attorney_review_queue',
    spec: {
      name: 'Attorney review queue',
      category: 'documents',
      purpose:
        'Every generated document / review memo lands here for the attorney to edit, approve, or request revision. Approving is what releases it to the client — nothing reaches the client unreviewed.',
      when_to_use:
        'Automatic for any drafted/reviewed document; the human gate before anything is client-visible.',
      backed_by: ['review queue', 'draft.approve / draft.request_revision'],
    },
  },
  {
    slug: 'esignature',
    spec: {
      name: 'Native e-signature',
      category: 'documents',
      purpose:
        'Send a document for signature by link (DocuSign-style fields, signer order, portal + link delivery, status tracking) — no external service. As a workflow step: sends the preceding step’s approved document and parks the matter at the system gate until every signer finishes (esign.completed).',
      when_to_use:
        'Compose an e-signature step ONLY immediately after a step that produces a document whose template declares signature.required — never on unsigned documents, never free-floating. Gate: system, advancing on esign.completed.',
      backed_by: ['e-sign envelope', 'signature_tasks', 'sign-by-link route'],
    },
  },
  {
    slug: 'workflow_engine',
    spec: {
      name: 'Workflow engine',
      category: 'workflow',
      purpose:
        'A per-service linear lifecycle of steps joined by gates (automatic / attorney / client / system) that advance the matter. Configuration-as-data — no code.',
      when_to_use:
        'Every service has one. Compose it from the closed step-action catalog; ASK the attorney the gate per step.',
      backed_by: ['workflow_definition.transitions', 'get_workflow_context', 'propose_workflow'],
    },
  },
  {
    slug: 'invoicing',
    spec: {
      name: 'Invoicing',
      category: 'billing',
      purpose:
        'Create and send invoices for a matter; a workflow step can mark WHEN that happens (e.g. after a document is approved).',
      when_to_use:
        'When a service bills the client. Pair with a payment capability for collection.',
      backed_by: ['billing area', 'invoice actions'],
    },
  },
  {
    slug: 'stripe_payments',
    spec: {
      name: 'Stripe payments',
      category: 'billing',
      purpose:
        'Online invoice payment via Stripe Connect (embedded card / ACH). The client pays the invoice from the portal.',
      when_to_use: 'When the firm wants to collect invoice payments online with cards/ACH.',
      backed_by: ['Stripe Connect Express', 'invoice payment page'],
    },
  },
  {
    slug: 'manual_payments',
    spec: {
      name: 'Manual payments (Zelle / crypto)',
      category: 'billing',
      purpose:
        'Instruct-then-verify payment rails — show the client Zelle recipient / crypto wallets; the client reports payment and the attorney verifies.',
      when_to_use: 'When the firm collects by Zelle or crypto instead of (or alongside) cards.',
      backed_by: ['invoice.payment_reported', 'manual_payment_methods_config'],
    },
  },
  {
    slug: 'rates_billing',
    spec: {
      name: 'Per-service rates',
      category: 'billing',
      purpose:
        'Flat-fee or hourly rate configured per service; the fee model the builder sets at the billing step.',
      when_to_use: 'Set the price of a service (flat or hourly) during the build’s billing step.',
      backed_by: ['propose_cost', 'firm_settings rates'],
    },
  },
  {
    slug: 'client_portal',
    spec: {
      name: 'Client portal',
      category: 'client',
      purpose:
        'A logged-in space where the client sees their matter status, released documents, uploaded files, messages, and documents to sign / invoices to pay.',
      when_to_use: 'Automatic for every client — how released documents and requests reach them.',
      backed_by: ['client portal', 'listApprovedClientDocuments'],
    },
  },
  {
    slug: 'client_messaging',
    spec: {
      name: 'Client messaging',
      category: 'client',
      purpose: 'Two-way messages between the firm and the client, threaded on the matter.',
      when_to_use: 'When a service needs back-and-forth with the client outside of documents.',
      backed_by: ['client portal messaging'],
    },
  },
  {
    slug: 'mail',
    spec: {
      name: 'Email',
      category: 'comms',
      purpose: 'Send and receive email tied to a matter/contact from inside the app.',
      when_to_use: 'For direct email correspondence on a matter.',
      backed_by: ['mail area', 'mail.send / ingest'],
    },
  },
  {
    slug: 'calendar_sync',
    spec: {
      name: 'Calendar sync',
      category: 'comms',
      purpose:
        'Two-way Google Calendar integration; consultation bookings auto-create calendar events.',
      when_to_use: 'Automatic when a service offers consultations.',
      backed_by: ['Google Calendar adapter'],
    },
  },
  {
    slug: 'granola_import',
    spec: {
      name: 'Granola meeting import',
      category: 'comms',
      purpose: 'Import meeting transcripts/notes from Granola and attach them to a matter.',
      when_to_use: 'To bring consultation notes into a matter automatically.',
      backed_by: ['Granola OAuth/MCP adapter'],
    },
  },
  {
    slug: 'trust_accounting',
    spec: {
      name: 'Trust accounting',
      category: 'billing',
      purpose:
        'A trust/IOLTA ledger for holding and disbursing client funds with an auditable trail.',
      when_to_use: 'When a service takes a retainer or holds client funds in trust.',
      backed_by: ['trust ledger', 'trust MCP tools'],
    },
  },
  {
    slug: 'template_editor',
    spec: {
      name: 'Template editor',
      category: 'authoring',
      purpose:
        'Attorney-facing editor for a service’s document templates (markdown body + {{token}} merge fields).',
      when_to_use: 'To author or edit the documents a service produces.',
      backed_by: ['templates editor', 'propose_template'],
    },
  },
  {
    slug: 'questionnaire_editor',
    spec: {
      name: 'Questionnaire editor',
      category: 'authoring',
      purpose:
        'Attorney-facing editor for a service’s intake questionnaire — one field per document token, from the closed field-type set.',
      when_to_use: 'To author or edit what a service asks the client at intake.',
      backed_by: ['questionnaire editor', 'propose_questionnaire'],
    },
  },
  {
    slug: 'ai_assistant',
    spec: {
      name: 'AI assistant',
      category: 'authoring',
      purpose:
        'The in-app chatbot — answers questions grounded in matter/client context, drafts text, produces documents, and runs the guided service builder. Loads legal skills on demand.',
      when_to_use: 'Always available; also the surface that builds services conversationally.',
      backed_by: ['assistant chat', 'skills library', 'build-wizard tools'],
    },
  },
  {
    slug: 'data_as_schema',
    spec: {
      name: 'Custom data kinds (data-as-schema)',
      category: 'platform',
      purpose:
        'Define genuinely new data concepts a practice area needs — a new attribute on a matter, a new relationship, a new event/milestone, or a new tracked entity — as definition rows, no code.',
      when_to_use:
        'When a novel service needs to track something the platform has no kind for. Propose it via propose_kind (human-approved).',
      backed_by: ['kind.define', 'propose_kind', 'get_kind_context'],
    },
  },
  {
    // MACHINE-COMMS-1 (WP2) — the machine's VOICE: email becomes what documents
    // already are — generated with context, reviewed by the attorney, released on
    // approval. Composable as a workflow step AND runnable ad hoc from any matter.
    slug: 'email_generation',
    spec: {
      name: 'Email generation',
      category: 'comms',
      purpose:
        'Draft an outbound email for a matter — AI-drafted from the matter facts, the client’s full history (including archived matters), the attorney’s instructions and the firm’s skills, or a deterministic template merge for canned sends. The draft lands in the attorney review queue; APPROVING IT SENDS IT through the firm’s real mail rails. Nothing reaches a client unapproved.',
      when_to_use:
        'Compose an email step wherever a service should tell the client something (documents ready, next steps, a request explained). Also available ad hoc from any matter: “draft an email to the client about X”. Gate: attorney, advancing on approval.',
      backed_by: ['communication_draft + review queue', 'mail.send (Contract B)'],
    },
  },
  {
    // MACHINE-COMMS-1 (WP3) — memory intake: transcripts stop being stored-but-mute.
    slug: 'transcript_extraction',
    spec: {
      name: 'Transcript extraction',
      category: 'comms',
      purpose:
        'Distill a consultation/meeting transcript into matter memory: a summary note plus extracted facts and action items as notes, attached to the matter and feeding the client’s assembled context. Extracted facts are AI output — they land for attorney review.',
      when_to_use:
        'Compose it as a post-consultation step, or run it ad hoc on any transcript (Granola-imported or pasted on the matter page). Gate: attorney.',
      backed_by: ['note entities + note_about', 'getClientContext'],
    },
  },
  {
    // ADR 0046 — the second REQUIRED invocable capability. A mid-service ask: the
    // firm requests materials from the client and the matter PARKS at the client
    // gate until the client delivers (an upload or a portal reply).
    slug: 'request_client_materials',
    spec: {
      name: 'Request client materials',
      category: 'client',
      purpose:
        'Ask the client to send something mid-matter (a document, an answer, a signed form). Posts the request to the client portal thread; the matter waits at the client gate until the client delivers, then advances on the client’s own action.',
      when_to_use:
        'When a service needs the client to hand something over after intake — e.g. a follow-up document the attorney asked for during review. Express it as its own client-gated stage.',
      backed_by: ['attorney.message.post', 'client portal', 'client delivery dispatch'],
    },
  },
  {
    // PORTAL-1 (WP1) — the first capability promoted under platform-discipline §3b:
    // one handler backs the composed workflow stage, the attorney's "Invite to
    // portal" button, and the booking-confirmation account link.
    slug: 'send_portal_invite',
    spec: {
      name: 'Send portal invite',
      category: 'client',
      purpose:
        'Email the matter’s client a secure link to create their portal account. As a workflow stage the matter parks at the client gate until the account exists, then advances on the client’s own account-creation action.',
      when_to_use:
        'Compose it early in a service when the client should follow the matter, sign, and pay in the portal. Skipped honestly when the client already has an account.',
      backed_by: ['portal invite token', 'client_portal_invite notification route', 'legal.client.provision_portal_actor'],
    },
  },
]

// ADR 0046 — the EXECUTABLE CONTRACT per capability (WP1). Merged onto each spec at
// seed time: every capability declares whether it is step_invocable, and each
// invocable one carries its handler_key, inputs (+ who provides each), outputs, gate,
// and config_schema. A contracted capability whose handler is not yet in the runtime
// registry raises a clear "not yet executable" error when invoked — never a silent
// no-op or simulated output. (esignature joined the REAL handlers in ESIGN-BLOCK-1.)
// The full T/F classification + one-line rationale lives in the decision log.
export const INVOCABLE_CONTRACTS: Record<string, Partial<UpsertCapabilityInput['spec']>> = {
  // CAPABILITY-UNIFY-1 (WP1) — document generation is the first fully-migrated LEGO
  // block: ONE capability, reused across services, drafting a DIFFERENT document per
  // step via per-step config. The template is named by EXACT firm-library entity id
  // (config_schema.template_entity_id) — never resolved by (serviceKey, docKind)
  // convention — which is what lets the same block draft a will on one service and
  // an operating agreement on another.
  document_generation: {
    step_invocable: true,
    handler_key: 'legal.capability.document_generation.run',
    inputs: [
      {
        key: 'template',
        provided_by: 'attorney',
        source: 'document_template',
        required: true,
        description:
          'the firm-library document template this step drafts, named by exact entity id in capability_config.template_entity_id',
      },
      {
        key: 'intake_answers',
        provided_by: 'client',
        source: 'matter_context',
        required: true,
        description: 'the client’s intake questionnaire answers on the matter',
      },
      {
        key: 'instructions',
        provided_by: 'attorney',
        source: 'service_config',
        required: false,
        description: 'the drafting prompt/instructions for ai_draft mode',
      },
      {
        key: 'generation_mode',
        provided_by: 'attorney',
        source: 'service_config',
        required: true,
        description: 'template_merge (deterministic, no AI) or ai_draft (AI drafting)',
      },
    ],
    outputs: [
      {
        entity_kind: 'document_draft',
        description: 'a document draft (pending_review) in the attorney review queue',
      },
    ],
    // Drafting completes → the stage's automatic edge advances the matter to its
    // human-gated review stage, which WAITS — same net behavior as the bespoke path.
    default_gate: 'automatic',
    config_schema: {
      template_entity_id: {
        type: 'string',
        required: true,
        description:
          'The EXACT firm template entity id this step drafts (from the firm document library) — never a name or a docKind.',
      },
      generation_mode: {
        type: 'string',
        required: true,
        description: "How to produce the document: 'template_merge' or 'ai_draft'.",
      },
      instructions: {
        type: 'string',
        required: false,
        description: 'Optional drafting instructions/prompt for ai_draft mode.',
      },
      use_client_context: {
        type: 'boolean',
        required: false,
        description:
          'ai_draft mode only, default false: inject the client’s assembled history (every matter including archived, notes, transcripts) into the drafting prompt. Opt-in — cross-matter context changes draft provenance, so the attorney chooses it per step. Never applies to template_merge.',
      },
    },
  },
  ai_document_review: {
    step_invocable: true,
    handler_key: 'legal.capability.ai_document_review.run',
    inputs: [
      {
        key: 'uploaded_document',
        provided_by: 'client',
        source: 'uploaded_document',
        required: true,
        description: 'the document the client uploaded to the matter for review',
      },
      {
        key: 'rubric',
        provided_by: 'attorney',
        source: 'service_config',
        required: true,
        description: 'what the attorney wants checked (the review rubric)',
      },
      {
        key: 'matter_context',
        provided_by: 'system',
        source: 'matter_context',
        required: false,
        description: 'intake answers, for context',
      },
    ],
    outputs: [
      {
        entity_kind: 'document_draft',
        description: 'a review memo (pending_review) in the attorney review queue',
      },
    ],
    default_gate: 'attorney',
    config_schema: {
      rubric: {
        type: 'string',
        required: true,
        description: 'What to check for in the document — the review rubric.',
      },
    },
  },
  send_portal_invite: {
    step_invocable: true,
    handler_key: 'legal.capability.send_portal_invite.run',
    inputs: [
      {
        key: 'client_contact',
        provided_by: 'system',
        source: 'matter',
        required: true,
        description: 'the matter’s client contact (client_of) — resolved by the runtime',
      },
    ],
    outputs: [],
    default_gate: 'client',
    // No standing config. Advance on account-created: the client-gate edge's
    // `via` is legal.client.provision_portal_actor.
    config_schema: {},
  },
  request_client_materials: {
    step_invocable: true,
    handler_key: 'legal.capability.request_client_materials.run',
    inputs: [
      {
        key: 'message',
        provided_by: 'attorney',
        source: 'service_config',
        required: true,
        description: 'what to ask the client for',
      },
    ],
    outputs: [
      {
        entity_kind: 'communication_message',
        description: 'the request posted to the client portal thread',
      },
      {
        entity_kind: 'document_uploaded',
        description: 'the client’s delivered materials, when they upload',
      },
    ],
    default_gate: 'client',
    config_schema: {
      message: {
        type: 'string',
        required: true,
        description: 'The message asking the client for the materials.',
      },
    },
  },
  // MACHINE-COMMS-1 (WP2) — email_generation: composes the draft, parks at the
  // ATTORNEY gate; approving the draft in the review queue IS the send (approve →
  // mail.send through Contract B) and advances the stage via draft.approve.
  email_generation: {
    step_invocable: true,
    handler_key: 'legal.capability.email_generation.run',
    inputs: [
      {
        key: 'purpose',
        provided_by: 'attorney',
        source: 'service_config',
        required: true,
        description:
          'what the email should tell the recipient — the drafting instructions (required in ai_draft mode)',
      },
      {
        key: 'client_history',
        provided_by: 'system',
        source: 'matter_context',
        required: false,
        description:
          'the client’s assembled context (every matter including archived, notes, transcripts, released documents) — always injected in ai_draft mode',
      },
      {
        key: 'template',
        provided_by: 'attorney',
        source: 'document_template',
        required: false,
        description:
          'template mode only: the firm-library template to merge, named by exact entity id in capability_config.template_entity_id',
      },
    ],
    outputs: [
      {
        entity_kind: 'communication_draft',
        description:
          'an email draft (pending_review) in the attorney review queue — approving it sends it via the firm’s mail rails',
      },
    ],
    default_gate: 'attorney',
    config_schema: {
      purpose: {
        type: 'string',
        required: true,
        description: 'What this email should tell the recipient (the drafting instructions).',
      },
      recipient_role: {
        type: 'string',
        required: false,
        description: "Who receives it: 'client' (default) or 'other'.",
      },
      mode: {
        type: 'string',
        required: false,
        description:
          "'ai_draft' (default — drafts from matter facts + client history + instructions) or 'template' (deterministic merge).",
      },
      template_entity_id: {
        type: 'string',
        required: false,
        description: 'Template mode: the EXACT firm template entity id to merge — never a name.',
      },
    },
  },
  // MACHINE-COMMS-1 (WP3) — transcript_extraction: distills the matter's transcript
  // into notes; parks at the ATTORNEY gate for review (extracted facts are AI output).
  transcript_extraction: {
    step_invocable: true,
    handler_key: 'legal.capability.transcript_extraction.run',
    inputs: [
      {
        key: 'transcript',
        provided_by: 'system',
        source: 'matter_context',
        required: true,
        description:
          'the matter’s consultation transcript (Granola-imported or pasted); defaults to the latest',
      },
      {
        key: 'instructions',
        provided_by: 'attorney',
        source: 'service_config',
        required: false,
        description: 'optional focus for the extraction (what to pull out)',
      },
    ],
    outputs: [
      {
        entity_kind: 'note',
        description:
          'a summary note plus one note per extracted fact / action item, attached to the matter and feeding the client’s assembled context',
      },
    ],
    default_gate: 'attorney',
    config_schema: {
      instructions: {
        type: 'string',
        required: false,
        description: 'Optional attorney focus for the extraction.',
      },
      transcript_entity_id: {
        type: 'string',
        required: false,
        description: 'Optional: a specific transcript entity id (defaults to the latest).',
      },
    },
  },
  // ESIGN-BLOCK-1 (WP2) — WIRED: sends the matter's latest APPROVED document version
  // for signature through the existing native e-sign engine (api/esign.sendForSignature),
  // then PARKS at the system gate; envelope completion fires esign.completed, which
  // advances the stage (handlers/esign.ts → dispatchLifecycleEvent). Composition rule
  // (WP3, validator-enforced): an esignature step follows ONLY a document-producing
  // step whose bound template declares signature.required.
  esignature: {
    step_invocable: true,
    handler_key: 'legal.capability.esignature.run',
    inputs: [
      {
        key: 'document',
        provided_by: 'system',
        source: 'prior_step_output',
        required: true,
        description:
          'the approved document to send for signature — the latest approved version produced by the immediately preceding drafting step (whose template must declare signature.required)',
      },
    ],
    outputs: [
      {
        entity_kind: 'signature_envelope',
        description:
          'a real e-sign envelope (sign-by-link / portal); the matter waits at the system gate and advances on esign.completed',
      },
    ],
    default_gate: 'system',
    config_schema: {
      document_kind: {
        type: 'string',
        required: false,
        description:
          'Optional: which document kind to send when the matter produces several (defaults to the latest approved document).',
      },
    },
  },
}

// Capabilities the platform does NOT do yet — filed as `requested` so the builder
// surfaces them honestly (and does not try to fake them) and the team has a backlog.
// 1.1 WP10: a real build declared a "notify me when the matter closes" gap in prose
// but wrote nothing (a no-simulate violation). It is a genuine Tier-3 gap (a workflow
// step/notification with no executor), so it belongs here as a tracked build request.
export const REQUESTED_CAPABILITIES: Array<Omit<UpsertCapabilityInput, 'status'>> = [
  {
    slug: 'step_close_notification',
    spec: {
      name: 'Step / matter-close notification',
      category: 'workflow',
      purpose:
        'Notify the attorney (email/in-app) when a matter reaches a chosen workflow step — e.g. when it closes, or when a specific step completes. A per-step "tell me when this happens" hook.',
      when_to_use:
        'When an attorney wants to be alerted at a point in a service’s workflow (most commonly on matter close). Not yet buildable — a workflow-step notification hook needs code; file via request_capability until it ships.',
      backed_by: [],
    },
  },
]

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const ctx: ActionContext = { tenantId: TENANT, actorId: ADMIN }
  let n = 0
  for (const cap of CAPABILITIES) {
    // Merge the executable contract: default step_invocable=false, then overlay the
    // invocable ones' handler_key/inputs/outputs/gate/config_schema.
    const spec = { ...cap.spec, step_invocable: false, ...(INVOCABLE_CONTRACTS[cap.slug] ?? {}) }
    await upsertCapability(ctx, { slug: cap.slug, spec, status: 'available' })
    n++
    const inv = spec.step_invocable ? ' [invocable]' : ''
    console.log(`capability: upserted ${cap.slug} (available)${inv}`)
  }
  for (const cap of REQUESTED_CAPABILITIES) {
    await upsertCapability(ctx, { ...cap, status: 'requested' })
    n++
    console.log(`capability: upserted ${cap.slug} (requested)`)
  }
  console.log(`Done — ${n} capabilities seeded.`)
}

// BUILDER-CERT-1 (WP2) — the seed DATA above is the in-repo source of truth for the
// capability contracts, and the composition-contract test imports it to pin the
// doctrine to it. Run main() only when this file is executed directly, so importing
// the data never requires (or touches) a database.
const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  })
}
