// Server-side markdown → PDF renderer for emailing a generated legal draft as a
// PDF attachment. No headless browser is available in Netlify functions, so the
// draft is rendered with @react-pdf/renderer. This is a PURE unit test (no DB, no
// model, no network): it feeds a representative markdown sample through
// renderDraftPdf and asserts real PDF bytes come back. Always runs — no skipIf.
import { describe, it, expect } from 'vitest'
import { renderDraftPdf } from '@exsto/legal'

const SAMPLE = `# Engagement Letter

This agreement is **binding** and _effective_ on signing. Refer to the \`fee_schedule\` for rates.

Covered services:

- Initial consultation
- Document drafting
- Filing review

Process:

1. Sign this letter
2. Pay the retainer
3. Begin work

> Note: this is not legal advice until executed.

---

The firm thanks you for your business.
`

describe('renderDraftPdf (markdown → PDF, no DB)', () => {
  it('renders a representative draft to real PDF bytes', async () => {
    const buf = await renderDraftPdf(SAMPLE, { title: 'Draft for Review' })

    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
    // PDF magic number — proves these are genuine PDF bytes, not an empty buffer.
    expect(buf.subarray(0, 4).toString()).toBe('%PDF')
  })

  it('renders without a title and still produces a valid PDF', async () => {
    const buf = await renderDraftPdf('# Heading only\n\nA short paragraph.')

    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
    expect(buf.subarray(0, 4).toString()).toBe('%PDF')
  })
})
