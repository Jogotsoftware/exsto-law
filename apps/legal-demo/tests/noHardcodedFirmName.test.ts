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

describe('client-facing pages never hardcode the firm name "Pacheco"', () => {
  for (const rel of CLIENT_FACING_PAGES) {
    it(`${rel} contains no "Pacheco" literal`, () => {
      const src = readFileSync(new URL(rel, import.meta.url), 'utf8')
      expect(src).not.toMatch(/Pacheco/i)
    })
  }
})
