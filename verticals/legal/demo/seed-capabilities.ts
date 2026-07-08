// Seed the platform capability library (migration 0117) with EVERYTHING the
// platform can do today — the living catalog the service-builder reads to decide
// reuse vs. build. Idempotent (upsert by slug through the action layer). Run with
// the prod DATABASE_URL:
//   tsx --env-file=<main-worktree>/.env.local verticals/legal/demo/seed-capabilities.ts
//
// DISCIPLINE: whenever a NEW capability ships, add it here (and re-run) — the
// library is only as useful as it is complete. A capability the builder can't see
// is one it will wastefully try to build from scratch or wrongly say is missing.
import { upsertCapability, type UpsertCapabilityInput } from '@exsto/legal'
import { type ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ADMIN = '00000000-0000-0000-0001-000000000004' // seeded Claude agent actor

// The current platform surface. `backed_by` names the workflow step / tool /
// feature that implements it, so the builder knows HOW to wire it in.
const CAPABILITIES: Array<Omit<UpsertCapabilityInput, 'status'>> = [
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
        'Send a document for signature by link (DocuSign-style fields, signer order, portal + link delivery, status tracking) — no external service.',
      when_to_use:
        'Add a signature step to a workflow when a document must be signed (engagement letters, agreements).',
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
]

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const ctx: ActionContext = { tenantId: TENANT, actorId: ADMIN }
  let n = 0
  for (const cap of CAPABILITIES) {
    await upsertCapability(ctx, { ...cap, status: 'available' })
    n++
    console.log(`capability: upserted ${cap.slug}`)
  }
  console.log(`Done — ${n} capabilities seeded.`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
