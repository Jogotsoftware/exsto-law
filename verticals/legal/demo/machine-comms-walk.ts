// MACHINE-COMMS-1 — the acceptance WALK harness: exercise memory + voice against
// the pilot tenant, one subcommand per block, printing receipts. All writes flow
// through the same server functions the product surfaces call.
//
//   npx tsx --env-file=.env.local verticals/legal/demo/machine-comms-walk.ts <cmd> [...args]
//
//   draft-email <matterId> "<purpose>"          — compose an email draft (worker path runs this same fn)
//   regen-email <matterId> <docEntityId> "<notes>" — regenerate an email draft as version n+1
//   approve <documentVersionId>                 — approve a review-queue version; for an email draft this SENDS it
//   revise <documentVersionId> "<notes>"        — request revision on a version
//   extract <matterId> [transcriptId]           — distill the matter's transcript into notes
//   notes <entityId>                            — list notes on a matter/client
//   queue                                       — list pending review-queue rows (channel-tagged)
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import type { ActionContext } from '@exsto/substrate'
import {
  composeEmailDraft,
  runTranscriptExtraction,
  approveDraft,
  requestDraftRevision,
  listNotesForEntity,
  listPendingDraftVersions,
  recordManualCall,
  createNote,
  createService,
  setServiceLifecycle,
  updateServiceMetadata,
  setServiceActive,
  submitBooking,
} from '@exsto/legal'
import '@exsto/legal'

const TENANT = process.env.SEED_TENANT ?? '00000000-0000-0000-0000-000000000001'
// Joe's attorney actor — approvals are HIS review decisions.
const ATTORNEY = process.env.WALK_ACTOR ?? 'e193d11c-9204-4068-8d01-0613ec1a5095'
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const [cmd, a1, a2, a3] = process.argv.slice(2)
  switch (cmd) {
    case 'draft-email': {
      if (!a1 || !a2) throw new Error('draft-email <matterId> "<purpose>"')
      const r = await composeEmailDraft(ctx, { matterEntityId: a1, purpose: a2 })
      console.log(JSON.stringify(r, null, 2))
      return
    }
    case 'regen-email': {
      if (!a1 || !a2 || !a3) throw new Error('regen-email <matterId> <docEntityId> "<notes>"')
      const r = await composeEmailDraft(ctx, {
        matterEntityId: a1,
        purpose: 'Regenerate this email applying the revision notes.',
        supersedesDocumentEntityId: a2,
        guidance: a3,
      })
      console.log(JSON.stringify(r, null, 2))
      return
    }
    case 'approve': {
      if (!a1) throw new Error('approve <documentVersionId>')
      const r = await approveDraft(ctx, { documentVersionId: a1 })
      console.log(JSON.stringify(r.effects, null, 2))
      return
    }
    case 'revise': {
      if (!a1 || !a2) throw new Error('revise <documentVersionId> "<notes>"')
      const r = await requestDraftRevision(ctx, { documentVersionId: a1, reviewNotes: a2 })
      console.log(JSON.stringify(r.effects, null, 2))
      return
    }
    case 'paste-transcript': {
      // The matter page's paste path (legal.call.record_manual) — the transcript
      // source that works regardless of Granola state.
      if (!a1 || !a2) throw new Error('paste-transcript <matterId> <textFile>')
      const r = await recordManualCall(ctx, {
        matterEntityId: a1,
        transcriptText: readFileSync(a2, 'utf8'),
      })
      console.log(JSON.stringify(r.effects, null, 2))
      return
    }
    case 'extract': {
      if (!a1) throw new Error('extract <matterId> [transcriptId]')
      const r = await runTranscriptExtraction(ctx, {
        matterEntityId: a1,
        transcriptEntityId: a2 || undefined,
      })
      console.log(JSON.stringify(r, null, 2))
      return
    }
    case 'compose-email-service': {
      // The COMPOSED-stage receipt rig: a minimal real service whose ENTRY stage is
      // an email_generation step (auto-runs on matter.open → the deployed worker
      // drafts → parks at the attorney gate; approve = send + advance → terminal
      // complete). Created through the same server functions the wizard's approve
      // routes call. Left DISABLED until the walk enables it.
      const created = await createService(ctx, {
        displayName: 'Lease review follow-up',
        description:
          'A personal follow-up from your attorney on your completed lease review — what we found, what was delivered, and your next steps.',
        route: 'manual',
      })
      const graph = [
        {
          key: 'send_update',
          entry: true,
          label: 'Send the client update',
          blocking: true,
          action: {
            kind: 'invoke_capability',
            config: {
              capability_slug: 'email_generation',
              capability_config: {
                purpose:
                  'Write the client a personal follow-up on their completed residential lease review: recap what the firm found and delivered (use their history), confirm everything is available in their portal, and invite them to book again when they next need a document reviewed.',
              },
            },
          },
          advances_to: [{ to: 'complete', gate: 'attorney', via: 'draft.approve' }],
        },
        {
          key: 'complete',
          label: 'Complete matter',
          terminal: true,
          blocking: false,
          action: { kind: 'complete_matter' },
          advances_to: [],
        },
      ]
      const lifecycle = await setServiceLifecycle(ctx, created.serviceKey, graph as never)
      await updateServiceMetadata(ctx, {
        serviceKey: created.serviceKey,
        displayName: 'Lease review follow-up',
        description:
          'A personal follow-up from your attorney on your completed lease review — what we found, what was delivered, and your next steps.',
        appointmentRequired: false,
      })
      console.log(JSON.stringify({ serviceKey: created.serviceKey, lifecycle }, null, 2))
      return
    }
    case 'enable-service': {
      if (!a1) throw new Error('enable-service <serviceKey> [off]')
      const r = await setServiceActive(ctx, a1, a2 !== 'off')
      console.log(JSON.stringify(r, null, 2))
      return
    }
    case 'book': {
      // Public intake-only booking as Dana (the client with the archived history).
      if (!a1) throw new Error('book <serviceKey>')
      const publicCtx: ActionContext = {
        tenantId: TENANT,
        actorId: '00000000-0000-0000-0001-000000000005', // public booking actor
      }
      const res = await submitBooking(publicCtx, {
        clientFullName: 'Dana Whitfield',
        clientEmail: 'pachecojoseph824+leasecert@gmail.com',
        clientPhone: '9195550117',
        attributionSource: 'public_booking',
        serviceKey: a1,
        intakeResponses: {},
      })
      console.log(JSON.stringify(res.effects, null, 2))
      return
    }
    case 'add-note': {
      // add-note matter|client <entityId> "<body>"
      if (!a1 || !a2 || !a3) throw new Error('add-note matter|client <entityId> "<body>"')
      const r = await createNote(ctx, {
        body: a3,
        ...(a1 === 'client' ? { clientEntityId: a2 } : { matterEntityId: a2 }),
      })
      console.log(JSON.stringify(r, null, 2))
      return
    }
    case 'notes': {
      if (!a1) throw new Error('notes <entityId>')
      console.log(JSON.stringify(await listNotesForEntity(ctx, a1), null, 2))
      return
    }
    case 'queue': {
      const rows = await listPendingDraftVersions(ctx)
      console.log(
        JSON.stringify(
          rows.map((r) => ({
            versionId: r.documentVersionId,
            entityId: r.documentEntityId,
            matter: r.matterNumber,
            kind: r.documentKind,
            channel: r.channel,
            subject: r.emailSubject,
            v: r.versionNumber,
          })),
          null,
          2,
        ),
      )
      return
    }
    default:
      throw new Error(`unknown command: ${cmd ?? '(none)'}`)
  }
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    })
}
