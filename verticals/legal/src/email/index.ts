// Public entry for the branded email kit.
//
// renderEmailHtml() is the single function the live notification engine will call
// once the comms session's plumbing lands (see README "Wiring handoff"). It is a
// pure function of (templateRef, variables) — no DB, no network, no side effects —
// so it is safe to call from the worker's deliverNotification() path.

import { buildEmail, listTemplateRefs, type BuiltEmail } from './templates.js'

export interface RenderedEmail {
  subject: string
  /** Full HTML document (for the text/html MIME part). */
  html: string
  /** Plaintext fallback (for the text/plain part of multipart/alternative). */
  text: string
}

export function renderEmailHtml(
  templateRef: string,
  variables: Record<string, unknown>,
): RenderedEmail | null {
  const built: BuiltEmail | null = buildEmail(templateRef, variables)
  if (!built) return null
  return { subject: built.subject, html: built.html, text: built.text }
}

export { listTemplateRefs }
export { FIRM, COLORS } from './brand.js'
