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
      ...(v.document_count
        ? [`Documents uploaded at intake: ${s(v.document_count)} (see the matter's Documents tab)`]
        : []),
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
      // Intake-only services (no consultation) get honest next-steps copy —
      // never a reference to an appointment that doesn't exist.
      v.scheduled_at
        ? `Thanks for telling us about your matter. Juan Carlos will review your answers before your consultation.`
        : `Thanks for telling us about your matter. Juan Carlos will review your answers and follow up with next steps by email.`,
    ].join('\n'),
  }),
  'client-portal-magic-link': (v) => ({
    subject: `Your Pacheco Law sign-in link`,
    bodyText: [
      `Hi ${s(v.client_full_name, 'there')},`,
      ``,
      `Use the secure link below to sign in to your Pacheco Law client portal and`,
      `view the status of your matter. The link expires in 30 minutes.`,
      ``,
      `${s(v.login_url, '(sign-in link unavailable)')}`,
      ``,
      `If you didn't request this, you can safely ignore this email.`,
    ].join('\n'),
  }),
  'client-portal-invite': (v) => ({
    subject: `Set up your Pacheco Law client portal`,
    bodyText: [
      `Hi ${s(v.client_full_name, 'there')},`,
      ``,
      `Pacheco Law has set up secure portal access for you. Use the link below to`,
      `choose a password — then you can sign in any time to view your matters,`,
      `documents, and invoices, and message the firm. The link expires in 7 days.`,
      ``,
      `${s(v.portal_url, '(set-up link unavailable)')}`,
      ``,
      `If you weren't expecting this, you can safely ignore this email.`,
    ].join('\n'),
  }),
  'attorney-new-request': (v) => ({
    subject: `New client request — ${s(v.request_type, 'request')}`,
    bodyText: [
      `A client submitted a new request through the portal and accepted the cost.`,
      ``,
      `Type: ${s(v.request_type, '—')}`,
      `Accepted price: ${s(v.amount, '—')} ${s(v.currency, 'USD')}`,
      ``,
      `Open your requests to accept and work it: ${s(v.requests_url, '(set NEXT_PUBLIC_BASE_URL)')}`,
    ].join('\n'),
  }),
  'client-request-update': (v) => ({
    subject: `Update on your ${s(v.request_type, 'request')} — Pacheco Law`,
    bodyText: [
      `Hi there,`,
      ``,
      `Your ${s(v.request_type, 'request')} is now: ${s(v.status, 'updated')}.`,
      ``,
      `Sign in to your client portal for details: ${s(v.portal_url, '(portal link unavailable)')}`,
    ].join('\n'),
  }),
  // ESIGN-UNIFY-1 (ES-1, §9.4): tenant-aware — sender identity comes from the
  // notification variables (firm_name/attorney_name threaded by notifyDelivered
  // from getTenantSettings), never a hardcoded firm. The subject is the
  // envelope subject when present (the composer defaults it to the document
  // title). deliverNotification takes its SUBJECT from here (the branded HTML
  // part rides alongside), so this is where §9.4's subject rule lands.
  'esign-sign-request': (v) => ({
    subject: s(v.envelope_subject, `Please sign: ${s(v.document_title, 'your document')}`),
    bodyText: [
      `Hi ${s(v.signer_name, 'there')},`,
      ``,
      `${s(v.firm_name, 'Your attorney')} has prepared a document for your electronic`,
      `signature. Use the secure link below to review it and sign. The link expires in 14 days.`,
      ``,
      `${s(v.sign_url, '(signing link unavailable)')}`,
      ...(v.envelope_message
        ? [
            ``,
            `Message from ${s(v.attorney_name, s(v.firm_name, 'your attorney'))}: ${s(v.envelope_message)}`,
          ]
        : []),
      ``,
      `If you weren't expecting this, you can safely ignore this email.`,
    ].join('\n'),
  }),
  'esign-sign-request-portal': (v) => ({
    subject: s(v.envelope_subject, `Action needed: sign ${s(v.document_title, 'a document')}`),
    bodyText: [
      `Hi ${s(v.signer_name, 'there')},`,
      ``,
      `${s(v.firm_name, 'Your attorney')} has prepared a document that needs your`,
      `signature. Sign in to your secure client portal to review and sign it.`,
      ``,
      `${s(v.portal_url, '(portal link unavailable)')}`,
      ...(v.envelope_message
        ? [
            ``,
            `Message from ${s(v.attorney_name, s(v.firm_name, 'your attorney'))}: ${s(v.envelope_message)}`,
          ]
        : []),
    ].join('\n'),
  }),
  // ESIGN-UNIFY-1 (ES-1, §9.2, 0186): the receives_copy recipient's executed-
  // copy email, sent once the envelope completes.
  'esign-copy-delivered': (v) => ({
    subject: `Executed copy: ${s(v.envelope_subject, s(v.document_title, 'your document'))}`,
    bodyText: [
      `Hi ${s(v.signer_name, 'there')},`,
      ``,
      `All parties have signed ${s(v.document_title, 'the document')}. Use the secure`,
      `link below to view the executed copy.`,
      ``,
      `${s(v.copy_url, '(link unavailable)')}`,
      ...(v.envelope_message
        ? [
            ``,
            `Message from ${s(v.attorney_name, s(v.firm_name, 'your attorney'))}: ${s(v.envelope_message)}`,
          ]
        : []),
    ].join('\n'),
  }),
  'attorney-portal-message': (v) => ({
    subject: `New client message — ${s(v.matter_number, 'a matter')}`,
    bodyText: [
      `A client posted a new message on the portal.`,
      ``,
      `Matter: ${s(v.matter_number, '—')}`,
      ``,
      // No message body in the email — open the matter to read and reply.
      `Open the matter to read and reply: ${s(v.matter_url, '(set NEXT_PUBLIC_BASE_URL)')}`,
    ].join('\n'),
  }),
  'client-portal-message': (v) => ({
    subject: `You have a new message from Pacheco Law`,
    bodyText: [
      `Hi there,`,
      ``,
      `Your attorney posted a new message about your matter${
        v.matter_number ? ` (${s(v.matter_number)})` : ''
      }.`,
      ``,
      // No message body in the email — sign in to the portal to read and reply.
      `Sign in to your client portal to read and reply: ${s(v.portal_url, '(portal link unavailable)')}`,
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
      // Account access (S10): the portal is magic-link based, so the "create your
      // account" link is the sign-in page where the client enters this same email
      // and gets a secure link — no password, no token embedded in this email.
      ...(v.portal_url
        ? [
            ``,
            `Set up your client portal to track your matter and sign documents.`,
            `Use the email you just gave us to sign in: ${s(v.portal_url)}`,
          ]
        : []),
    ].join('\n'),
  }),
}

