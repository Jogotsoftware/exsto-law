// Send-to-client modal backend seams (li/send-to-client-modal): the pure
// composition of the draft-link email (default vs attorney-composed) and the
// firm-staff-only Cc policy. Pure — no DB; the tenant-scoped actor query is a
// thin wrapper around validateFirmCc, which is what carries the policy.
import { describe, it, expect } from 'vitest'
import { composeDraftLinkEmail, parseCcList, validateFirmCc } from '@exsto/legal'

const URL = 'https://firm.example/d/abc?t=tok123'

describe('composeDraftLinkEmail', () => {
  it('default composition (no subject/message) is unchanged — back-compat', () => {
    const { subject, body } = composeDraftLinkEmail({
      docTitle: 'attorney letter',
      matterNumber: 'M-MRJHEC8X',
      clientName: 'Juan Carlos Pacheco',
      tokenizedUrl: URL,
    })
    expect(subject).toBe('Your draft attorney letter — M-MRJHEC8X')
    expect(body).toBe(
      [
        'Hi Juan,',
        '',
        'Your draft attorney letter is ready for review:',
        '',
        URL,
        '',
        'You can view it in your browser and download a PDF or Word copy from the page.',
        '',
        'Take a look at your convenience and let me know if you have questions.',
      ].join('\r\n'),
    )
  })

  it('default composition falls back to a bare greeting with no client name', () => {
    const { body } = composeDraftLinkEmail({
      docTitle: 'will',
      matterNumber: 'M-1',
      clientName: null,
      tokenizedUrl: URL,
    })
    expect(body.startsWith('Hi,\r\n')).toBe(true)
  })

  it('uses attorney subject/message verbatim and ALWAYS appends the secure link block', () => {
    const message =
      'Dear Juan Carlos Pacheco,\n\nPlease find attached the attorney letter prepared for your matter (M-MRJHEC8X). Let me know if you have any questions.\n\nBest regards,'
    const { subject, body } = composeDraftLinkEmail({
      docTitle: 'attorney letter',
      matterNumber: 'M-MRJHEC8X',
      clientName: 'Juan Carlos Pacheco',
      tokenizedUrl: URL,
      subject: 'Attorney letter — M-MRJHEC8X',
      message,
      format: 'pdf',
    })
    expect(subject).toBe('Attorney letter — M-MRJHEC8X')
    expect(body.startsWith('Dear Juan Carlos Pacheco,')).toBe(true)
    expect(body).toContain('Your attorney letter (PDF) is ready to view and download securely:')
    expect(body.trimEnd().endsWith(URL)).toBe(true)
  })

  it('labels the link block Word when format is word', () => {
    const { body } = composeDraftLinkEmail({
      docTitle: 'attorney letter',
      matterNumber: 'M-1',
      clientName: 'Juan',
      tokenizedUrl: `${URL}&fmt=word`,
      message: 'Dear Juan,\n\nSee attached.\n\nBest regards,',
      format: 'word',
    })
    expect(body).toContain('Your attorney letter (Word) is ready to view and download securely:')
    expect(body).toContain('&fmt=word')
  })

  it('keeps the default subject when only a message is supplied', () => {
    const { subject } = composeDraftLinkEmail({
      docTitle: 'will',
      matterNumber: 'M-2',
      clientName: 'Ana',
      tokenizedUrl: URL,
      message: 'Dear Ana,\n\nAttached.\n\nBest regards,',
    })
    expect(subject).toBe('Your draft will — M-2')
  })
})

describe('firm-staff-only Cc', () => {
  const firm = new Set(['juan@pacheco.law', 'paralegal@pacheco.law'])

  it('parses comma-separated lists, trimming and dropping empties', () => {
    expect(parseCcList(' a@b.co ,  c@d.co ,, ')).toEqual(['a@b.co', 'c@d.co'])
    expect(parseCcList(undefined)).toEqual([])
    expect(parseCcList('')).toEqual([])
  })

  it('accepts firm users, case-insensitively', () => {
    expect(validateFirmCc('Juan@Pacheco.law, paralegal@pacheco.law', firm)).toEqual([
      'Juan@Pacheco.law',
      'paralegal@pacheco.law',
    ])
  })

  it('rejects any non-firm address with the user-facing policy error', () => {
    expect(() => validateFirmCc('juan@pacheco.law, client@gmail.com', firm)).toThrow(
      "Cc is limited to your firm's users (co-counsel or paralegal).",
    )
  })

  it('empty Cc validates to an empty list', () => {
    expect(validateFirmCc(undefined, firm)).toEqual([])
    expect(validateFirmCc('  ', firm)).toEqual([])
  })
})
