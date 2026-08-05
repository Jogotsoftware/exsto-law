// FB-C — de-Pacheco the app shell. Every client-facing (public/unauthenticated
// or pre-auth) surface used to hardcode "Pacheco Law" as the firm's identity,
// which is wrong the moment a second tenant exists. This is a source-text
// guard, not a render test: it fails loudly the moment anyone reintroduces the
// literal on one of these pages, without needing a live DB/multi-tenant setup.
// (Seeded/demo DATA that happens to say "Pacheco" is fine — see
// lib/demoUserAttorney.ts and lib/auth.ts, both dev-only fixtures inert in
// production; this test only reads the pages listed below.)
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const CLIENT_FACING_PAGES = [
  '../app/layout.tsx',
  '../app/page.tsx',
  '../app/portal/login/page.tsx',
  '../app/portal/set-password/page.tsx',
  '../app/portal/forgot-password/page.tsx',
  '../app/portal/reset-password/page.tsx',
  '../app/portal/pay/[invoice]/page.tsx',
  '../app/book/manage/[token]/page.tsx',
  '../components/SignDocument.tsx',
  '../app/d/[versionId]/page.tsx',
  '../app/api/auth/google/callback/route.ts',
]

// SECOND-FIRM-1 — the vertical files de-Pacheco'd in the second-firm hardening
// pass: outbound-mail sender identity, calendar event branding, the e-sign
// certificate, the in-app assistant prompt, notification templates, and the
// (neutralized) tenant-settings defaults. Same source-text guard: these must
// resolve firm identity per tenant, never reintroduce a firm literal.
const CLEANED_VERTICAL_FILES = [
  '../../../verticals/legal/src/adapters/gmail.ts',
  '../../../verticals/legal/src/api/google.ts',
  '../../../verticals/legal/src/esign/fileCertificate.ts',
  '../../../verticals/legal/src/api/assistant.ts',
  '../../../verticals/legal/src/api/notificationTemplates.ts',
  '../../../verticals/legal/src/api/tenantSettings.ts',
  '../../../verticals/legal/src/api/publicBooking.ts',
  '../../../verticals/legal/src/api/bookingManage.ts',
  '../../../verticals/legal/src/api/esign.ts',
  '../../../verticals/legal/src/api/granolaIngestion.ts',
  '../../../verticals/legal/src/lib/firmDisplayName.ts',
]

describe('client-facing pages never hardcode the firm name "Pacheco"', () => {
  for (const rel of [...CLIENT_FACING_PAGES, ...CLEANED_VERTICAL_FILES]) {
    it(`${rel} contains no "Pacheco" literal`, () => {
      const src = readFileSync(new URL(rel, import.meta.url), 'utf8')
      expect(src).not.toMatch(/Pacheco/i)
    })
  }
})
