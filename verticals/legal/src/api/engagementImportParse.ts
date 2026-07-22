// ENGAGEMENT-DOC-1 — PURE parse seam for the letter→template AI output.
// Leaf module (no adapter imports) so unit tests and client code can use it
// without dragging the Anthropic adapter chain into the bundle.

export interface EngagementAgreementDetails {
  hourly_rate?: string
  litigation_rate?: string
  retainer?: string
  attorney_name?: string
  /** The client signature block's label from the letter ("Managing Member", …). */
  signer_label?: string
}

export const DETAILS_DELIM = '===DETAILS==='

export function parseImportOutput(raw: string): {
  body: string
  details: EngagementAgreementDetails
} {
  const at = raw.lastIndexOf(DETAILS_DELIM)
  if (at === -1) return { body: raw.trim(), details: {} }
  const body = raw.slice(0, at).trim()
  const tail = raw.slice(at + DETAILS_DELIM.length).trim()
  let details: EngagementAgreementDetails = {}
  try {
    const parsed = JSON.parse(tail.split('\n')[0] || tail) as Record<string, unknown>
    const s = (k: string): string | undefined =>
      typeof parsed[k] === 'string' && (parsed[k] as string).trim()
        ? (parsed[k] as string).trim()
        : undefined
    details = {
      hourly_rate: s('hourly_rate'),
      litigation_rate: s('litigation_rate'),
      retainer: s('retainer'),
      attorney_name: s('attorney_name'),
      signer_label: s('signer_label'),
    }
  } catch {
    // Details are a convenience summary — a malformed tail never fails the import.
  }
  if (!body) throw new Error('The letter converted to an empty template body.')
  return { body, details }
}
