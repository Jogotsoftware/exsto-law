// P0 fix — the portal e-sign surface (Signatures/Documents tabs) joined
// document→matter with an INNER JOIN on relationship kind draft_of ONLY. Any-PDF
// envelopes (esignFile.ts / sendFileForSignature) attach their uploaded document
// to the matter via document_of, so those envelopes were NEVER visible to the
// client who is supposed to sign them — a P0 hazard, not a cosmetic gap. The fix
// (verticals/legal/src/api/esign.ts, listClientSignatures + listClientDocuments)
// mirrors the attorney-side queries (getEnvelopeStatus, listEnvelopes): LEFT JOIN
// BOTH draft_of and document_of, COALESCE the matter id, everywhere the matter is
// used for scoping (the `= ANY($2)` matterIds filter included).
//
// Covers, on a live DB:
//   • a draft_of envelope (operating-agreement drafting path) is visible.
//   • a document_of envelope (any-PDF upload path) is visible — the regression.
//   • the matter-scope filter still excludes an envelope whose matter isn't in
//     the principal's matterIds (same tenant, different client).
//   • genuine tenant isolation: swapping the principal's tenantId returns nothing
//     even reusing the same matterIds/email (RLS + the $1 tenant param).
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'

process.env.ESIGN_SIGNING_SECRET ??= 'test-esign-signing-secret-0123456789'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR = '00000000-0000-0000-0001-000000000005'
const ATTORNEY_ACTOR = '00000000-0000-0000-0001-000000000002'
const ATTORNEY_CTX = { tenantId: TENANT, actorId: ATTORNEY_ACTOR }
const FOREIGN_TENANT = '99999999-9999-9999-9999-999999999999' // a tenant we are not

function randomSlot(): { startIso: string; endIso: string } {
  const daysAhead = 60 + Math.floor(Math.random() * 200000)
  const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
  start.setUTCHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 2) * 30, 0, 0)
  return { startIso: start.toISOString(), endIso: new Date(start.getTime() + 1800e3).toISOString() }
}

