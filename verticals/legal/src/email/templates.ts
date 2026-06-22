// Per-notification email builders.
//
// Each builder takes the same `variables` bag the live notification engine
// already passes to renderNotificationTemplate() and returns a branded HTML
// body PLUS a plaintext fallback (for multipart/alternative — never ship HTML
// without a text part). The `ref` keys MATCH the existing template_ref keys in
// verticals/legal/src/api/notificationTemplates.ts so this is a drop-in upgrade,
// and add a few NEW client-facing types Joe asked for (document ready, invoice,
// appointment reminder) whose ROUTES are owned by other sessions (see README).

import { COLORS, FONTS, FIRM, esc, val } from './brand.js'
import {
  renderShell,
  paragraph,
  finePrint,
  detailRows,
  button,
  callout,
  sectionLabel,
  mutedLink,
  signoff,
} from './layout.js'

export interface BuiltEmail {
  subject: string
  preheader: string
  html: string
  text: string
}

type Vars = Record<string, unknown>

// Greeting that prefers first name, then full name, then a neutral fallback.
const hi = (v: Vars): string =>
  `Hi ${esc(val(v.client_first_name, val(v.client_full_name, 'there')))},`

// Format a decimal-string amount for display WITHOUT float math (ADR 0043/0044:
// money is a decimal string end-to-end). Adds thousands separators via string ops.
function money(amount: unknown): string {
  const raw = val(amount, '0').trim().replace(/^\$/, '')
  const [intPart, frac] = raw.split('.')
  const grouped = (intPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `$${grouped}.${(frac ?? '').padEnd(2, '0').slice(0, 2)}`
}

const BASE_FALLBACK = `\n\n— ${FIRM.name}`

// ── Builders, keyed by template_ref ──────────────────────────────────────────

const BUILDERS: Record<string, (v: Vars) => BuiltEmail> = {
  // CLIENT — consultation booked (the appointment confirmation Joe named).
  'prospect-booking-confirmation': (v) => {
    const when = val(v.scheduled_at_label, val(v.scheduled_at, 'the selected time'))
    const rows = [{ label: 'When', value: esc(when) }]
    if (v.service_label) rows.push({ label: 'Service', value: esc(val(v.service_label)) })
    if (v.location || v.video_url) {
      rows.push({
        label: v.video_url ? 'Video link' : 'Location',
        value: v.video_url
          ? `<a href="${val(v.video_url)}" style="color:${COLORS.navy};">Join the consultation</a>`
          : esc(val(v.location)),
      })
    }

    // "Manage your appointment": Reschedule is the primary action; Cancel is a
    // present-but-quiet secondary link (a destructive action shouldn't shout).
    // Both links are token-gated (one /book/manage page). When no manage URL is
    // available (e.g. base URL unset), degrade to the calendar-invite hint.
    const manageBlock = v.reschedule_url
      ? sectionLabel('Manage your appointment') +
        paragraph(
          'Need to make a change? You can reschedule or cancel any time before your consultation.',
        ) +
        button('Reschedule', val(v.reschedule_url), 'gold') +
        (v.cancel_url ? mutedLink('Cancel this consultation instead', val(v.cancel_url)) : '')
      : finePrint('Need to change it? Use the reschedule link in the calendar invitation.')

    // "Create your account": opens the portal sign-in pre-filled with the email
    // they booked with, one click from a magic link. Omitted if no portal URL.
    const accountBlock = v.account_url
      ? sectionLabel('Your client portal') +
        paragraph(
          'Create your account to message your attorney, follow your matter, and view documents — all in one secure place.',
        ) +
        button('Create your account', val(v.account_url), 'navy')
      : ''

    return {
      subject: 'Your consultation is booked — Pacheco Law',
      preheader: `Confirmed for ${when} with ${FIRM.attorney}.`,
      html: renderShell({
        audience: 'client',
        preheader: `Confirmed for ${when}.`,
        heading: 'Your consultation is confirmed',
        body:
          paragraph(hi(v)) +
          paragraph(
            `Your consultation with <strong>${esc(FIRM.attorney)}</strong> is confirmed. A calendar invitation is on its way to your inbox.`,
          ) +
          detailRows(rows) +
          manageBlock +
          accountBlock +
          signoff(),
      }),
      text:
        `${val(v.client_first_name, 'Hi')},\n\nYour consultation with ${FIRM.attorney} is confirmed for ${when}. ` +
        `A calendar invitation is on its way to your inbox.` +
        (v.reschedule_url ? `\n\nReschedule or cancel: ${val(v.reschedule_url)}` : '') +
        (v.account_url ? `\n\nCreate your client portal account: ${val(v.account_url)}` : '') +
        BASE_FALLBACK,
    }
  },

  // CLIENT — appointment reminder (NEW companion to the confirmation).
  'appointment-reminder': (v) => {
    const when = val(v.scheduled_at_label, 'your upcoming consultation')
    return {
      subject: `Reminder: your consultation ${val(v.relative_when, 'is coming up')}`,
      preheader: `${when} with ${FIRM.attorney}.`,
      html: renderShell({
        audience: 'client',
        preheader: `${when} with ${FIRM.attorney}.`,
        heading: 'A quick reminder',
        body:
          paragraph(hi(v)) +
          paragraph(
            `This is a friendly reminder of your consultation with <strong>${esc(FIRM.attorney)}</strong>.`,
          ) +
          detailRows([{ label: 'When', value: esc(when) }]) +
          (v.join_url ? button('Join the consultation', val(v.join_url)) : '') +
          (v.reschedule_url
            ? finePrint(
                `Can't make it? <a href="${val(v.reschedule_url)}" style="color:${COLORS.navy};">Reschedule here</a>.`,
              )
            : '') +
          signoff(),
      }),
      text: `${val(v.client_first_name, 'Hi')},\n\nReminder: your consultation with ${FIRM.attorney} — ${when}.${BASE_FALLBACK}`,
    }
  },

  // CLIENT — intake received.
  'prospect-intake-confirmation': (v) => ({
    subject: 'We received your information — Pacheco Law',
    preheader: `Thanks — ${FIRM.attorney} will review before your consultation.`,
    html: renderShell({
      audience: 'client',
      preheader: `${FIRM.attorney} will review before your consultation.`,
      heading: 'Thanks — we have your information',
      body:
        paragraph(hi(v)) +
        paragraph(
          `Thanks for telling us about your matter. <strong>${esc(FIRM.attorney)}</strong> will review your answers before your consultation so your time together is focused and productive.`,
        ) +
        signoff(),
    }),
    text: `${val(v.client_first_name, 'Hi')},\n\nThanks for telling us about your matter. ${FIRM.attorney} will review your answers before your consultation.${BASE_FALLBACK}`,
  }),

  // CLIENT — document ready (NEW: "documents being complete"). Branches on
  // whether a signature is needed (e-sign hand-off lives with S5).
  'client-document-ready': (v) => {
    const docLabel = val(v.document_label, val(v.document_kind, 'your document'))
    const needsSig = v.needs_signature === true || v.needs_signature === 'true'
    const ctaUrl = val(v.sign_url, val(v.review_url, '#'))
    return {
      subject: needsSig
        ? `Ready for your signature — ${docLabel}`
        : `Your document is ready — ${docLabel}`,
      preheader: needsSig ? `${docLabel} is ready to sign.` : `${docLabel} is ready to review.`,
      html: renderShell({
        audience: 'client',
        preheader: needsSig ? `${docLabel} is ready to sign.` : `${docLabel} is ready to review.`,
        heading: needsSig ? 'Ready for your signature' : 'Your document is ready',
        body:
          paragraph(hi(v)) +
          paragraph(
            `<strong>${esc(FIRM.attorney)}</strong> has finished preparing <strong>${esc(docLabel)}</strong>${
              v.matter_number
                ? ` for your matter <strong>${esc(val(v.matter_number))}</strong>`
                : ''
            }.`,
          ) +
          (needsSig
            ? callout(
                'Please review the document carefully, then add your signature where indicated.',
                'gold',
              )
            : '') +
          button(
            needsSig ? 'Review & sign' : 'Review your document',
            ctaUrl,
            needsSig ? 'gold' : 'navy',
          ) +
          finePrint(
            'This link opens your secure client portal. If a prompt asks you to sign in, use the email address on file.',
          ) +
          signoff(),
      }),
      text:
        `${val(v.client_first_name, 'Hi')},\n\n${FIRM.attorney} has finished preparing ${docLabel}` +
        `${v.matter_number ? ` for matter ${val(v.matter_number)}` : ''}. ` +
        `${needsSig ? 'Review and sign it' : 'Review it'} here: ${ctaUrl}${BASE_FALLBACK}`,
    }
  },

  // CLIENT — invoice (NEW: "invoice emails"). Billing ROUTE is owned by S4; this
  // is only the presentation. Amounts are decimal strings (ADR 0043/0044).
  'client-invoice': (v) => {
    const invNo = val(v.invoice_number, '—')
    const due = money(v.amount_due)
    const lineItems = Array.isArray(v.line_items)
      ? (v.line_items as Array<Record<string, unknown>>)
      : []
    const itemsHtml = lineItems.length
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 12px;">
          ${lineItems
            .map(
              (li) => `<tr>
              <td style="padding:6px 0;font-family:${FONTS.sans};font-size:14px;color:${COLORS.fg};border-bottom:1px solid ${COLORS.border};">${esc(val(li.label, 'Services'))}</td>
              <td align="right" style="padding:6px 0;font-family:${FONTS.sans};font-size:14px;color:${COLORS.fg};border-bottom:1px solid ${COLORS.border};white-space:nowrap;">${money(li.amount)}</td>
            </tr>`,
            )
            .join('')}
        </table>`
      : ''
    return {
      subject: `Invoice ${invNo} from ${FIRM.shortName} — ${due} due`,
      preheader: `${due} due${v.due_date_label ? ` by ${val(v.due_date_label)}` : ''}.`,
      html: renderShell({
        audience: 'client',
        preheader: `${due} due${v.due_date_label ? ` by ${val(v.due_date_label)}` : ''}.`,
        heading: `Invoice ${invNo}`,
        body:
          paragraph(hi(v)) +
          paragraph(
            `Thank you for trusting <strong>${esc(FIRM.name)}</strong>${
              v.matter_number ? ` with matter <strong>${esc(val(v.matter_number))}</strong>` : ''
            }. Your invoice is summarized below.`,
          ) +
          itemsHtml +
          callout(
            `<span style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:${COLORS.muted};">Amount due</span><br>` +
              `<span style="font-family:${FONTS.serif};font-size:28px;font-weight:700;color:${COLORS.navy900};">${due}</span>` +
              (v.due_date_label
                ? `<span style="color:${COLORS.muted};font-size:14px;"> &nbsp;due by ${esc(val(v.due_date_label))}</span>`
                : ''),
            'navy',
          ) +
          (v.pay_url ? button('Pay this invoice', val(v.pay_url), 'gold') : '') +
          finePrint(
            'Questions about this invoice? Just reply to this email and we&rsquo;ll be glad to help.',
          ) +
          signoff(),
      }),
      text:
        `${val(v.client_first_name, 'Hi')},\n\nInvoice ${invNo}${v.matter_number ? ` (matter ${val(v.matter_number)})` : ''}: ${due} due` +
        `${v.due_date_label ? ` by ${val(v.due_date_label)}` : ''}.` +
        `${v.pay_url ? `\n\nPay here: ${val(v.pay_url)}` : ''}${BASE_FALLBACK}`,
    }
  },

  // CLIENT — portal magic link.
  'client-portal-magic-link': (v) => ({
    subject: 'Your Pacheco Law sign-in link',
    preheader: 'Secure sign-in link — expires in 30 minutes.',
    html: renderShell({
      audience: 'client',
      preheader: 'Secure sign-in link — expires in 30 minutes.',
      heading: 'Sign in to your client portal',
      body:
        paragraph(`Hi ${esc(val(v.client_full_name, 'there'))},`) +
        paragraph(
          'Use the secure button below to sign in and view the status of your matter. For your security, this link expires in 30 minutes.',
        ) +
        button('Sign in securely', val(v.login_url, '#')) +
        finePrint(
          'If you didn&rsquo;t request this, you can safely ignore this email — no one can access your portal without the link.',
        ) +
        signoff(),
    }),
    text: `Hi ${val(v.client_full_name, 'there')},\n\nSign in to your Pacheco Law client portal (link expires in 30 minutes):\n${val(v.login_url, '(link unavailable)')}\n\nIf you didn't request this, you can ignore this email.${BASE_FALLBACK}`,
  }),

  // CLIENT — new message from the attorney.
  'client-portal-message': (v) => ({
    subject: 'You have a new message from Pacheco Law',
    preheader: `New message${v.matter_number ? ` on matter ${val(v.matter_number)}` : ''}.`,
    html: renderShell({
      audience: 'client',
      preheader: `New message${v.matter_number ? ` on matter ${val(v.matter_number)}` : ''}.`,
      heading: 'You have a new message',
      body:
        paragraph('Hi there,') +
        paragraph(
          `Your attorney posted a new message about your matter${v.matter_number ? ` (<strong>${esc(val(v.matter_number))}</strong>)` : ''}. For your privacy, the message stays inside your secure portal.`,
        ) +
        button('Read & reply', val(v.portal_url, '#')) +
        signoff(),
    }),
    text: `Hi there,\n\nYour attorney posted a new message${v.matter_number ? ` about matter ${val(v.matter_number)}` : ''}. Sign in to read and reply:\n${val(v.portal_url, '(portal link unavailable)')}${BASE_FALLBACK}`,
  }),

  // ATTORNEY — async draft completed (internal; lighter chrome, same shell).
  'attorney-draft-completed': (v) => ({
    subject: `Draft ready for review — ${val(v.document_kind_label, val(v.document_kind, 'document'))} (${val(v.matter_number, 'matter')})`,
    preheader: 'An async drafting run just finished.',
    html: renderShell({
      audience: 'attorney',
      preheader: 'An async drafting run just finished.',
      heading: 'A draft is ready for review',
      body:
        paragraph('The async drafting run finished.') +
        detailRows([
          { label: 'Matter', value: esc(val(v.matter_number, '—')) },
          { label: 'Document', value: esc(val(v.document_kind_label, val(v.document_kind, '—'))) },
          { label: 'Model confidence', value: esc(val(v.confidence, '—')) },
        ]) +
        button('Review the draft', val(v.review_url, '#')),
    }),
    text: `A draft is ready.\nMatter: ${val(v.matter_number, '—')}\nDocument: ${val(v.document_kind_label, val(v.document_kind, '—'))}\nConfidence: ${val(v.confidence, '—')}\nReview: ${val(v.review_url, '(set NEXT_PUBLIC_BASE_URL)')}`,
  }),

  // ATTORNEY — manual-workflow matter opened (safety-net mail).
  'attorney-manual-matter': (v) => ({
    subject: `New matter needs your attention — ${val(v.client_full_name, 'a prospect')} (${val(v.service_label, val(v.service_key, 'matter'))})`,
    preheader: 'A manual-workflow matter just came in.',
    html: renderShell({
      audience: 'attorney',
      preheader: 'A manual-workflow matter just came in.',
      heading: 'New matter needs your attention',
      body:
        paragraph(
          'A new manual-workflow matter just came in. No documents will be auto-generated for it.',
        ) +
        detailRows([
          { label: 'Client', value: esc(val(v.client_full_name, '—')) },
          { label: 'Email', value: esc(val(v.client_email, '—')) },
          { label: 'Phone', value: esc(val(v.client_phone, '—')) },
          { label: 'Service', value: esc(val(v.service_label, val(v.service_key, '—'))) },
          {
            label: 'Consultation',
            value: v.scheduled_at ? esc(val(v.scheduled_at)) : 'Not booked yet',
          },
        ]) +
        button('Open the matter', val(v.matter_url, '#')),
    }),
    text: `New manual matter.\nClient: ${val(v.client_full_name, '—')}\nEmail: ${val(v.client_email, '—')}\nService: ${val(v.service_label, val(v.service_key, '—'))}\nOpen: ${val(v.matter_url, '(set NEXT_PUBLIC_BASE_URL)')}`,
  }),

  // ATTORNEY — new client portal message.
  'attorney-portal-message': (v) => ({
    subject: `New client message — ${val(v.matter_number, 'a matter')}`,
    preheader: 'A client posted a new message on the portal.',
    html: renderShell({
      audience: 'attorney',
      preheader: 'A client posted a new message on the portal.',
      heading: 'New client message',
      body:
        paragraph(
          `A client posted a new message on the portal${v.matter_number ? ` for matter <strong>${esc(val(v.matter_number))}</strong>` : ''}.`,
        ) + button('Read & reply', val(v.matter_url, '#')),
    }),
    text: `A client posted a new message${v.matter_number ? ` on matter ${val(v.matter_number)}` : ''}. Open to read and reply: ${val(v.matter_url, '(set NEXT_PUBLIC_BASE_URL)')}`,
  }),
}

export function buildEmail(templateRef: string, variables: Vars): BuiltEmail | null {
  const builder = BUILDERS[templateRef]
  return builder ? builder(variables) : null
}

export function listTemplateRefs(): string[] {
  return Object.keys(BUILDERS)
}
