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
  'slot.stub_notice':
    'Showing sample times — Juan Carlos’s live calendar isn’t connected right now, so these slots may need to be reconfirmed.',
  'slot.conflict':
    'That time was just booked by someone else. Please pick another from the refreshed calendar below.',

  // Confirmation
  'confirm.title': "You're booked",
  'confirm.scheduled': 'Your consultation with {attorney} is scheduled for {when}.',
  'confirm.email': 'A calendar invite is on its way to {email}.',
  'confirm.matter_ref': 'Matter reference:',
  'confirm.back': 'Back to home',

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

  // Service titles & descriptions (fallback to DB values if missing)
  'service.llc_formation.title': 'NC LLC formation',
  'service.business_formation.title': 'NC LLC formation',
  'service.oa_amendment.title': 'OA amendment',
  'service.other.title': 'Custom',

  // Section titles
  'section.company.title': 'About the company',
  'section.members.title': 'Members and ownership',
  'section.operations.title': 'Operations and finances',
  'section.engagement.title': 'Engagement terms',

  // Field labels
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
}

const es: Record<string, string> = {
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
  'slot.stub_notice':
    'Mostrando horarios de muestra — el calendario en vivo de Juan Carlos no está conectado, así que estos horarios podrían necesitar confirmación.',
  'slot.conflict':
    'Ese horario acaba de reservarse por otra persona. Por favor elige otro del calendario actualizado.',

  // Confirmation
  'confirm.title': '¡Listo, estás reservado!',
  'confirm.scheduled': 'Tu consulta con {attorney} está programada para {when}.',
  'confirm.email': 'Una invitación de calendario va en camino a {email}.',
  'confirm.matter_ref': 'Referencia del asunto:',
  'confirm.back': 'Volver al inicio',

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

  // Service titles
  'service.llc_formation.title': 'Constitución de LLC en NC',
  'service.business_formation.title': 'Constitución de LLC en NC',
  'service.oa_amendment.title': 'Enmienda al acuerdo operativo',
  'service.other.title': 'Personalizado',

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
