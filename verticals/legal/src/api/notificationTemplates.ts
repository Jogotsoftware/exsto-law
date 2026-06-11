// Notification templates (Phase 0: repo-file style, keyed by template_ref —
// Phase 1's library layer moves these to substrate content rows; the renderer
// interface stays stable so call sites don't change).

export interface RenderedNotification {
  subject: string
  bodyText: string
}

type Vars = Record<string, unknown>
const s = (v: unknown, fallback = ''): string => (v == null || v === '' ? fallback : String(v))

const TEMPLATES: Record<string, (v: Vars) => RenderedNotification> = {
  'attorney-manual-matter': (v) => ({
    subject: `New matter needs your attention — ${s(v.client_full_name, 'a prospect')} (${s(v.service_label, s(v.service_key, 'matter'))})`,
    bodyText: [
      `A new manual-workflow matter just came in.`,
      ``,
      `Client: ${s(v.client_full_name, '—')}`,
      `Email: ${s(v.client_email, '—')}`,
      `Phone: ${s(v.client_phone, '—')}`,
      `Service: ${s(v.service_label, s(v.service_key, '—'))}`,
      v.scheduled_at ? `Consultation: ${s(v.scheduled_at)}` : `No consultation booked yet.`,
      ``,
      `This matter routes to your manual workflow — no documents will be auto-generated.`,
      `Open the matter: ${s(v.matter_url, '(set NEXT_PUBLIC_BASE_URL)')}`,
    ].join('\n'),
  }),
  'attorney-draft-completed': (v) => ({
    subject: `Draft ready for review — ${s(v.document_kind_label, s(v.document_kind, 'document'))} (${s(v.matter_number, 'matter')})`,
    bodyText: [
      `The async drafting run finished.`,
      ``,
      `Matter: ${s(v.matter_number, '—')}`,
      `Document: ${s(v.document_kind_label, s(v.document_kind, '—'))}`,
      `Model confidence: ${s(v.confidence, '—')}`,
      ``,
      `Review it: ${s(v.review_url, '(set NEXT_PUBLIC_BASE_URL)')}`,
    ].join('\n'),
  }),
  'prospect-intake-confirmation': (v) => ({
    subject: `We received your information — Pacheco Law`,
    bodyText: [
      `Hi ${s(v.client_first_name, s(v.client_full_name, 'there'))},`,
      ``,
      `Thanks for telling us about your matter. Juan Carlos will review your answers before your consultation.`,
      ``,
      `— Pacheco Law Firm`,
    ].join('\n'),
  }),
  'prospect-booking-confirmation': (v) => ({
    subject: `Your consultation is booked — Pacheco Law`,
    bodyText: [
      `Hi ${s(v.client_first_name, s(v.client_full_name, 'there'))},`,
      ``,
      `Your consultation with Juan Carlos Pacheco is confirmed for ${s(v.scheduled_at_label, s(v.scheduled_at, 'the selected time'))}.`,
      `A calendar invitation is on its way to your inbox.`,
      ``,
      `Need to change it? Use the reschedule link in the calendar invite.`,
      ``,
      `— Pacheco Law Firm`,
    ].join('\n'),
  }),
}

export function renderNotificationTemplate(
  templateRef: string,
  variables: Vars,
): RenderedNotification {
  const template = TEMPLATES[templateRef]
  if (!template) {
    return {
      subject: `Pacheco Law notification (${templateRef})`,
      bodyText: JSON.stringify(variables, null, 2),
    }
  }
  return template(variables)
}