async function makeMatterWithClient(
  label: string,
): Promise<{ matterId: string; clientEmail: string }> {
  const { submitBooking } = await import('@exsto/legal')
  const slot = randomSlot()
  const clientEmail = `portal-vis-${label}-${randomUUID().slice(0, 8)}@example.test`
  const booking = await submitBooking(
    { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR },
    {
      clientFullName: `Portal Visibility Client ${label}`,
      clientEmail,
      attributionSource: 'vertical-test',
      serviceKey: 'nc_llc_single_member',
      intakeResponses: {
        company_name: `Portal Visibility ${label} LLC`,
        company_purpose: 'portal e-sign visibility test',
      },
      scheduledAtIso: slot.startIso,
      scheduledEndIso: slot.endIso,
    },
  )
  const matterId = (booking.effects[0] as { matterEntityId: string }).matterEntityId
  return { matterId, clientEmail }
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

async function sendDraftEnvelope(matterId: string, clientEmail: string): Promise<string> {
  const { cacheDraft, approveDraft, sendForSignature } = await import('@exsto/legal')
  const draft = await cacheDraft(ATTORNEY_CTX, {
    matterEntityId: matterId,
    documentKind: 'operating_agreement',
    documentMarkdown: '# Operating Agreement\n\nPortal-visibility draft body.',
    prompt: 'portal visibility test prompt',
    reasoningTrace: {
      evidence: [`entity:${matterId}`],
      alternatives_considered: [],
      conclusion: 'Drafted for portal-visibility test.',
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
  const sent = await sendForSignature(ATTORNEY_CTX, {
    documentVersionId: eff.documentVersionId,
    preparedMarkdown: '# OA\n\nSign: {{sign:client}}\n',
    signers: [{ email: clientEmail, name: 'Portal Visibility Client', key: 'client', order: 1 }],
  })
  return sent.envelopeId
}

async function sendFileEnvelope(
  matterId: string,
  recipientEmail: string,
  filename = 'lease.pdf',
): Promise<string> {
  const { recordUploadedDocument, sendFileForSignature } = await import('@exsto/legal')
  const uploaded = await recordUploadedDocument(ATTORNEY_CTX, {
    matterEntityId: matterId,
    objectKey: `${TENANT}/${matterId}/${randomUUID()}-${filename}`,
    originalFilename: filename,
    contentType: 'application/pdf',
    sizeBytes: 1234,
    sha256Hex: randomUUID().replace(/-/g, '').padEnd(64, '0'),
    documentKind: 'esign_upload',
  })
  const sent = await sendFileForSignature(ATTORNEY_CTX, {
    documentVersionId: uploaded.documentVersionId,
    signers: [{ email: recipientEmail, name: 'Portal Visibility Client', order: 1 }],
  })
  return sent.envelopeId
}

run(
  'portal e-sign visibility: draft_of AND document_of envelopes (live DB)',
  { timeout: 120_000 },
  () => {
    afterAll(async () => {
      const { closeDbPool } = await import('@exsto/shared')
      await closeDbPool()
    })

    it('listClientSignatures and listClientDocuments show both a draft_of envelope and an any-PDF document_of envelope', async () => {
      const { listClientSignatures, listClientDocuments } = await import('@exsto/legal')
      const { matterId, clientEmail } = await makeMatterWithClient('both-kinds')

      const draftEnvelopeId = await sendDraftEnvelope(matterId, clientEmail)
      const fileEnvelopeId = await sendFileEnvelope(matterId, clientEmail)

      const principal = await clientPrincipal(clientEmail)

      const signatures = await listClientSignatures(principal)
      const sigIds = signatures.map((s) => s.envelopeId)
      expect(sigIds).toContain(draftEnvelopeId)
      // The regression: before the fix, an any-PDF (document_of) envelope never
      // appeared here because the query INNER JOINed draft_of only.
      expect(sigIds).toContain(fileEnvelopeId)

      const documents = await listClientDocuments(principal)
      const docIds = documents.map((d) => d.envelopeId)
      expect(docIds).toContain(draftEnvelopeId)
      expect(docIds).toContain(fileEnvelopeId)

      // The file envelope's matter must resolve via the document_of COALESCE arm.
      const fileDoc = documents.find((d) => d.envelopeId === fileEnvelopeId)
      expect(fileDoc?.matterEntityId).toBe(matterId)
    })

    it('excludes an any-PDF envelope filed under a matter the principal is not client_of', async () => {
      const { listClientSignatures, listClientDocuments } = await import('@exsto/legal')
      const own = await makeMatterWithClient('own-matter')
      const other = await makeMatterWithClient('other-matter')

      // Filed under, and sent to, the OTHER matter's client.
      await sendFileEnvelope(other.matterId, other.clientEmail, 'other-client-doc.pdf')

      const ownPrincipal = await clientPrincipal(own.clientEmail)
      const signatures = await listClientSignatures(ownPrincipal)
      const documents = await listClientDocuments(ownPrincipal)
      expect(signatures.length).toBe(0)
      expect(documents.length).toBe(0)
    })

    it('is tenant-scoped: a principal with a foreign tenantId sees nothing, even reusing real matterIds/email', async () => {
      const { listClientSignatures, listClientDocuments } = await import('@exsto/legal')
      const { matterId, clientEmail } = await makeMatterWithClient('foreign-tenant')
      await sendDraftEnvelope(matterId, clientEmail)
      await sendFileEnvelope(matterId, clientEmail)

      const real = await clientPrincipal(clientEmail)
      const foreignPrincipal = { ...real, tenantId: FOREIGN_TENANT }

      const signatures = await listClientSignatures(foreignPrincipal)
      const documents = await listClientDocuments(foreignPrincipal)
      expect(signatures.length).toBe(0)
      expect(documents.length).toBe(0)
    })
  },
)
