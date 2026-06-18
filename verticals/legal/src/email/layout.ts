// Email-safe HTML shell + reusable content blocks.
//
// Constraints baked in (why this looks like 2005 HTML): email clients have no
// flexbox/grid, strip <style> in some contexts (Gmail), and Outlook renders via
// Word's engine. So: table-based layout, inline styles, a 600px frame, MSO
// conditional comments for Outlook button/spacing, and a hidden preheader for
// the inbox preview line. Everything composes from string-returning helpers.

import { COLORS, FONTS, FIRM, esc } from './brand.js'

export interface ShellInput {
  /** Inbox preview line (hidden in the body). */
  preheader: string
  /** Big serif heading at the top of the card. */
  heading: string
  /** Pre-rendered body HTML (compose with the block helpers below). */
  body: string
  /** Audience tint: client mail gets the warm gold rule; attorney mail navy. */
  audience?: 'client' | 'attorney'
}

// ── Content blocks ──────────────────────────────────────────────────────────

/** A body paragraph. Pass raw HTML (already escaped by the caller where needed). */
export function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONTS.sans};font-size:16px;line-height:1.6;color:${COLORS.fg};">${html}</p>`
}

/** Smaller, muted helper text (fine print, "if you didn't request this…"). */
export function finePrint(html: string): string {
  return `<p style="margin:16px 0 0;font-family:${FONTS.sans};font-size:13px;line-height:1.5;color:${COLORS.muted};">${html}</p>`
}

/** A labeled key/value detail block (appointment time, matter number, etc.). */
export function detailRows(rows: Array<{ label: string; value: string }>): string {
  const trs = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:8px 16px 8px 0;font-family:${FONTS.sans};font-size:13px;color:${COLORS.muted};text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;vertical-align:top;">${esc(r.label)}</td>
        <td style="padding:8px 0;font-family:${FONTS.sans};font-size:15px;color:${COLORS.fg};font-weight:600;vertical-align:top;">${r.value}</td>
      </tr>`,
    )
    .join('')
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
    style="margin:8px 0 20px;border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};">
    ${trs}
  </table>`
}

/** A bulletproof CTA button (degrades to a square button in Outlook). */
export function button(label: string, href: string, tone: 'navy' | 'gold' = 'navy'): string {
  const bg = tone === 'gold' ? COLORS.gold : COLORS.navy
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px;">
    <tr>
      <td align="center" bgcolor="${bg}" style="border-radius:8px;">
        <a href="${href}" target="_blank"
          style="display:inline-block;padding:14px 28px;font-family:${FONTS.sans};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">
          ${esc(label)}
        </a>
      </td>
    </tr>
  </table>`
}

/** A tinted callout box (e.g. an invoice total, or a "needs signature" notice). */
export function callout(html: string, tone: 'navy' | 'gold' | 'ok' = 'navy'): string {
  const map = {
    navy: { bg: COLORS.navy50, br: COLORS.navy100, fg: COLORS.navy700 },
    gold: { bg: COLORS.gold100, br: COLORS.gold400, fg: COLORS.gold },
    ok: { bg: COLORS.okSoft, br: COLORS.ok, fg: COLORS.ok },
  }[tone]
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;">
    <tr><td style="padding:16px 18px;background:${map.bg};border:1px solid ${map.br};border-radius:8px;
      font-family:${FONTS.sans};font-size:15px;line-height:1.55;color:${map.fg};">${html}</td></tr>
  </table>`
}

/** Closing signature block. */
export function signoff(): string {
  return paragraph(
    `Warm regards,<br><strong style="color:${COLORS.navy700};">${esc(FIRM.attorney)}</strong><br>` +
      `<span style="color:${COLORS.muted};font-size:14px;">${esc(FIRM.name)}</span>`,
  )
}

// ── The shell ───────────────────────────────────────────────────────────────

export function renderShell(input: ShellInput): string {
  const ruleColor = input.audience === 'attorney' ? COLORS.navy : COLORS.gold
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="en" xmlns="https://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>${esc(input.heading)}</title>
  <!--[if mso]><style>td,a,span{font-family:Arial,Helvetica,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${esc(input.preheader)}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLORS.bg};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;">

          <!-- Header band -->
          <tr>
            <td style="background:${COLORS.navy900};border-radius:12px 12px 0 0;padding:26px 32px;">
              <span style="font-family:${FONTS.serif};font-size:22px;font-weight:700;color:#ffffff;letter-spacing:.01em;">
                ${esc(FIRM.shortName)}
              </span>
              <span style="font-family:${FONTS.serif};font-size:22px;font-weight:700;color:${COLORS.gold400};">.</span>
              <div style="font-family:${FONTS.sans};font-size:12px;color:#9fb3d9;letter-spacing:.14em;text-transform:uppercase;margin-top:4px;">
                ${esc(FIRM.product)}
              </div>
            </td>
          </tr>

          <!-- Gold/navy accent rule -->
          <tr><td style="height:4px;background:${ruleColor};font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- Body card -->
          <tr>
            <td style="background:${COLORS.surface};padding:32px;">
              <h1 style="margin:0 0 20px;font-family:${FONTS.serif};font-size:24px;line-height:1.25;color:${COLORS.navy900};font-weight:700;">
                ${esc(input.heading)}
              </h1>
              ${input.body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:${COLORS.surface};border-radius:0 0 12px 12px;border-top:1px solid ${COLORS.border};padding:24px 32px;">
              <p style="margin:0 0 6px;font-family:${FONTS.sans};font-size:13px;line-height:1.5;color:${COLORS.fg};font-weight:600;">${esc(FIRM.name)}</p>
              <p style="margin:0;font-family:${FONTS.sans};font-size:12px;line-height:1.5;color:${COLORS.muted};">
                ${esc(FIRM.addressLine)}<br>${esc(FIRM.cityLine)}
              </p>
              <p style="margin:14px 0 0;font-family:${FONTS.sans};font-size:11px;line-height:1.5;color:${COLORS.muted};">
                This message may contain confidential or attorney&ndash;client privileged information intended only for the
                named recipient. If you received it in error, please delete it and notify our office.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
