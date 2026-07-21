// P0 fix — the client-portal SIGNING gate (assertClientOwnsRequest, esign.ts)
// resolved a request's matter ONLY via a draft_of relationship, so an
// uploaded-PDF envelope (ESIGN-ANY-DOC: document_of the matter, or
// document_of_contact directly when standalone) always 500'd with "You are not
// authorized to sign this document." — even for the client the document was
// sent to. This is DISTINCT from the earlier listing-visibility fix (see
// esign-portal-visibility.test.ts): that made the request show up in the
// portal's lists; this is the gate the SIGN action itself (and the file-byte
// route, apps/legal-demo/app/api/client/portal/file) goes through.
//
// Covers, on a live DB, via resolveClientEnvelopeId (the exported door onto
// assertClientOwnsRequest):
//   • a document_of envelope (uploaded PDF filed under a matter) is signable by
//     a client on that matter — the regression.
//   • a document_of_contact-ONLY envelope (standalone upload, no matter at all)
//     is signable by the client it was filed under directly.
//   • a client NOT on the document_of envelope's matter is still rejected.
//   • a client who is NOT the document_of_contact target is still rejected,
//     even though they are a real, active client of the SAME tenant.
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'

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

async function makeMatterWithClient(
  label: string,
): Promise<{ matterId: string; clientEmail: string; clientContactId: string }> {
  const { submitBooking, findClientContactByEmail } = await import('@exsto/legal')
  const slot = randomSlot()
  const clientEmail = `portal-authz-${label}-${randomUUID().slice(0, 8)}@example.test`
  const booking = await submitBooking(
    { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR },
    {
      clientFullName: `Portal Authz Client ${label}`,
      clientEmail,
      attributionSource: 'vertical-test',
      serviceKey: 'nc_llc_single_member',
      intakeResponses: {
        company_name: `Portal Authz ${label} LLC`,
        company_purpose: 'portal signing authz test',
      },
      scheduledAtIso: slot.startIso,
      scheduledEndIso: slot.endIso,
    },
  )
  const matterId = (booking.effects[0] as { matterEntityId: string }).matterEntityId
  const contact = await findClientContactByEmail(clientEmail)
  if (!contact) throw new Error('client_contact not found for ' + clientEmail)
  return { matterId, clientEmail, clientContactId: contact.clientContactId }
}

async function clientPrincipal(clientEmail: string, clientContactId: string) {
  const { resolveClientMatterIds } = await import('@exsto/legal')
  const matterIds = await resolveClientMatterIds(TENANT, clientContactId)
  return { tenantId: TENANT, clientContactId, email: clientEmail, matterIds }
}

// Send an uploaded PDF for signature, filed either under a matter
// (document_of) or directly under a contact (document_of_contact) when no
// matter is given — the two ESIGN-ANY-DOC ownership shapes assertClientOwnsRequest
// must recognize. Returns the envelope + the recipient's requestId.
async function sendUploadForSignature(input: {
  matterEntityId?: string | null
  attachContactEntityId?: string | null
  recipientEmail: string
  filename?: string
}): Promise<{ envelopeId: string; requestId: string }> {
  const { recordUploadedDocument, sendFileForSignature, getEnvelopeStatus } =
    await import('@exsto/legal')
  const uploaded = await recordUploadedDocument(ATTORNEY_CTX, {
    matterEntityId: input.matterEntityId ?? null,
    attachContactEntityId: input.attachContactEntityId ?? null,
    objectKey: `${TENANT}/authz-test/${randomUUID()}-${input.filename ?? 'doc.pdf'}`,
    originalFilename: input.filename ?? 'doc.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1234,
    sha256Hex: randomUUID().replace(/-/g, '').padEnd(64, '0'),
    documentKind: 'esign_upload',
  })
  const sent = await sendFileForSignature(ATTORNEY_CTX, {
    documentVersionId: uploaded.documentVersionId,
    signers: [{ email: input.recipientEmail, name: 'Portal Authz Client', order: 1 }],
  })
  const status = await getEnvelopeStatus(ATTORNEY_CTX, sent.envelopeId)
  const requestId = status.signers.find((s) => s.email === input.recipientEmail)?.requestId
  if (!requestId) throw new Error('signature request not found for ' + input.recipientEmail)
  return { envelopeId: sent.envelopeId, requestId }
}

