// SLUG-PROV-1 — the shared firm-slug definition (verticals/legal/src/lib/publicSlug.ts).
// Pure unit tests (no DB): the regex, the reserved-label set, and normalization.
// The SQL twin (migration 0197_cp_set_tenant_slug.sql) re-encodes the same rules;
// these tests are the executable spec both sides must match.
import { describe, it, expect } from 'vitest'
import { PUBLIC_SLUG_RE, RESERVED_SLUGS, validatePublicSlug } from '@exsto/legal/slug'

describe('PUBLIC_SLUG_RE', () => {
  it('accepts ordinary firm labels', () => {
    for (const s of ['pacheco', 'liberty-legal', 'a', 'firm2', '9lives', 'a-b-c']) {
      expect(PUBLIC_SLUG_RE.test(s), s).toBe(true)
    }
  })
  it('rejects malformed labels', () => {
    for (const s of ['-pacheco', 'pacheco-', 'Pa checo', 'PACHECO', 'a.b', '', 'é-firm']) {
      expect(PUBLIC_SLUG_RE.test(s), s).toBe(false)
    }
  })
  it('enforces the 63-char DNS label cap', () => {
    expect(PUBLIC_SLUG_RE.test('a'.repeat(63))).toBe(true)
    expect(PUBLIC_SLUG_RE.test('a'.repeat(64))).toBe(false)
  })
})

describe('validatePublicSlug', () => {
  it('normalizes case and whitespace', () => {
    expect(validatePublicSlug('  Pacheco ')).toEqual({ ok: true, slug: 'pacheco' })
  })
  it('rejects every reserved label, including the canonical app host', () => {
    for (const s of RESERVED_SLUGS) {
      expect(validatePublicSlug(s).ok, s).toBe(false)
    }
    expect(RESERVED_SLUGS.has('app')).toBe(true)
    expect(RESERVED_SLUGS.has('www')).toBe(true)
  })
  it('rejects empties and over-long labels with a message', () => {
    expect(validatePublicSlug('')).toMatchObject({ ok: false })
    expect(validatePublicSlug('a'.repeat(64))).toMatchObject({ ok: false })
    expect(validatePublicSlug('-nope')).toMatchObject({ ok: false })
  })
})
