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