// Human titles for the Templates catalog (Obj 9). Keyed by template_ref; a ref
// with no entry falls back to a humanized form of its key.
const TEMPLATE_TITLES: Record<string, string> = {
  'attorney-manual-matter': 'Attorney — new manual matter',
  'attorney-draft-completed': 'Attorney — draft ready for review',
  'prospect-intake-confirmation': 'Prospect — intake received',
  'client-portal-magic-link': 'Client — portal sign-in link',
  'client-portal-invite': 'Client — portal set-up invite',
  'attorney-new-request': 'Attorney — new client request',
  'client-request-update': 'Client — request status update',
  'esign-sign-request': 'Signer — e-signature request (link)',
  'esign-sign-request-portal': 'Signer — e-signature request (portal)',
  'esign-copy-delivered': 'Recipient — executed copy delivered',
  'attorney-portal-message': 'Attorney — new client message',
  'client-portal-message': 'Client — new attorney message',
  'prospect-booking-confirmation': 'Prospect — consultation booked',
}

export interface NotificationTemplateRef {
  ref: string
  title: string
}

// List the firm's email templates (Phase 0: the in-memory set) for the Templates
// catalog, without exposing the private renderer map. Phase 1 moves these to
// substrate content rows; this signature stays stable.
export function listNotificationTemplateRefs(): NotificationTemplateRef[] {
  return Object.keys(TEMPLATES).map((ref) => ({
    ref,
    title: TEMPLATE_TITLES[ref] ?? ref.replace(/[-_]/g, ' '),
  }))
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
