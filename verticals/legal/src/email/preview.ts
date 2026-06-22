// Render every template with realistic sample data into ./previews/*.html plus a
// gallery index.html, so the designs can be eyeballed in a browser with zero
// runtime wiring. Run:  npx tsx verticals/legal/email-templates/preview.ts
//
// Sample data doubles as the documented variable CONTRACT for each template —
// whatever a builder reads here is what the live route must supply.

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildEmail } from './templates.js'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'previews')

const SAMPLES: Record<string, Record<string, unknown>> = {
  'prospect-booking-confirmation': {
    client_first_name: 'Marcus',
    service_label: 'New LLC formation',
    scheduled_at_label: 'Thursday, June 25, 2026 at 2:00 PM EDT',
    reschedule_url: 'https://app.pacheco.law/book/manage/abc123',
    cancel_url: 'https://app.pacheco.law/book/manage/abc123?intent=cancel',
    account_url: 'https://app.pacheco.law/portal/login?email=marcus%40holloway.co',
    video_url: 'https://meet.google.com/abc-defg-hij',
  },
  'appointment-reminder': {
    client_first_name: 'Marcus',
    scheduled_at_label: 'tomorrow, June 25 at 2:00 PM EDT',
    relative_when: 'is tomorrow',
    join_url: 'https://meet.google.com/abc-defg-hij',
    reschedule_url: 'https://app.pacheco.law/book/reschedule/abc123',
  },
  'prospect-intake-confirmation': { client_first_name: 'Priya' },
  'client-document-ready': {
    client_first_name: 'Marcus',
    document_label: 'Operating Agreement',
    matter_number: 'PLF-2026-0042',
    needs_signature: true,
    sign_url: 'https://app.pacheco.law/portal/sign/xyz789',
  },
  'client-invoice': {
    client_first_name: 'Priya',
    invoice_number: 'INV-2026-0017',
    matter_number: 'PLF-2026-0042',
    amount_due: '1850.00',
    due_date_label: 'July 5, 2026',
    pay_url: 'https://app.pacheco.law/portal/pay/inv0017',
    line_items: [
      { label: 'NC LLC formation — flat fee', amount: '1500.00' },
      { label: 'State filing fee (reimbursable)', amount: '125.00' },
      { label: 'Registered agent (first year)', amount: '225.00' },
    ],
  },
  'client-portal-magic-link': {
    client_full_name: 'Marcus Holloway',
    login_url: 'https://app.pacheco.law/portal/login?token=secure-token-here',
  },
  'client-portal-message': {
    matter_number: 'PLF-2026-0042',
    portal_url: 'https://app.pacheco.law/portal/matters/0042',
  },
  'attorney-draft-completed': {
    document_kind_label: 'Operating Agreement',
    matter_number: 'PLF-2026-0042',
    confidence: 'High',
    review_url: 'https://app.pacheco.law/attorney/review/v123',
  },
  'attorney-manual-matter': {
    client_full_name: 'Dana Whitfield',
    client_email: 'dana@whitfield.co',
    client_phone: '+1 828 555 0142',
    service_label: 'Other (manual review)',
    scheduled_at: 'June 27, 2026 at 10:00 AM',
    matter_url: 'https://app.pacheco.law/attorney/matters/0051',
  },
  'attorney-portal-message': {
    matter_number: 'PLF-2026-0042',
    matter_url: 'https://app.pacheco.law/attorney/matters/0042',
  },
}

mkdirSync(outDir, { recursive: true })

const links: string[] = []
for (const [ref, vars] of Object.entries(SAMPLES)) {
  const email = buildEmail(ref, vars)
  if (!email) {
    console.warn(`No builder for ${ref}`)
    continue
  }
  writeFileSync(join(outDir, `${ref}.html`), email.html, 'utf-8')
  links.push(
    `<li><a href="./${ref}.html">${ref}</a> <span style="color:#64748b">— ${email.subject.replace(/</g, '&lt;')}</span></li>`,
  )
  console.log(`✓ ${ref}.html`)
}

const gallery = `<!doctype html><meta charset="utf-8"><title>Pacheco Law — email previews</title>
<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#0f172a">
<h1 style="font-family:Georgia,serif">Pacheco Law — transactional email previews</h1>
<p style="color:#475569">Open each in a browser to review the branded HTML. These are design previews only — not yet wired to the live send path (see README.md).</p>
<ul style="line-height:2">${links.join('')}</ul>
</body>`
writeFileSync(join(outDir, 'index.html'), gallery, 'utf-8')
console.log(`\nGallery: ${join(outDir, 'index.html')}`)