run(
  'client-portal signing authorization: document_of AND document_of_contact (live DB)',
  { timeout: 120_000 },
  () => {
    afterAll(async () => {
      const { closeDbPool } = await import('@exsto/shared')
      await closeDbPool()
    })

    it('a document_of envelope (uploaded PDF filed under a matter) is signable by a client on that matter', async () => {
      const { resolveClientEnvelopeId } = await import('@exsto/legal')
      const owner = await makeMatterWithClient('doc-of-owner')
      const { envelopeId, requestId } = await sendUploadForSignature({
        matterEntityId: owner.matterId,
        recipientEmail: owner.clientEmail,
      })

      const principal = await clientPrincipal(owner.clientEmail, owner.clientContactId)
      await expect(resolveClientEnvelopeId(principal, requestId)).resolves.toBe(envelopeId)
    })

    it("rejects a client who is NOT on the document_of envelope's matter", async () => {
      const { resolveClientEnvelopeId } = await import('@exsto/legal')
      const owner = await makeMatterWithClient('doc-of-owner2')
      const stranger = await makeMatterWithClient('doc-of-stranger')
      const { requestId } = await sendUploadForSignature({
        matterEntityId: owner.matterId,
        recipientEmail: owner.clientEmail,
      })

      // Impersonate the request with a DIFFERENT (real, active) client's principal
      // — same tenant, wrong matter, and (critically) the signer_email check alone
      // would pass if we reused owner's email, so use the stranger's own identity.
      const strangerAsOwnerEmail = {
        tenantId: TENANT,
        clientContactId: stranger.clientContactId,
        email: owner.clientEmail, // even knowing the signer's email...
        matterIds: [stranger.matterId], // ...the matter ownership still fails.
      }
      await expect(resolveClientEnvelopeId(strangerAsOwnerEmail, requestId)).rejects.toThrow(
        'You are not authorized to sign this document.',
      )
    })

    it('a document_of_contact-only envelope (standalone upload, no matter) is signable by the contact it was filed under', async () => {
      const { resolveClientEnvelopeId } = await import('@exsto/legal')
      // The contact exists (via a real matter elsewhere), but THIS envelope has no
      // matter at all — ownership must resolve via document_of_contact alone.
      const client = await makeMatterWithClient('doc-of-contact-owner')
      const { envelopeId, requestId } = await sendUploadForSignature({
        attachContactEntityId: client.clientContactId,
        recipientEmail: client.clientEmail,
        filename: 'standalone.pdf',
      })

      const principal = await clientPrincipal(client.clientEmail, client.clientContactId)
      await expect(resolveClientEnvelopeId(principal, requestId)).resolves.toBe(envelopeId)
    })

    it('rejects a client who is not the document_of_contact target, even if active in the same tenant', async () => {
      const { resolveClientEnvelopeId } = await import('@exsto/legal')
      const owner = await makeMatterWithClient('doc-of-contact-owner2')
      const other = await makeMatterWithClient('doc-of-contact-other')
      const { requestId } = await sendUploadForSignature({
        attachContactEntityId: owner.clientContactId,
        recipientEmail: owner.clientEmail,
        filename: 'standalone2.pdf',
      })

      // `other`'s own principal (their own email/contact/matters) has no path to
      // owner's standalone envelope — no matter in common (there is no matter at
      // all) and a different clientContactId than the document_of_contact target.
      const otherPrincipal = await clientPrincipal(other.clientEmail, other.clientContactId)
      await expect(resolveClientEnvelopeId(otherPrincipal, requestId)).rejects.toThrow(
        'You are not authorized to sign this document.',
      )
    })
  },
)
