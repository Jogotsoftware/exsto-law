// Session 5 vertical acceptance: the NATIVE e-signature lifecycle on a live DB,
// exercised end-to-end through the operation core with no external host.
//
// Covers:
//   esign.send  → signature_envelope linked envelope_of → document, one
//                 signature_request per signer, esign.sent, and a native signing
//                 link minted per signer (the email is enqueued).
//   esign.sign  → the signer (via their signing token) signs through the public
//                 path (recordSignature); the last signer completes the envelope
//                 and the executed copy — original + signature certificate with
//                 the original content SHA-256 — lands as a NEW immutable
//                 document_version (invariant 14). The original version stays.
//   esign.decline → a signer declines; the envelope closes declined.
//   gate        → selecting an unconnected EXTERNAL provider records a
//                 pending_dispatch envelope and attempts no live call.
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

// The native signing token is HMAC-signed; provide a secret for the test run.
process.env.ESIGN_SIGNING_SECRET ??= 'test-esign-signing-secret-0123456789'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR = '00000000-0000-0000-0001-000000000005'
const ATTORNEY_ACTOR = '00000000-0000-0000-0001-000000000002'

function randomSlot(): { startIso: string; endIso: string } {
  const daysAhead = 60 + Math.floor(Math.random() * 200000)
  const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
  start.setUTCHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 2) * 30, 0, 0)
  return { startIso: start.toISOString(), endIso: new Date(start.getTime() + 1800e3).toISOString() }
}

function tokenFromLink(link: string): string {
  const marker = '/sign/'
  return decodeURIComponent(link.substring(link.indexOf(marker) + marker.length))
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
  const draft = await cacheDraft(
    { tenantId: TENANT, actorId: ATTORNEY_ACTOR },
    {
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
    },
  )
  const eff = draft.effects[0] as { draftEntityId: string; documentVersionId: string }
  await approveDraft(
    { tenantId: TENANT, actorId: ATTORNEY_ACTOR },
    { documentVersionId: eff.documentVersionId, reviewNotes: 'ready to execute' },
  )
  return {
    matterId,
    draftEntityId: eff.draftEntityId,
    documentVersionId: eff.documentVersionId,
    clientEmail,
  }
}

