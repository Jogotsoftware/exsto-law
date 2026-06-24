// Vertical acceptance for SIGNATURE TASKS (migration 0113) on a live DB: a task
// carries a document, drives the native e-signature envelope, and cannot complete
// until every party has signed AND the attorney reviews the executed copy.
//
// Covers:
//   • create a signature task (documentVersionId) → kind 'signature', doc attached
//   • the review gate: reviewTask throws before an envelope exists, and again while
//     signatures are still open (envelope not 'completed')
//   • link the envelope, the single portal signer signs → envelope completes
//   • reviewTask now succeeds → task status 'done', reviewedAt set
//   • attachDocumentToTask turns a plain task into a signature task
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

process.env.ESIGN_SIGNING_SECRET ??= 'test-esign-signing-secret-0123456789'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR = '00000000-0000-0000-0001-000000000005'
const ATTORNEY_ACTOR = '00000000-0000-0000-0001-000000000002'
const ATTORNEY_CTX = { tenantId: TENANT, actorId: ATTORNEY_ACTOR }

function randomSlot(): { startIso: string; endIso: string } {
  const daysAhead = 60 + Math.floor(Math.random() * 200000)
  const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
  start.setUTCHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 2) * 30, 0, 0)
  return { startIso: start.toISOString(), endIso: new Date(start.getTime() + 1800e3).toISOString() }
}

// A matter with an approved operating-agreement draft, ready to send for signature.
async function makeApprovedDraft(): Promise<{
  matterId: string
  documentVersionId: string
  clientEmail: string
}> {
  const { submitBooking, loadCall, cacheDraft, approveDraft } = await import('@exsto/legal')
  const slot = randomSlot()
  const clientEmail = `sigtask-${randomUUID().slice(0, 8)}@example.test`
  const booking = await submitBooking(
    { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR },
    {
      clientFullName: 'Sig Task Client',
      clientEmail,
      attributionSource: 'vertical-test',
      serviceKey: 'nc_llc_single_member',
      intakeResponses: { company_name: 'Sig Task LLC', company_purpose: 'sig task test' },
      scheduledAtIso: slot.startIso,
      scheduledEndIso: slot.endIso,
    },
  )
  const matterId = (booking.effects[0] as { matterEntityId: string }).matterEntityId
  await loadCall(
    { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR },
    {
      matterEntityId: matterId,
      externalCallId: `sigtask-call-${randomUUID().slice(0, 8)}`,
      startedAt: slot.startIso,
      endedAt: slot.endIso,
      transcriptText: 'Client confirmed the operating agreement terms.',
      transcriptSource: 'manual',
    },
  )
  const draft = await cacheDraft(ATTORNEY_CTX, {
    matterEntityId: matterId,
    documentKind: 'operating_agreement',
    documentMarkdown: '# Operating Agreement\n\nSig task draft body.',
    prompt: 'sig task test prompt',
    reasoningTrace: {
      evidence: [`entity:${matterId}`],
      alternatives_considered: [],
      conclusion: 'Drafted for sig-task test.',
      confidence: 0.9,
      ambiguities: [],
    },
    modelIdentity: 'cached-demo-draft',
  })
  const eff = draft.effects[0] as { documentVersionId: string }
  await approveDraft(ATTORNEY_CTX, {
    documentVersionId: eff.documentVersionId,
    reviewNotes: 'ready to execute',
  })
  return { matterId, documentVersionId: eff.documentVersionId, clientEmail }
}

async function clientPrincipal(clientEmail: string) {
  const { findClientContactByEmail, resolveClientMatterIds } = await import('@exsto/legal')
  const contact = await findClientContactByEmail(clientEmail)
  if (!contact) throw new Error('client_contact not found for ' + clientEmail)
  const matterIds = await resolveClientMatterIds(TENANT, contact.clientContactId)
  return {
    tenantId: TENANT,
    clientContactId: contact.clientContactId,
    email: clientEmail,
    matterIds,
  }
}

run('signature task flow (live DB)', { timeout: 120_000 }, () => {
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  it('task drives the envelope and completes only after sign + review', async () => {
    const {
      createTask,
      getTaskById,
      linkTaskEnvelope,
      reviewTask,
      sendForSignature,
      listClientSignatures,
      recordSignatureForClient,
    } = await import('@exsto/legal')
    const { matterId, documentVersionId, clientEmail } = await makeApprovedDraft()

    // 1. A task created with a document is a signature task from the start.
    const task = await createTask(ATTORNEY_CTX, {
      matterEntityId: matterId,
      title: 'Sign the operating agreement',
      documentVersionId,
    })
    expect(task.kind).toBe('signature')
    expect(task.documentVersionId).toBe(documentVersionId)
    expect(task.status).toBe('open')
    expect(task.esignEnvelopeId).toBeNull()

    // 2. Review gate — nothing to review before an envelope exists.
    await expect(reviewTask(ATTORNEY_CTX, { taskId: task.taskId })).rejects.toThrow()

    // 3. Send for signature, then link the envelope to the task.
    const sent = await sendForSignature(ATTORNEY_CTX, {
      documentVersionId,
      preparedMarkdown: '# Operating Agreement\n\nSig task body.\n\nSignature: {{sign:client}}\n',
      signers: [{ email: clientEmail, name: 'Sig Task Client', key: 'client', order: 1 }],
    })
    const linked = await linkTaskEnvelope(ATTORNEY_CTX, {
      taskId: task.taskId,
      envelopeId: sent.envelopeId,
    })
    expect(linked.esignEnvelopeId).toBe(sent.envelopeId)

    // 4. Review gate again — can't complete while signatures are still open.
    await expect(reviewTask(ATTORNEY_CTX, { taskId: task.taskId })).rejects.toThrow()

    // 5. The single portal signer signs → envelope completes.
    const principal = await clientPrincipal(clientEmail)
    const pending = await listClientSignatures(principal)
    const req = pending.find((p) => p.envelopeId === sent.envelopeId)
    expect(req).toBeTruthy()
    const signed = await recordSignatureForClient(principal, {
      requestId: req!.requestId,
      signatureName: 'Sig Task Client',
      consent: 'I agree to sign electronically.',
    })
    expect(signed.completed).toBe(true)

    // 6. Review now succeeds → task done + reviewedAt stamped.
    const reviewed = await reviewTask(ATTORNEY_CTX, { taskId: task.taskId })
    expect(reviewed.status).toBe('done')
    expect(reviewed.reviewedAt).toBeTruthy()

    // Reflected on a fresh read.
    const fresh = await getTaskById(ATTORNEY_CTX, task.taskId)
    expect(fresh?.status).toBe('done')
    expect(fresh?.reviewedAt).toBeTruthy()
  })

  it('attachDocumentToTask turns a plain task into a signature task', async () => {
    const { createTask, attachDocumentToTask } = await import('@exsto/legal')
    const { matterId, documentVersionId } = await makeApprovedDraft()

    const plain = await createTask(ATTORNEY_CTX, {
      matterEntityId: matterId,
      title: 'Follow up with client',
    })
    expect(plain.kind).toBe('todo')
    expect(plain.documentVersionId).toBeNull()

    const attached = await attachDocumentToTask(ATTORNEY_CTX, {
      taskId: plain.taskId,
      documentVersionId,
    })
    expect(attached.kind).toBe('signature')
    expect(attached.documentVersionId).toBe(documentVersionId)
  })
})
