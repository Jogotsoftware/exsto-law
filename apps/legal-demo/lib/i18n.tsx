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
  'field.registered_agent_address.label': 'Registered agent address in NC',
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
  'fee.hint': 'Accept the fee above to continue.',

  // Returning-client notice (flow start)
  'funnel.existing': 'Already working with us?',
  'funnel.signin': 'Sign in to your client portal',
  'funnel.existing_tail':
    'to book with your details prefilled — or continue below if you are new here.',
  'funnel.signedin': 'Booking as',
  'funnel.portal': 'Go to your portal',

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
  'field.registered_agent_address.label': 'Dirección del agente registrado en NC',
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
  'fee.hint': 'Acepta los honorarios de arriba para continuar.',

  // Aviso para clientes existentes (inicio del flujo)
  'funnel.existing': '¿Ya trabajas con nosotros?',
  'funnel.signin': 'Inicia sesión en tu portal de cliente',
  'funnel.existing_tail':
    'para reservar con tus datos precargados — o continúa abajo si eres nuevo aquí.',
  'funnel.signedin': 'Reservando como',
  'funnel.portal': 'Ir a tu portal',

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
