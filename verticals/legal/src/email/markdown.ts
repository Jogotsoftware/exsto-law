import { marked } from 'marked'
import { COLORS, FIRM, esc } from './brand.js'
import { button } from './layout.js'

// PORTAL-1 (WP6) — render, don't leak markdown. Every outgoing client email
// whose caller supplies no HTML part gets its (markdown) body rendered to a
// light branded HTML alternative here, at the SEND PATH (enqueueClientEmail),
// so every producer — approved AI drafts, template merges, ad-hoc sends —
// inherits it. The plaintext part still carries the original body (markdown is
// a readable plaintext convention); the HTML part is what mail clients show.
//
// marked is configured conservatively: no raw-HTML passthrough (the body may
// contain client-provided strings), GFM line breaks so single newlines render
// as they read in plaintext.

const PORTAL_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exstolaw.netlify.app'
).replace(/\/$/, '')

function escapeRawHtml(md: string): string {
  // The drafters emit markdown, not HTML; anything angle-bracketed in the body
  // is client/matter data, not markup — neutralize it before parsing.
  return md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface RenderedMarkdownEmail {
  html: string
}

// Render an email body (markdown) to a self-contained HTML document with the
// firm's light shell and — because every Contract B send goes to a client — a
// portal CTA button (deep-linked to the matter when known). The '-- ' signature
// delimiter and everything after it is left to withSignature (called after us).
export function renderMarkdownEmailHtml(
  bodyMarkdown: string,
  opts: { portalCta?: { label: string; url: string } | null } = {},
): RenderedMarkdownEmail {
  const parsed = marked.parse(escapeRawHtml(bodyMarkdown), {
    async: false,
    gfm: true,
    breaks: true,
  }) as string

  const cta =
    opts.portalCta === null
      ? ''
      : button(
          opts.portalCta?.label ?? 'Open your client portal',
          opts.portalCta?.url ?? `${PORTAL_URL}/portal`,
        )

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f7f9;">
    <div style="max-width:600px;margin:0 auto;padding:24px 20px;font-family:Georgia, 'Times New Roman', serif;color:#1d2733;font-size:16px;line-height:1.55;background:#ffffff;">
      ${parsed}
      ${cta}
      <p style="color:#8a93a0;font-size:12px;margin-top:28px;">${esc(FIRM.name)} · this message was sent to you as a client of the firm.</p>
    </div>
  </body>
</html>`
  return { html }
}

export { COLORS }
