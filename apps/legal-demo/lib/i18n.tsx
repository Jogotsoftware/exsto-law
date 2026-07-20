'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Lang = 'en' | 'es'

const STORAGE_KEY = 'pacheco_lang'

const en: Record<string, string> = {
  // Stepper
  'step.service': '1. Service',
  'step.contact': '2. Contact',
  'step.intake': '3. About you',
  'step.time': '4. Time',

  // Headers
  'header.service': 'How can we help you?',
  'header.book': 'Book a consultation',

  // Common
  'common.continue': 'Continue',
  'common.back': 'Back',
  'common.loading': 'Loading…',

  // Service step
  'service.loading': 'Loading services…',

  // Contact step
  'contact.heading': 'Your contact information',
  'contact.name': 'Full name *',
  'contact.email': 'Email *',
  'contact.phone': 'Phone *',
  'contact.company': 'Company name (optional)',
  'contact.source': 'How did you hear about us? *',

  // Intake step
  'intake.heading': 'Tell us about your situation',

  // Slot step
  'slot.heading': 'Pick a time',
  'slot.loading': 'Loading availability…',
  'slot.none': 'No availability found. Please email us.',
  'slot.booking': 'Booking…',
  'slot.confirm': 'Confirm booking',
  'slot.unavailable':
    'Online scheduling is temporarily unavailable. Please email us and we’ll set up a time.',
  'slot.conflict':
    'That time was just booked by someone else. Please pick another from the refreshed calendar below.',

  // Confirmation
  'confirm.title': "You're booked",
  'confirm.scheduled': 'Your consultation with {attorney} is scheduled for {when}.',
  'confirm.email': 'A calendar invite is on its way to {email}.',
  'confirm.matter_ref': 'Matter reference:',
  'confirm.back': 'Back to home',

  // Intake-only services (no consultation appointment)
  'intake.submit': 'Submit request',
  'intake.submitting': 'Submitting…',
  'confirm.title_intake': 'Request received',
  'confirm.intake_received': '{attorney} will review your information and follow up by email.',
  'confirm.email_intake': 'A confirmation email is on its way to {email}.',

  // Errors
  'error.pick_service': 'Please pick a service.',
  'error.name': 'Please enter your full name.',
  'error.email': 'Please enter a valid email.',
  'error.phone': 'Please enter a valid phone number.',
  'error.source': 'Please tell us how you heard about us.',
  'error.no_service': 'No service selected.',
  'error.member_required': 'At least one member is required.',
  'error.member_name': 'Each member needs a name.',
  'error.member_address': 'Each member needs an address.',
  'error.fill_field': 'Please fill out: {field}',
  'error.captcha': 'Please complete the verification challenge before booking.',

  // Members repeater
  'member.label': 'Member {n}',
  'member.fullname': 'Full legal name',
  'member.capital': 'Capital contribution (USD)',
  'member.ownership': 'Ownership %',
  'member.manager': 'Also a Manager?',
  'member.address': 'Address',
  'member.remove': 'Remove member',
  'member.add': '+ Add another member',

  // Inputs
  'select.choose': 'Choose…',

  // Service titles & descriptions (plain language — fallback to DB values if missing)
  'service.nc_llc_single_member.title': 'Start a business (just you)',
  'service.nc_llc_single_member.desc':
    'Set up your single-owner North Carolina LLC with a tailored operating agreement.',
  'service.nc_llc_multi_member.title': 'Start a business (with partners)',
  'service.nc_llc_multi_member.desc':
    'Set up your North Carolina LLC and get a tailored operating agreement for you and your co-owners.',
  'service.something_else.title': 'Something else',
  'service.something_else.desc':
    "Not sure what you need? Tell us and we'll point you the right way.",
  'service.llc_formation.title': 'Start a business (LLC)',
  'service.llc_formation.desc':
    'Set up your North Carolina LLC and get a tailored operating agreement.',
  'service.business_formation.title': 'Start a business (LLC)',
  'service.business_formation.desc':
    'Set up your North Carolina LLC and get a tailored operating agreement.',
  'service.oa_amendment.title': 'Update your operating agreement',
  'service.oa_amendment.desc': 'Change or amend the operating agreement you already have.',
  'service.other.title': 'Something else',
  'service.other.desc':
    "Not sure which fits? Tell us what you need and we'll point you the right way.",

  // Booking flow (redesign) copy
  'service.subtitle': 'Choose what you need help with — in everyday language.',
  'contact.subtitle': 'So we can reach you and get ready for your consultation.',
  'intake.subtitle': 'A few details about your situation so your time with us counts.',
  'slot.subtitle': 'Pick a time that works for you — shown in your local time zone.',
  'progress.service': 'Service',
  'progress.contact': 'Contact',
  'progress.intake': 'About you',
  'progress.time': 'Time',
  'progress.account': 'Account',
  'progress.step_of': 'Step {n} of {total}',
  'book.secure': 'Your information is encrypted and kept confidential.',
  'common.optional': 'Optional',
  'slot.selected_label': 'Your selected time',

  // Section titles
  'section.company.title': 'About the company',
  'section.members.title': 'Members and ownership',
  'section.operations.title': 'Operations and finances',
  'section.engagement.title': 'Engagement terms',

  // Field labels
  'field.request_text.label': 'What do you need help with?',
  'field.company_name.label': 'Proposed LLC name',
  'field.company_purpose.label': 'Purpose of the LLC (one sentence)',
  'field.registered_agent_name.label': 'Registered agent name',
  'field.registered_agent_address.label': 'Registered agent address',
  'field.principal_office_address.label': 'Principal office address',
  'field.expected_formation_date.label': 'Expected formation date',
  'field.members.label': 'Members',
  'field.management_structure.label': 'Management structure',
  'field.fiscal_year_end.label': 'Fiscal year end (MM-DD)',
  'field.distribution_policy.label': 'Distribution policy',
  'field.distribution_policy.help':
    'How profits and losses are allocated and when distributions are made.',
  'field.transfer_restrictions.label': 'Transfer restrictions',
  'field.transfer_restrictions.help':
    'Any restrictions on transferring membership interests (right of first refusal, etc.).',
  'field.dissolution_triggers.label': 'Dissolution triggers',
  'field.fee_structure.label': 'Fee structure',
  'field.fee_amount.label': 'Fee amount (USD)',
  'field.scope_notes.label': 'Scope notes (anything outside standard OA work?)',
  'field.tax_election.label': 'Tax election',
  'field.plans_to_add_members.label': 'Plans to add members',
  'field.member_full_name.label': 'Member full name',
  'field.member_address.label': 'Member address',
  'field.capital_contribution.label': 'Capital contribution',

  // Option values (translated dropdown labels)
  'option.member_managed': 'Member-managed',
  'option.manager_managed': 'Manager-managed',
  'option.flat_fee': 'Flat fee',
  'option.hourly': 'Hourly',
  'option.hybrid': 'Hybrid',

  // Address autocomplete
  'addr.placeholder': 'Start typing an address…',
  'addr.unavailable': 'Address suggestions unavailable — typed text will be saved as-is.',

  // Availability calendar
  'cal.prev_week': 'Previous week',
  'cal.next_week': 'Next week',
  'cal.local_time': 'All times in your local time ({tz})',
  'cal.live': 'Live availability',
  'cal.updated': 'updated {time}',
  'cal.refresh': 'Refresh availability',
  'cal.taken': 'Taken',
  'cal.loading': 'Loading…',
  'cal.load_more': 'Load more weeks',
  'cal.no_times': 'No times',
  'cal.all_taken': 'All taken',
  'cal.times_open_one': '{n} time open',
  'cal.times_open_many': '{n} times open',

  // Fee consent card + waiting-on-consent hint
  'fee.title': 'Fee for this service',
  'fee.hourly_note': '(billed for time actually worked)',
  'fee.accept_fixed': 'I accept this fee. It will be billed on my invoice for this service.',
  'fee.accept_hourly': 'I accept this hourly rate for work on this service.',

  // Client portal (CLIENT-PORTAL-UI-1) — simple, plain client copy only.
  'portal.nav.home': 'Home',
  'portal.nav.documents': 'Documents',
  'portal.nav.notifications': 'Notifications',
  'portal.signout': 'Sign out',
  'portal.firm_switch': 'Switch firm',
  'portal.firm_main': 'Main',
  'portal.greeting.morning': 'Good morning{name}.',
  'portal.greeting.afternoon': 'Good afternoon{name}.',
  'portal.greeting.evening': 'Good evening{name}.',
  'portal.attention.label': 'Needs your attention',
  'portal.attention.consultation': 'Upcoming consultation',
  'portal.attention.signature': 'Waiting on your signature',
  'portal.attention.manage': 'Reschedule or cancel',
  'portal.attention.sign': 'Review & sign',
  'portal.matters.label': 'Your matters',
  'portal.matters.empty':
    "You don't have any matters with the firm yet. Once you book a consultation, it'll appear here.",
  'portal.matters.archived': 'Closed',
  // S2 (single status truth) + S3 (human title fallback)
  'portal.matter.status.in_progress': 'In progress',
  'portal.matter.status.completed': 'Completed',
  'portal.matter.generic': 'Legal matter',
  'portal.rail.book.title': 'Need something else?',
  'portal.rail.book.body':
    "Book time with the firm or request a new service. We'll confirm before any work begins.",
  'portal.rail.book.cta': 'Book or request a service',
  'portal.gate.title': 'One quick step first',
  'portal.gate.body': 'To book time or message the firm, review and accept the engagement terms.',
  'portal.gate.rate': 'Standard rate: ${rate} / hour',
  'portal.gate.cta': 'Review & accept terms',
  'portal.gate.note': 'Booking and messages unlock right after.',
  'portal.gate.terms_title': 'Engagement terms',
  'portal.gate.confirm': 'Accept & continue',
  'portal.gate.cancel': 'Not now',
  'portal.gate.unavailable':
    "The firm hasn't published its engagement terms yet — check back soon or reach out directly.",
  'portal.gate.desc': 'Standard hourly rate for messages and booked time',
  'portal.messages.label': 'Messages',
  'portal.messages.open': 'Open messages',
  'portal.messages.empty': 'No messages yet.',
  'portal.messages.you': 'You',
  'portal.billing.label': 'Billing',
  'portal.billing.due_one': '1 invoice due{date}',
  'portal.billing.due_many': '{count} invoices due{date}',
  'portal.billing.cta': 'View & pay',
  'portal.billing.clear': "You're all set — nothing due right now.",
  'portal.docs.title': 'Documents',
  'portal.docs.search': 'Search documents in this matter…',
  'portal.docs.from_attorney': 'From your attorney',
  'portal.docs.to_sign': 'To sign & signed',
  'portal.docs.uploaded': "You've uploaded",
  'portal.docs.view': 'View',
  'portal.docs.download': 'Download',
  // S1: an upload whose stored file can no longer be resolved (never rendered as
  // a live View/Download).
  'portal.docs.unavailable': 'This file is no longer available — contact the firm.',
  'portal.docs.upload': 'Upload a document',
  'portal.docs.uploading': 'Uploading…',
  'portal.docs.upload_hint': 'PDF, Word, images, or text · up to 25 MB',
  'portal.docs.empty': "No documents yet. We'll post documents here when they're ready.",
  'portal.docs.none_match': 'Nothing matches your search in this matter.',
  'portal.notif.title': 'Notifications',
  'portal.notif.empty': "You're all caught up.",
  'portal.notif.message': 'New message from your attorney',
  'portal.notif.document': 'A document is ready for you',
  'portal.notif.esign_request': 'A document is ready for your signature',
  'portal.notif.invoice': 'Invoice {ref} was sent to you',
  'portal.notif.booking_confirmed': 'Your consultation is booked',
  'portal.notif.booking_changed': 'Your consultation was updated',
  'portal.notif.booking_cancelled': 'Your consultation was cancelled',
  'portal.notif.mark_read': 'Mark all as read',
  'portal.back_home': 'Back to home',
  'portal.assistant.tag': 'Ask a question',
  'portal.assistant.title': 'Assistant',
  'portal.loading': 'Loading…',
  // LI portal restyle — new tabs / labels / copy
  'portal.nav.invoices': 'Invoices',
  'portal.nav.signatures': 'Signatures',
  'portal.nav.assistant': 'Assistant',
  'portal.nav.settings': 'Settings',
  'portal.brand_sub': 'Client Portal',
  'portal.docs.search_all': 'Search',
  'portal.docs.none_match_all': 'Nothing matches your search.',
  'portal.docs.upload_short': 'Upload',
  'portal.docs.upload_to': 'Upload to which matter?',
  'portal.docs.tag_signed': 'Signed',
  'portal.docs.tag_awaiting': 'Awaiting signature',
  'portal.docs.tag_document': 'Document',
  'portal.docs.tag_upload': 'Upload',
  'portal.invoices.empty': 'No invoices yet. They’ll appear here once the firm sends one.',
  'portal.invoices.due': 'Due {date}',
  'portal.invoices.paid': 'Paid',
  'portal.invoices.due_label': 'Due',
  'portal.invoices.receipt': 'Receipt',
  'portal.invoices.pay': 'Pay',
  'portal.invoices.accruing': 'Accruing fees (not yet invoiced)',
  'portal.invoices.accruing_none': 'No fees accruing right now.',
  'portal.invoices.accrued': 'Accrued',
  'portal.invoices.running': 'Running total',
  'portal.invoices.total_open': 'Total open',
  'portal.sig.signed': 'Signed',
  'portal.sig.declined': 'Declined',
  'portal.sig.in_progress': 'In progress',
  'portal.sig.awaiting': 'Awaiting your signature',
  'portal.sig.empty': 'You have no documents awaiting your signature.',
  'portal.schedule.consent_first': 'Please review and accept the fee below, then confirm again.',
  'portal.schedule.booked':
    'Booked for {when} — a calendar invitation and confirmation email are on the way.',
  'portal.schedule.book_lead':
    'Book another service — signed in, your details and previous answers are prefilled.',
  'portal.schedule.book_service': 'Book a service',
  'portal.schedule.title': 'Schedule time with the firm',
  'portal.schedule.checking': 'Checking availability…',
  'portal.schedule.unavailable':
    'Online scheduling isn’t available right now — message the firm and they’ll find a time with you.',
  'portal.schedule.length': 'Length',
  'portal.schedule.no_slots': 'No open times in the next few weeks.',
  'portal.schedule.booking': 'Booking…',
  'portal.schedule.confirm': 'Confirm time',
  'portal.requests.title': 'Make a request',
  'portal.requests.lead':
    'Request a meeting, a document, or an attorney review. You’ll see the cost and accept it before it’s submitted.',
  'portal.requests.what': 'What do you need?',
  'portal.requests.meeting': 'Meeting',
  'portal.requests.document': 'Document',
  'portal.requests.review': 'Attorney review',
  'portal.requests.how_long': 'How long?',
  'portal.requests.minutes': 'minutes',
  'portal.requests.details': 'Details (optional)',
  'portal.requests.details_ph': 'Tell the attorney what you need…',
  'portal.requests.pricing': 'Getting price…',
  'portal.requests.see_cost': 'See the cost',
  'portal.requests.submitting': 'Submitting…',
  'portal.requests.accept': 'Accept & submit',
  'portal.requests.your': 'Your requests',
  'portal.messages.lead': 'Message your attorney about this matter.',
  'portal.messages.start': 'No messages yet. Start the conversation below.',
  'portal.messages.write': 'Write a message…',
  'portal.messages.sending': 'Sending…',
  'portal.messages.send': 'Send',
  'portal.settings.details': 'Your details',
  'portal.settings.name': 'Full name',
  'portal.settings.email': 'Email',
  'portal.settings.contact_note': 'To update your details, message your attorney.',
  'portal.settings.language': 'Preferred language',
  'portal.assistant.s1': 'What’s the status of my matter?',
  'portal.assistant.s2': 'When is my next consultation?',
  'portal.assistant.s3': 'How do I pay my invoice?',
  'portal.assistant.name': '{firm} Assistant',
  'portal.assistant.empty_h': 'How can I help you today?',
  'portal.assistant.empty_p': 'Ask about your matter, documents, scheduling, or payments.',
  'portal.assistant.confirm': 'Confirm your request',
  'portal.assistant.fee': 'Fee',
  'portal.assistant.file': 'Accept fee & file request',
  'portal.assistant.filed': 'Request filed — the firm has been notified and will review it.',
  'portal.assistant.placeholder': 'Ask the assistant…',
  'portal.assistant.disclaimer':
    'For legal questions the assistant routes you to the attorney — it doesn’t give legal advice.',
  // FB-0 — thumbs feedback on an assistant reply.
  'portal.assistant.fb_helpful': 'Mark this reply helpful',
  'portal.assistant.fb_unhelpful': 'Mark this reply not helpful',
  'portal.assistant.fb_title': 'Rate this reply',
  'portal.assistant.fb_marked_helpful': 'Marked helpful',
  'portal.assistant.fb_marked_unhelpful': 'Marked not helpful',
  'portal.assistant.fb_note_label': 'Add a note (optional)',
  'portal.assistant.fb_note_placeholder': 'What made this reply good or bad?',
  'portal.assistant.fb_cancel': 'Cancel',
  'portal.assistant.fb_submit': 'Submit',
  'portal.assistant.fb_submitting': 'Submitting…',
  'fee.hint': 'Accept the fee above to continue.',

  // Returning-client notice (flow start)
  'funnel.existing': 'Already working with us?',
  'funnel.signin': 'Sign in to your client portal',
  'funnel.existing_tail':
    'to book with your details prefilled — or continue below if you are new here.',
  'funnel.signedin': 'Booking as',
  'funnel.portal': 'Go to your portal',

  // Two-path chooser (A1.1) — the first screen on both booking surfaces
  'chooser.title': 'Welcome',
  'chooser.subtitle': 'How would you like to continue?',
  'chooser.signin_title': 'Sign In To Your Client Portal',
  'chooser.signin_desc': 'Already a client? View your matter, documents, and messages.',
  'chooser.new_title': 'Continue As New Client',
  'chooser.new_desc': 'Tell us what you need and grab a time that works for you.',
  'chooser.firm_login': 'Firm login',

  // Inline sign-in panel
  'signin.email': 'Email',
  'signin.password': 'Password',
  'signin.submit': 'Sign in',
  'signin.working': 'Signing you in…',
  'signin.failed': 'We could not sign you in.',
  'signin.unavailable': 'Sign-in is not available right now — you can continue without it.',

  // Account gate
  'account.heading': 'Create your account',
  'account.heading_signin': 'Sign in to your account',
  'account.subtitle': 'Everything about your matter will live in your secure portal.',
  'account.subtitle_signin': 'Your request will be linked to your existing portal account.',
  'account.blurb':
    'One last step: create your secure client portal account. You will use it to track your matter, read and sign documents, message the firm, and pay invoices.',
  'account.password': 'Choose a password',
  'account.password2': 'Confirm password',
  'account.submit': 'Create account & submit',
  'account.password_short': 'Choose a password of at least 8 characters.',
  'account.password_mismatch': 'The passwords do not match.',
  'account.fee_required': 'Please review and accept the fee to continue.',
  'account.known': 'It looks like you already have an account — sign in to link this request.',
  'account.signin_toggle': 'Already have a portal account? Sign in instead',
  'account.create_toggle': 'New here, or can’t sign in? Create your account instead',

  // Confirmation — portal account outcomes
  'confirm.account_created':
    'Your client portal account is ready — check your email for a confirmation link, then sign in to track this matter, read documents, and pay invoices.',
  'confirm.account_existed':
    'This booking is linked to your existing portal account — sign in with your usual password.',
  'confirm.portal': 'Open your client portal',
}

