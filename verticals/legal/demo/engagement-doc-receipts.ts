// ENGAGEMENT-DOC-1 receipts — the whole loop against a real letter, no UI:
//   1. extract text from the PDF
//   2. importEngagementAgreement (AI convert → template → firm pointer)
//   3. getClientEngagementAgreement — the merged doc a specific client would see
//
// Run: pnpm tsx --env-file=.env.local verticals/legal/demo/engagement-doc-receipts.ts \
//        <pdfPath> [tenantId] [actorId] [clientContactId]
// Defaults: tenant zero + founder attorney; pass a contact id to see the merge.
import { readFileSync } from 'node:fs'
import '@exsto/legal/mcp'
import {
  importEngagementAgreement,
  getClientEngagementAgreement,
  extractPdfText,
} from '@exsto/legal'

const TENANT = process.argv[3] ?? '00000000-0000-0000-0000-000000000001'
const ACTOR = process.argv[4] ?? '00000000-0000-0000-0001-000000000002' // Joe Pacheco
const CONTACT = process.argv[5]

async function main(): Promise<void> {
  const pdfPath = process.argv[2]
  if (!pdfPath)
    throw new Error('Usage: engagement-doc-receipts.ts <pdfPath> [tenant] [actor] [contact]')
  const ctx = { tenantId: TENANT, actorId: ACTOR }

  const { text, pageCount } = await extractPdfText(readFileSync(pdfPath))
  console.log(`R1 parsed: ${pageCount} pages, ${text.length} chars`)

  const imported = await importEngagementAgreement(ctx, {
    markdown: text,
    sourceFilename: pdfPath.split('/').pop(),
  })
  console.log(
    `R2 imported: template=${imported.templateId} v${imported.version} details=${JSON.stringify(imported.details)}`,
  )
  console.log(`R2 body head:\n${imported.body.slice(0, 600)}\n…`)

  if (CONTACT) {
    const merged = await getClientEngagementAgreement(ctx, CONTACT)
    if (!merged) throw new Error('R3 FAILED: no merged agreement for contact')
    console.log(
      `R3 merged for ${CONTACT}: missing=[${merged.missingFields.join(',')}] sign-marker=${merged.markdown.includes('{{sign:client}}')}`,
    )
    console.log(`R3 merged head:\n${merged.markdown.slice(0, 600)}\n…`)
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
