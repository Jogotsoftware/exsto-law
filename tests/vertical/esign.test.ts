// Session 5 vertical acceptance: the native DocuSign-style e-signature flow on a
// live DB — fields, sequential routing, portal + link signing, delivered/opened/
// signed status — all through the operation core, no external host.
//
// Covers:
//   • send (native) with field tags + a portal signer → envelope, fields stored,
//     first signer delivered; portal sign (recordSignatureForClient) resolves the
//     tags and writes the executed copy as a NEW immutable document_version.
//   • sequential order: order-1 (portal) delivered, order-2 (external link)
//     pending; after order-1 signs, order-2 becomes delivered (with a link).
//   • getEnvelopeStatus reflects per-signer state.
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

async function makeApprovedDraft(): Promise<{
  matterId: string
  draftEntityId: string
  documentVersionId: string
  clientEmail: string
}> {
  const { submitBooking, loadCall, cacheDraft, approveDraft } = await import('@exsto/legal')
  const slot = randomSlot()
  const clientEmail = `s5-esign-${randomUUID().slice(0, 8)}@example.test`
  const booking = await submitBooking(
    { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR },
    {
      clientFullName: 'S5 Esign Client',
      clientEmail,
      attributionSource: 'vertical-test',
      serviceKey: 'nc_llc_single_member',
      intakeResponses: { company_name: 'S5 Esign LLC', company_purpose: 'esign test' },
      scheduledAtIso: slot.startIso,
      scheduledEndIso: slot.endIso,
    },
  )
  const matterId = (booking.effects[0] as { matterEntityId: string }).matterEntityId
  await loadCall(
    { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR },
    {
      matterEntityId: matterId,
      externalCallId: `s5-call-${randomUUID().slice(0, 8)}`,
      startedAt: slot.startIso,
      endedAt: slot.endIso,
      transcriptText: 'Client confirmed the operating agreement terms.',
      transcriptSource: 'manual',
    },
  )
  const draft = await cacheDraft(ATTORNEY_CTX, {
    matterEntityId: matterId,
    documentKind: 'operating_agreement',
    documentMarkdown: '# Operating Agreement\n\nS5 esign draft body.',
    prompt: 'S5 esign test prompt',
    reasoningTrace: {
      evidence: [`entity:${matterId}`],
      alternatives_considered: [],
      conclusion: 'Drafted for e-sign test.',
      confidence: 0.9,
      ambiguities: [],
    },
    modelIdentity: 'cached-demo-draft',
  })
  const eff = draft.effects[0] as { draftEntityId: string; documentVersionId: string }
  await approveDraft(ATTORNEY_CTX, {
    documentVersionId: eff.documentVersionId,
    reviewNotes: 'ready to execute',
  })
  return {
    matterId,
    draftEntityId: eff.draftEntityId,
    documentVersionId: eff.documentVersionId,
    clientEmail,
  }
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

run('native e-signature flow (live DB)', { timeout: 120_000 }, () => {
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  it('portal signer signs with fields → executed copy resolves tags + certificate', async () => {
    const { sendForSignature, listClientSignatures, recordSignatureForClient } =
      await import('@exsto/legal')
    const { draftEntityId, documentVersionId, clientEmail } = await makeApprovedDraft()

    const prepared =
      '# Operating Agreement\n\nS5 esign draft body.\n\n' +
      'Member: {{name:client}}\nTitle: {{title:client}}\nSignature: {{sign:client}}\nDate: {{date:client}}\n'

    const sent = await sendForSignature(ATTORNEY_CTX, {
      documentVersionId,
      preparedMarkdown: prepared,
      signers: [
        { email: clientEmail, name: 'S5 Esign Client', title: 'Member', key: 'client', order: 1 },
      ],
    })
    expect(sent.provider).toBe('native')
    expect(sent.fieldCount).toBe(4)
    // The matter client is a known client_contact → routed to the portal.
    expect(sent.signers[0]?.channel).toBe('portal')
    expect(sent.signers[0]?.delivered).toBe(true)

    // Portal signing (authenticated client).
    const principal = await clientPrincipal(clientEmail)
    const pending = await listClientSignatures(principal)
    expect(pending.length).toBe(1)
    const res = await recordSignatureForClient(principal, {
      requestId: pending[0]!.requestId,
      signatureName: 'S5 Esign Client',
      consent: 'I agree to sign electronically.',
    })
    expect(res.completed).toBe(true)
    expect(res.executedDocumentVersionId).toBeTruthy()

    // Executed copy: every tag resolved, certificate appended, original SHA-256.
    const executed = await db.query<{ body: string; executed: boolean }>(
      `SELECT cb.body, (dv.metadata->>'executed')::boolean AS executed
       FROM document_version dv JOIN content_blob cb ON cb.id=dv.content_blob_id
       WHERE dv.tenant_id=$1 AND dv.document_entity_id=$2
       ORDER BY dv.version_number DESC LIMIT 1`,
      [TENANT, draftEntityId],
    )
    const body = executed.rows[0]!.body
    expect(executed.rows[0]!.executed).toBe(true)
    expect(body).not.toContain('{{') // all tags resolved
    expect(body).toContain('S5 Esign Client') // name + signature
    expect(body).toContain('Member') // title field
    expect(body).toContain('Signature Certificate')
    expect(body).toContain('SHA-256')
  })

  it('sequential order: order-1 (portal) delivered, order-2 (link) pending → delivered after order-1 signs', async () => {
    const { sendForSignature, getEnvelopeStatus, listClientSignatures, recordSignatureForClient } =
      await import('@exsto/legal')
    const { documentVersionId, clientEmail } = await makeApprovedDraft()
    const externalEmail = `ext-${randomUUID().slice(0, 8)}@external.test`

    const sent = await sendForSignature(ATTORNEY_CTX, {
      documentVersionId,
      preparedMarkdown: '# OA\n\nClient: {{sign:client}}\nCo-signer: {{sign:cosigner}}\n',
      signers: [
        { email: clientEmail, name: 'Client', key: 'client', order: 1 },
        { email: externalEmail, name: 'Co Signer', key: 'cosigner', order: 2 },
      ],
    })
    // Channels: client → portal, external → link.
    const byEmail = Object.fromEntries(sent.signers.map((s) => [s.email, s]))
    expect(byEmail[clientEmail]?.channel).toBe('portal')
    expect(byEmail[externalEmail]?.channel).toBe('link')

    let status = await getEnvelopeStatus(ATTORNEY_CTX, sent.envelopeId)
    const stByEmail = (st: typeof status) =>
      Object.fromEntries(st.signers.map((s) => [s.email, s.status]))
    expect(stByEmail(status)[clientEmail]).toBe('delivered')
    expect(stByEmail(status)[externalEmail]).toBe('pending') // not their turn yet

    // Order-1 (portal client) signs → order-2 becomes delivered.
    const principal = await clientPrincipal(clientEmail)
    const pending = await listClientSignatures(principal)
    const clientReq = pending.find((p) => p.envelopeId === sent.envelopeId)
    expect(clientReq).toBeTruthy()
    const r = await recordSignatureForClient(principal, {
      requestId: clientReq!.requestId,
      signatureName: 'Client',
      consent: 'I agree.',
    })
    expect(r.completed).toBe(false) // co-signer still outstanding

    status = await getEnvelopeStatus(ATTORNEY_CTX, sent.envelopeId)
    expect(stByEmail(status)[clientEmail]).toBe('signed')
    expect(stByEmail(status)[externalEmail]).toBe('delivered') // now their turn
  })
})