const es: Record<string, string> = {
  // WP-7 — intake controls that previously rendered English on the Spanish intake:
  // the allow_unknown toggle, the yes/no + true/false pill LABELS (stored answer
  // values stay English — they merge into documents), and the file-upload copy.
  'field.unknown': 'No lo sé',
  'choice.yes': 'Sí',
  'choice.no': 'No',
  'choice.true': 'Verdadero',
  'choice.false': 'Falso',
  'upload.attach': 'Adjuntar un documento',
  'upload.add_another': 'Adjuntar otro documento',
  'upload.uploading': 'Subiendo…',
  'upload.remove': 'Quitar',
  'upload.failed': 'Error al subir el archivo.',
  'upload.hint': 'PDF, Word, imágenes o texto — hasta 25 MB cada uno.',

  // Stepper
  'step.service': '1. Servicio',
  'step.contact': '2. Contacto',
  'step.intake': '3. Sobre ti',
  'step.time': '4. Horario',

  // Headers
  'header.service': '¿Cómo te podemos ayudar?',
  'header.book': 'Reserva una consulta',

  // Common
  'common.continue': 'Continuar',
  'common.back': 'Atrás',
  'common.loading': 'Cargando…',

  // Service step
  'service.loading': 'Cargando servicios…',

  // Contact step
  'contact.heading': 'Tu información de contacto',
  'contact.name': 'Nombre completo *',
  'contact.email': 'Correo electrónico *',
  'contact.phone': 'Teléfono *',
  'contact.company': 'Nombre de la empresa (opcional)',
  'contact.source': '¿Cómo te enteraste de nosotros? *',

  // Intake step
  'intake.heading': 'Cuéntanos sobre tu situación',

  // Slot step
  'slot.heading': 'Elige un horario',
  'slot.loading': 'Cargando disponibilidad…',
  'slot.none': 'No hay disponibilidad. Por favor envíanos un correo.',
  'slot.booking': 'Reservando…',
  'slot.confirm': 'Confirmar reserva',
  'slot.unavailable':
    'La programación en línea no está disponible por el momento. Escríbenos por correo y coordinamos una hora.',
  'slot.conflict':
    'Ese horario acaba de reservarse por otra persona. Por favor elige otro del calendario actualizado.',

  // Confirmation
  'confirm.title': '¡Listo, estás reservado!',
  'confirm.scheduled': 'Tu consulta con {attorney} está programada para {when}.',
  'confirm.email': 'Una invitación de calendario va en camino a {email}.',
  'confirm.matter_ref': 'Referencia del asunto:',
  'confirm.back': 'Volver al inicio',

  // Intake-only services (no consultation appointment)
  'intake.submit': 'Enviar solicitud',
  'intake.submitting': 'Enviando…',
  'confirm.title_intake': 'Solicitud recibida',
  'confirm.intake_received': '{attorney} revisará tu información y te contactará por correo.',
  'confirm.email_intake': 'Un correo de confirmación va en camino a {email}.',

  // Errors
  'error.pick_service': 'Por favor selecciona un servicio.',
  'error.name': 'Por favor ingresa tu nombre completo.',
  'error.email': 'Por favor ingresa un correo válido.',
  'error.phone': 'Por favor ingresa un número de teléfono válido.',
  'error.source': 'Por favor cuéntanos cómo te enteraste de nosotros.',
  'error.no_service': 'No se ha seleccionado un servicio.',
  'error.member_required': 'Se requiere al menos un miembro.',
  'error.member_name': 'Cada miembro necesita un nombre.',
  'error.member_address': 'Cada miembro necesita una dirección.',
  'error.fill_field': 'Por favor completa: {field}',
  'error.captcha': 'Por favor completa la verificación antes de reservar.',

  // Members repeater
  'member.label': 'Miembro {n}',
  'member.fullname': 'Nombre legal completo',
  'member.capital': 'Aportación de capital (USD)',
  'member.ownership': '% de propiedad',
  'member.manager': '¿También es Gerente?',
  'member.address': 'Dirección',
  'member.remove': 'Quitar miembro',
  'member.add': '+ Agregar otro miembro',

  // Inputs
  'select.choose': 'Selecciona…',

  // Service titles (lenguaje sencillo)
  'service.nc_llc_single_member.title': 'Inicia un negocio (solo tú)',
  'service.nc_llc_single_member.desc':
    'Constituye tu LLC de un solo dueño en Carolina del Norte con un acuerdo operativo a tu medida.',
  'service.nc_llc_multi_member.title': 'Inicia un negocio (con socios)',
  'service.nc_llc_multi_member.desc':
    'Constituye tu LLC en Carolina del Norte y obtén un acuerdo operativo a tu medida para ti y tus socios.',
  'service.something_else.title': 'Otra cosa',
  'service.something_else.desc': '¿No sabes qué necesitas? Cuéntanos y te orientamos.',
  'field.request_text.label': '¿En qué necesitas ayuda?',
  'service.llc_formation.title': 'Inicia un negocio (LLC)',
  'service.llc_formation.desc':
    'Constituye tu LLC en Carolina del Norte y obtén un acuerdo operativo a tu medida.',
  'service.business_formation.title': 'Inicia un negocio (LLC)',
  'service.business_formation.desc':
    'Constituye tu LLC en Carolina del Norte y obtén un acuerdo operativo a tu medida.',
  'service.oa_amendment.title': 'Actualiza tu acuerdo operativo',
  'service.oa_amendment.desc': 'Cambia o enmienda el acuerdo operativo que ya tienes.',
  'service.other.title': 'Otra cosa',
  'service.other.desc': '¿No sabes cuál elegir? Cuéntanos qué necesitas y te orientamos.',

  // Booking flow (rediseño)
  'service.subtitle': 'Elige en qué necesitas ayuda — en lenguaje cotidiano.',
  'contact.subtitle': 'Para poder contactarte y preparar tu consulta.',
  'intake.subtitle': 'Algunos datos sobre tu situación para aprovechar tu consulta.',
  'slot.subtitle': 'Elige un horario que te convenga — en tu zona horaria local.',
  'progress.service': 'Servicio',
  'progress.contact': 'Contacto',
  'progress.intake': 'Sobre ti',
  'progress.time': 'Horario',
  'progress.account': 'Cuenta',
  'progress.step_of': 'Paso {n} de {total}',
  'book.secure': 'Tu información está cifrada y se mantiene confidencial.',
  'common.optional': 'Opcional',
  'slot.selected_label': 'Tu horario seleccionado',

  // Section titles
  'section.company.title': 'Sobre la empresa',
  'section.members.title': 'Miembros y propiedad',
  'section.operations.title': 'Operaciones y finanzas',
  'section.engagement.title': 'Términos de contratación',

  // Field labels
  'field.company_name.label': 'Nombre propuesto de la LLC',
  'field.company_purpose.label': 'Propósito de la LLC (una oración)',
  'field.registered_agent_name.label': 'Nombre del agente registrado',
  'field.registered_agent_address.label': 'Dirección del agente registrado',
  'field.principal_office_address.label': 'Dirección de la oficina principal',
  'field.expected_formation_date.label': 'Fecha esperada de constitución',
  'field.members.label': 'Miembros',
  'field.management_structure.label': 'Estructura de administración',
  'field.fiscal_year_end.label': 'Fin del año fiscal (MM-DD)',
  'field.distribution_policy.label': 'Política de distribuciones',
  'field.distribution_policy.help':
    'Cómo se asignan las ganancias y pérdidas y cuándo se hacen las distribuciones.',
  'field.transfer_restrictions.label': 'Restricciones de transferencia',
  'field.transfer_restrictions.help':
    'Cualquier restricción para transferir intereses de membresía (derecho de tanteo, etc.).',
  'field.dissolution_triggers.label': 'Causas de disolución',
  'field.fee_structure.label': 'Estructura de honorarios',
  'field.fee_amount.label': 'Monto de honorarios (USD)',
  'field.scope_notes.label': 'Notas de alcance (¿algo fuera del trabajo estándar del OA?)',
  'field.tax_election.label': 'Elección fiscal',
  'field.plans_to_add_members.label': '¿Planes de agregar miembros?',
  'field.member_full_name.label': 'Nombre completo del miembro',
  'field.member_address.label': 'Dirección del miembro',
  'field.capital_contribution.label': 'Aportación de capital',

  // Option values
  'option.member_managed': 'Administrado por miembros',
  'option.manager_managed': 'Administrado por un gerente',
  'option.flat_fee': 'Tarifa fija',
  'option.hourly': 'Por hora',
  'option.hybrid': 'Híbrido',

  // Address autocomplete
  'addr.placeholder': 'Empieza a escribir una dirección…',
  'addr.unavailable':
    'Sugerencias de direcciones no disponibles — se guardará el texto tal como lo escribes.',

  // Availability calendar
  'cal.prev_week': 'Semana anterior',
  'cal.next_week': 'Semana siguiente',
  'cal.local_time': 'Horarios en tu zona local ({tz})',
  'cal.live': 'Disponibilidad en vivo',
  'cal.updated': 'actualizado {time}',
  'cal.refresh': 'Actualizar disponibilidad',
  'cal.taken': 'Ocupado',
  'cal.loading': 'Cargando…',
  'cal.load_more': 'Cargar más semanas',
  'cal.no_times': 'Sin horarios',
  'cal.all_taken': 'Todo ocupado',
  'cal.times_open_one': '{n} horario disponible',
  'cal.times_open_many': '{n} horarios disponibles',

  // Tarjeta de consentimiento de honorarios + aviso de espera
  'fee.title': 'Honorarios por este servicio',
  'fee.hourly_note': '(se factura por el tiempo realmente trabajado)',
  'fee.accept_fixed': 'Acepto estos honorarios. Se incluirán en mi factura por este servicio.',
  'fee.accept_hourly': 'Acepto esta tarifa por hora por el trabajo en este servicio.',

  // Portal del cliente (CLIENT-PORTAL-UI-1)
  'portal.nav.home': 'Inicio',
  'portal.nav.documents': 'Documentos',
  'portal.nav.notifications': 'Notificaciones',
  'portal.signout': 'Cerrar sesión',
  'portal.firm_switch': 'Cambiar de firma',
  'portal.firm_main': 'Principal',
  'portal.greeting.morning': 'Buenos días{name}.',
  'portal.greeting.afternoon': 'Buenas tardes{name}.',
  'portal.greeting.evening': 'Buenas noches{name}.',
  'portal.attention.label': 'Requiere su atención',
  'portal.attention.consultation': 'Próxima consulta',
  'portal.attention.signature': 'Esperando su firma',
  'portal.attention.manage': 'Reprogramar o cancelar',
  'portal.attention.sign': 'Revisar y firmar',
  'portal.matters.label': 'Sus asuntos',
  'portal.matters.empty':
    'Aún no tiene asuntos con la firma. Cuando reserve una consulta, aparecerá aquí.',
  'portal.matters.archived': 'Cerrado',
  // S2 (una sola verdad de estado) + S3 (título humano por defecto)
  'portal.matter.status.in_progress': 'En curso',
  'portal.matter.status.completed': 'Completado',
  'portal.matter.generic': 'Asunto legal',
  'portal.rail.book.title': '¿Necesita algo más?',
  'portal.rail.book.body':
    'Reserve tiempo con la firma o solicite un nuevo servicio. Confirmaremos antes de comenzar cualquier trabajo.',
  'portal.rail.book.cta': 'Reservar o solicitar un servicio',
  'portal.gate.title': 'Un paso rápido primero',
  'portal.gate.body':
    'Para reservar tiempo o enviar mensajes a la firma, revise y acepte los términos del acuerdo.',
  'portal.gate.rate': 'Tarifa estándar: ${rate} / hora',
  'portal.gate.cta': 'Revisar y aceptar términos',
  'portal.gate.note': 'Las reservas y los mensajes se desbloquean de inmediato.',
  'portal.gate.terms_title': 'Términos del acuerdo',
  'portal.gate.confirm': 'Aceptar y continuar',
  'portal.gate.cancel': 'Ahora no',
  'portal.gate.unavailable':
    'La firma aún no ha publicado sus términos del acuerdo. Vuelva pronto o comuníquese directamente.',
  'portal.gate.desc': 'Tarifa estándar por hora para mensajes y tiempo reservado',
  'portal.messages.label': 'Mensajes',
  'portal.messages.open': 'Abrir mensajes',
  'portal.messages.empty': 'Aún no hay mensajes.',
  'portal.messages.you': 'Usted',
  'portal.billing.label': 'Facturación',
  'portal.billing.due_one': '1 factura pendiente{date}',
  'portal.billing.due_many': '{count} facturas pendientes{date}',
  'portal.billing.cta': 'Ver y pagar',
  'portal.billing.clear': 'Todo en orden — no hay nada pendiente.',
  'portal.docs.title': 'Documentos',
  'portal.docs.search': 'Buscar documentos en este asunto…',
  'portal.docs.from_attorney': 'De su abogado',
  'portal.docs.to_sign': 'Para firmar y firmados',
  'portal.docs.uploaded': 'Subidos por usted',
  'portal.docs.view': 'Ver',
  'portal.docs.download': 'Descargar',
  // S1: una subida cuyo archivo almacenado ya no se puede resolver.
  'portal.docs.unavailable': 'Este archivo ya no está disponible — comuníquese con la firma.',
  'portal.docs.upload': 'Subir un documento',
  'portal.docs.uploading': 'Subiendo…',
  'portal.docs.upload_hint': 'PDF, Word, imágenes o texto · hasta 25 MB',
  'portal.docs.empty': 'Aún no hay documentos. Los publicaremos aquí cuando estén listos.',
  'portal.docs.none_match': 'Nada coincide con su búsqueda en este asunto.',
  'portal.notif.title': 'Notificaciones',
  'portal.notif.empty': 'Está al día.',
  'portal.notif.message': 'Nuevo mensaje de su abogado',
  'portal.notif.document': 'Un documento está listo para usted',
  'portal.notif.esign_request': 'Un documento está listo para su firma',
  'portal.notif.invoice': 'Se le envió la factura {ref}',
  'portal.notif.booking_confirmed': 'Su consulta está reservada',
  'portal.notif.booking_changed': 'Su consulta fue actualizada',
  'portal.notif.booking_cancelled': 'Su consulta fue cancelada',
  'portal.notif.mark_read': 'Marcar todo como leído',
  'portal.back_home': 'Volver al inicio',
  'portal.assistant.tag': 'Haga una pregunta',
  'portal.assistant.title': 'Asistente',
  'portal.loading': 'Cargando…',
  // LI portal restyle — new tabs / labels / copy
  'portal.nav.invoices': 'Facturas',
  'portal.nav.signatures': 'Firmas',
  'portal.nav.assistant': 'Asistente',
  'portal.nav.settings': 'Ajustes',
  'portal.brand_sub': 'Portal del Cliente',
  'portal.docs.search_all': 'Buscar',
  'portal.docs.none_match_all': 'Nada coincide con su búsqueda.',
  'portal.docs.upload_short': 'Subir',
  'portal.docs.upload_to': '¿A qué asunto subirlo?',
  'portal.docs.tag_signed': 'Firmado',
  'portal.docs.tag_awaiting': 'Pendiente de firma',
  'portal.docs.tag_document': 'Documento',
  'portal.docs.tag_upload': 'Subida',
  'portal.invoices.empty': 'Aún no hay facturas. Aparecerán aquí cuando la firma envíe una.',
  'portal.invoices.due': 'Vence {date}',
  'portal.invoices.paid': 'Pagada',
  'portal.invoices.due_label': 'Pendiente',
  'portal.invoices.receipt': 'Recibo',
  'portal.invoices.pay': 'Pagar',
  'portal.invoices.accruing': 'Cargos en curso (aún no facturados)',
  'portal.invoices.accruing_none': 'No hay cargos acumulándose ahora.',
  'portal.invoices.accrued': 'Acumulado',
  'portal.invoices.running': 'Total en curso',
  'portal.invoices.total_open': 'Total pendiente',
  'portal.sig.signed': 'Firmado',
  'portal.sig.declined': 'Rechazado',
  'portal.sig.in_progress': 'En curso',
  'portal.sig.awaiting': 'Esperando su firma',
  'portal.sig.empty': 'No tiene documentos pendientes de firma.',
  'portal.schedule.consent_first':
    'Revise y acepte la tarifa a continuación, luego confirme de nuevo.',
  'portal.schedule.booked':
    'Reservado para {when} — una invitación de calendario y un correo de confirmación están en camino.',
  'portal.schedule.book_lead':
    'Reserve otro servicio — al iniciar sesión, sus datos y respuestas anteriores se rellenan automáticamente.',
  'portal.schedule.book_service': 'Reservar un servicio',
  'portal.schedule.title': 'Agende tiempo con la firma',
  'portal.schedule.checking': 'Comprobando disponibilidad…',
  'portal.schedule.unavailable':
    'La programación en línea no está disponible ahora — escriba a la firma y encontrarán un horario con usted.',
  'portal.schedule.length': 'Duración',
  'portal.schedule.no_slots': 'No hay horarios disponibles en las próximas semanas.',
  'portal.schedule.booking': 'Reservando…',
  'portal.schedule.confirm': 'Confirmar horario',
  'portal.requests.title': 'Hacer una solicitud',
  'portal.requests.lead':
    'Solicite una reunión, un documento o una revisión del abogado. Verá el costo y lo aceptará antes de enviarlo.',
  'portal.requests.what': '¿Qué necesita?',
  'portal.requests.meeting': 'Reunión',
  'portal.requests.document': 'Documento',
  'portal.requests.review': 'Revisión del abogado',
  'portal.requests.how_long': '¿Cuánto tiempo?',
  'portal.requests.minutes': 'minutos',
  'portal.requests.details': 'Detalles (opcional)',
  'portal.requests.details_ph': 'Dígale al abogado qué necesita…',
  'portal.requests.pricing': 'Obteniendo precio…',
  'portal.requests.see_cost': 'Ver el costo',
  'portal.requests.submitting': 'Enviando…',
  'portal.requests.accept': 'Aceptar y enviar',
  'portal.requests.your': 'Sus solicitudes',
  'portal.messages.lead': 'Escriba a su abogado sobre este asunto.',
  'portal.messages.start': 'Aún no hay mensajes. Inicie la conversación abajo.',
  'portal.messages.write': 'Escriba un mensaje…',
  'portal.messages.sending': 'Enviando…',
  'portal.messages.send': 'Enviar',
  'portal.settings.details': 'Sus datos',
  'portal.settings.name': 'Nombre completo',
  'portal.settings.email': 'Correo electrónico',
  'portal.settings.contact_note': 'Para actualizar sus datos, escriba a su abogado.',
  'portal.settings.language': 'Idioma preferido',
  'portal.assistant.s1': '¿Cuál es el estado de mi asunto?',
  'portal.assistant.s2': '¿Cuándo es mi próxima consulta?',
  'portal.assistant.s3': '¿Cómo pago mi factura?',
  'portal.assistant.name': 'Asistente de {firm}',
  'portal.assistant.empty_h': '¿Cómo puedo ayudarle hoy?',
  'portal.assistant.empty_p': 'Pregunte sobre su asunto, documentos, programación o pagos.',
  'portal.assistant.confirm': 'Confirme su solicitud',
  'portal.assistant.fee': 'Tarifa',
  'portal.assistant.file': 'Aceptar tarifa y enviar solicitud',
  'portal.assistant.filed': 'Solicitud registrada — la firma ha sido notificada y la revisará.',
  'portal.assistant.placeholder': 'Pregunte al asistente…',
  'portal.assistant.disclaimer':
    'Para preguntas legales, el asistente le remite al abogado — no ofrece asesoría legal.',
  // FB-0 — comentarios (pulgar arriba/abajo) sobre una respuesta del asistente.
  'portal.assistant.fb_helpful': 'Marcar esta respuesta como útil',
  'portal.assistant.fb_unhelpful': 'Marcar esta respuesta como no útil',
  'portal.assistant.fb_title': 'Califique esta respuesta',
  'portal.assistant.fb_marked_helpful': 'Marcada como útil',
  'portal.assistant.fb_marked_unhelpful': 'Marcada como no útil',
  'portal.assistant.fb_note_label': 'Agregue una nota (opcional)',
  'portal.assistant.fb_note_placeholder': '¿Qué hizo que esta respuesta fuera buena o mala?',
  'portal.assistant.fb_cancel': 'Cancelar',
  'portal.assistant.fb_submit': 'Enviar',
  'portal.assistant.fb_submitting': 'Enviando…',
  'fee.hint': 'Acepta los honorarios de arriba para continuar.',

  // Aviso para clientes existentes (inicio del flujo)
  'funnel.existing': '¿Ya trabajas con nosotros?',
  'funnel.signin': 'Inicia sesión en tu portal de cliente',
  'funnel.existing_tail':
    'para reservar con tus datos precargados — o continúa abajo si eres nuevo aquí.',
  'funnel.signedin': 'Reservando como',
  'funnel.portal': 'Ir a tu portal',

  // Selector de dos caminos (A1.1) — la primera pantalla en ambas superficies de reserva
  'chooser.title': 'Bienvenido',
  'chooser.subtitle': '¿Cómo te gustaría continuar?',
  'chooser.signin_title': 'Inicia Sesión En Tu Portal De Cliente',
  'chooser.signin_desc': '¿Ya eres cliente? Consulta tu caso, documentos y mensajes.',
  'chooser.new_title': 'Continuar Como Cliente Nuevo',
  'chooser.new_desc': 'Cuéntanos qué necesitas y elige un horario que te convenga.',
  'chooser.firm_login': 'Acceso del despacho',

  // Panel de inicio de sesión integrado
  'signin.email': 'Correo electrónico',
  'signin.password': 'Contraseña',
  'signin.submit': 'Iniciar sesión',
  'signin.working': 'Iniciando tu sesión…',
  'signin.failed': 'No pudimos iniciar tu sesión.',
  'signin.unavailable':
    'Iniciar sesión no está disponible por el momento — puedes continuar sin hacerlo.',

  // Paso de cuenta
  'account.heading': 'Crea tu cuenta',
  'account.heading_signin': 'Inicia sesión en tu cuenta',
  'account.subtitle': 'Todo sobre tu asunto vivirá en tu portal seguro.',
  'account.subtitle_signin': 'Tu solicitud quedará vinculada a tu cuenta del portal existente.',
  'account.blurb':
    'Un último paso: crea tu cuenta segura del portal de cliente. La usarás para seguir tu asunto, leer y firmar documentos, escribir al despacho y pagar facturas.',
  'account.password': 'Elige una contraseña',
  'account.password2': 'Confirma la contraseña',
  'account.submit': 'Crear cuenta y enviar',
  'account.password_short': 'Elige una contraseña de al menos 8 caracteres.',
  'account.password_mismatch': 'Las contraseñas no coinciden.',
  'account.fee_required': 'Por favor revisa y acepta los honorarios para continuar.',
  'account.known': 'Parece que ya tienes una cuenta — inicia sesión para vincular esta solicitud.',
  'account.signin_toggle': '¿Ya tienes una cuenta del portal? Inicia sesión',
  'account.create_toggle': '¿Nuevo aquí o no puedes iniciar sesión? Crea tu cuenta',

  // Confirmación — resultados de la cuenta del portal
  'confirm.account_created':
    'Tu cuenta del portal de cliente está lista — revisa tu correo para el enlace de confirmación y luego inicia sesión para seguir este asunto, leer documentos y pagar facturas.',
  'confirm.account_existed':
    'Esta reserva quedó vinculada a tu cuenta del portal existente — inicia sesión con tu contraseña habitual.',
  'confirm.portal': 'Abre tu portal de cliente',
}

const dict: Record<Lang, Record<string, string>> = { en, es }

interface I18nValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string, vars?: Record<string, string | number>, fallback?: string) => string
}

const Ctx = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'es') setLangState(stored)
  }, [])

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang
  }, [lang])

  function setLang(l: Lang) {
    setLangState(l)
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, l)
  }

  function t(key: string, vars?: Record<string, string | number>, fallback?: string): string {
    let s = dict[lang][key] ?? dict.en[key] ?? fallback ?? key
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
      }
    }
    return s
  }

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>
}

export function useI18n(): I18nValue {
  const v = useContext(Ctx)
  if (!v) {
    return {
      lang: 'en',
      setLang: () => {},
      t: (key, vars, fallback) => {
        let s = en[key] ?? fallback ?? key
        if (vars) {
          for (const [k, v2] of Object.entries(vars)) {
            s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v2))
          }
        }
        return s
      },
    }
  }
  return v
}
