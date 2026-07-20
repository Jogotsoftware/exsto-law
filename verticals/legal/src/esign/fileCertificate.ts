// 0170 — the executed artifact for an uploaded-FILE envelope. A stored PDF has
// no inline {{type:key}} tags and no field-stamping path, so the executed
// version IS the signature certificate: markdown binding each signer's adoption
// (name, title, consent, timestamp) to the exact file bytes via the SHA-256
// recorded at upload. The file itself is untouched — tamper-evidence is the
// hash, the same doctrine as the markdown path's original-content SHA-256.
// Pure (no DB): unit-tested in tests/vertical/esign-file-certificate.test.ts.

export interface FileCertSigner {
  name: string | null
  email: string | null
  title: string | null
  signed_at: string | null
  consent: string | null
}

export interface FileCertInput {
  envelopeId: string
  filename: string | null
  contentType: string | null
  sizeBytes: number | null
  sha256Hex: string | null
  signers: FileCertSigner[]
}

export function buildFileCertificateMarkdown(input: FileCertInput): string {
  const fileLine = `**Document:** ${input.filename ?? 'uploaded document'} (${
    input.contentType ?? 'file'
  }${input.sizeBytes ? `, ${input.sizeBytes} bytes` : ''})`
  return [
    '## Signature Certificate',
    '',
    'This document was executed electronically via Pacheco Law. Each signer below',
    'reviewed the document and adopted their signature with intent to sign.',
    '',
    fileLine,
    '',
    ...input.signers.map(
      (sgn) =>
        `- **${sgn.name ?? sgn.email ?? 'Signer'}**${sgn.title ? `, ${sgn.title}` : ''} (${
          sgn.email ?? '—'
        }) — signed ${sgn.signed_at ?? '—'}\n  Consent: "${sgn.consent ?? '—'}"`,
    ),
    '',
    `**Original file SHA-256:** \`${input.sha256Hex ?? '—'}\``,
    `**Envelope:** \`${input.envelopeId}\``,
    '',
  ].join('\n')
}