run('native e-signature lifecycle (live DB)', { timeout: 120_000 }, () => {
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  it('send (native) → envelope + request + esign.sent + signing link; sign → completed → executed version', async () => {
    const { sendForSignature, recordSignature } = await import('@exsto/legal')
    const { draftEntityId, documentVersionId, clientEmail } = await makeApprovedDraft()

    // ── esign.send via the native engine (no external host) ───────────────────
    const sent = await sendForSignature(
      { tenantId: TENANT, actorId: ATTORNEY_ACTOR },
      { documentVersionId, signers: [{ email: clientEmail, name: 'S5 Esign Client' }] },
    )
    expect(sent.provider).toBe('native')
    expect(sent.dispatched).toBe(true)
    expect(sent.providerEnvelopeRef).toBeNull()
    expect(sent.signerLinks?.length).toBe(1)
    const envelopeId = sent.envelopeId
    expect(envelopeId).toBeTruthy()

    // envelope_of → document, one request_of, esign.sent on the timeline.
    const rel = await db.query(
      `SELECT 1 FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id=$1 AND rkd.kind_name='envelope_of'
         AND r.source_entity_id=$2 AND r.target_entity_id=$3`,
      [TENANT, envelopeId, draftEntityId],
    )
    expect(rel.rowCount).toBe(1)
    const reqs = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id=$1 AND rkd.kind_name='request_of' AND r.target_entity_id=$2`,
      [TENANT, envelopeId],
    )
    expect(Number(reqs.rows[0].n)).toBe(1)
    const sentEvt = await db.query(
      `SELECT 1 FROM event e JOIN event_kind_definition ekd ON ekd.id=e.event_kind_id
       WHERE e.tenant_id=$1 AND ekd.kind_name='esign.sent' AND $2 = ANY(e.secondary_entity_ids)`,
      [TENANT, envelopeId],
    )
    expect(sentEvt.rowCount).toBe(1)

    // ── the signer signs via their secure link (public path) ──────────────────
    const token = tokenFromLink(sent.signerLinks![0]!.url)
    const result = await recordSignature({
      token,
      signatureName: 'S5 Esign Client',
      consent: 'I agree to sign electronically.',
    })
    expect(result.completed).toBe(true)
    expect(result.executedDocumentVersionId).toBeTruthy()

    const signedEvt = await db.query(
      `SELECT 1 FROM event e JOIN event_kind_definition ekd ON ekd.id=e.event_kind_id
       WHERE e.tenant_id=$1 AND ekd.kind_name='esign.signed' AND e.primary_entity_id=$2`,
      [TENANT, envelopeId],
    )
    expect(signedEvt.rowCount).toBe(1)
    const completedEvt = await db.query(
      `SELECT 1 FROM event e JOIN event_kind_definition ekd ON ekd.id=e.event_kind_id
       WHERE e.tenant_id=$1 AND ekd.kind_name='esign.completed' AND $2 = ANY(e.secondary_entity_ids)`,
      [TENANT, envelopeId],
    )
    expect(completedEvt.rowCount).toBe(1)

    // envelope_status completed (latest attribute value wins).
    const status = await db.query<{ value: string }>(
      `SELECT a.value #>> '{}' AS value FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id=a.attribute_kind_id
       WHERE a.tenant_id=$1 AND a.entity_id=$2 AND akd.kind_name='envelope_status'
       ORDER BY a.valid_from DESC LIMIT 1`,
      [TENANT, envelopeId],
    )
    expect(status.rows[0].value).toBe('completed')

    // Executed copy = NEW immutable v2: approved, executed, with the certificate.
    const versions = await db.query<{
      version_number: number
      status: string
      executed: boolean
      body: string
    }>(
      `SELECT dv.version_number, dv.status,
              (dv.metadata->>'executed')::boolean AS executed, cb.body
       FROM document_version dv JOIN content_blob cb ON cb.id=dv.content_blob_id
       WHERE dv.tenant_id=$1 AND dv.document_entity_id=$2 ORDER BY dv.version_number`,
      [TENANT, draftEntityId],
    )
    expect(versions.rows.length).toBe(2)
    expect(versions.rows[1].version_number).toBe(2)
    expect(versions.rows[1].status).toBe('approved')
    expect(versions.rows[1].executed).toBe(true)
    expect(versions.rows[1].body).toContain('Signature Certificate')
    expect(versions.rows[1].body).toContain('SHA-256')
    // The original v1 body is untouched (no certificate appended).
    expect(versions.rows[0].body).not.toContain('Signature Certificate')
  })

  it('a signer can decline; the envelope closes declined', async () => {
    const { sendForSignature, declineSignature } = await import('@exsto/legal')
    const { documentVersionId, clientEmail } = await makeApprovedDraft()
    const sent = await sendForSignature(
      { tenantId: TENANT, actorId: ATTORNEY_ACTOR },
      { documentVersionId, signers: [{ email: clientEmail }] },
    )
    const token = tokenFromLink(sent.signerLinks![0]!.url)
    await declineSignature({ token, reason: 'changed my mind' })

    const declinedEvt = await db.query(
      `SELECT 1 FROM event e JOIN event_kind_definition ekd ON ekd.id=e.event_kind_id
       WHERE e.tenant_id=$1 AND ekd.kind_name='esign.declined' AND e.primary_entity_id=$2`,
      [TENANT, sent.envelopeId],
    )
    expect(declinedEvt.rowCount).toBe(1)
    const status = await db.query<{ value: string }>(
      `SELECT a.value #>> '{}' AS value FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id=a.attribute_kind_id
       WHERE a.tenant_id=$1 AND a.entity_id=$2 AND akd.kind_name='envelope_status'
       ORDER BY a.valid_from DESC LIMIT 1`,
      [TENANT, sent.envelopeId],
    )
    expect(status.rows[0].value).toBe('declined')
  })

  it('gate: an unconnected external provider records pending_dispatch and sends nothing', async () => {
    const { sendForSignature } = await import('@exsto/legal')
    const { documentVersionId, clientEmail } = await makeApprovedDraft()
    const sent = await sendForSignature(
      { tenantId: TENANT, actorId: ATTORNEY_ACTOR },
      { documentVersionId, provider: 'opensign', signers: [{ email: clientEmail }] },
    )
    expect(sent.dispatched).toBe(false)
    expect(sent.activation).toBeTruthy()
    const status = await db.query<{ value: string }>(
      `SELECT a.value #>> '{}' AS value FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id=a.attribute_kind_id
       WHERE a.tenant_id=$1 AND a.entity_id=$2 AND akd.kind_name='envelope_status'
       ORDER BY a.valid_from DESC LIMIT 1`,
      [TENANT, sent.envelopeId],
    )
    expect(status.rows[0].value).toBe('pending_dispatch')
  })
})
