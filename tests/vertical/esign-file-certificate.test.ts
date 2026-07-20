// 0170 — file-envelope executed certificate (pure, no DB). The executed version
// for an uploaded-PDF envelope is the signature certificate itself; it must bind
// every signer's adoption to the exact file bytes (SHA-256 recorded at upload)
// and to the envelope, and degrade gracefully when optional facts are absent.
import { describe, expect, it } from 'vitest'
import { buildFileCertificateMarkdown } from '../../verticals/legal/src/esign/fileCertificate.js'

const SHA = 'a'.repeat(64)

describe('buildFileCertificateMarkdown', () => {
  it('binds signers, file identity, hash, and envelope id', () => {
    const md = buildFileCertificateMarkdown({
      envelopeId: 'env-1',
      filename: 'lease-agreement.pdf',
      contentType: 'application/pdf',
      sizeBytes: 12345,
      sha256Hex: SHA,
      signers: [
        {
          name: 'Ana López',
          email: 'ana@example.com',
          title: 'Member',
          signed_at: '2026-07-19T10:00:00Z',
          consent: 'I agree to sign electronically',
        },
        {
          name: null,
          email: 'bo@example.com',
          title: null,
          signed_at: '2026-07-19T11:00:00Z',
          consent: 'I agree to sign electronically',
        },
      ],
    })
    expect(md).toContain('## Signature Certificate')
    expect(md).toContain('lease-agreement.pdf')
    expect(md).toContain('application/pdf, 12345 bytes')
    expect(md).toContain('**Ana López**, Member (ana@example.com)')
    // A signer with no name falls back to their email as the display name.
    expect(md).toContain('**bo@example.com**')
    expect(md).toContain(`**Original file SHA-256:** \`${SHA}\``)
    expect(md).toContain('**Envelope:** `env-1`')
  })

  it('degrades to placeholders when optional facts are missing', () => {
    const md = buildFileCertificateMarkdown({
      envelopeId: 'env-2',
      filename: null,
      contentType: null,
      sizeBytes: null,
      sha256Hex: null,
      signers: [{ name: null, email: null, title: null, signed_at: null, consent: null }],
    })
    expect(md).toContain('uploaded document')
    expect(md).toContain('**Original file SHA-256:** `—`')
    expect(md).toContain('**Signer**')
    // Size omitted entirely (no "null bytes").
    expect(md).not.toContain('null')
  })
})
