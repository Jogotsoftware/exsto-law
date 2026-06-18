'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { callClientMcp } from '@/lib/mcpClient'
import { AddressAutocomplete, type StructuredAddress } from '@/components/AddressAutocomplete'
import { AvailabilityCalendar, type CalendarSlot } from '@/components/AvailabilityCalendar'
import { LanguageToggle } from '@/components/LanguageToggle'
import { Turnstile } from '@/components/Turnstile'
import { useI18n } from '@/lib/i18n'
import {
  ArrowRightIcon,
  Building2Icon,
  BriefcaseIcon,
  CheckIcon,
  ChevronLeftIcon,
  ClockIcon,
  FileTextIcon,
  HelpCircleIcon,
  LockIcon,
  MailIcon,
  MegaphoneIcon,
  ScaleIcon,
  SparklesIcon,
  UserIcon,
  UsersIcon,
} from '@/components/icons'

// CAPTCHA is gated on a PUBLIC site key. Unset (demo/dev default) → no widget,
// no token, and the server gate is also a no-op, so booking works unchanged.
// Set → render the Turnstile widget and require a token before submit. Enabling
// the gate end-to-end also needs TURNSTILE_SECRET on the server.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

interface ServiceField {
  id: string
  label: string
  type: string
  required?: boolean
  allow_unknown?: boolean
  options?: string[]
}

interface ServiceSection {
  id: string
  title: string
  fields: ServiceField[]
}

interface Service {
  id: string
  serviceKey: string
  displayName: string
  description: string | null
  intakeSchema: { sections: ServiceSection[] }
}

type Step = 'service' | 'contact' | 'intake' | 'slot' | 'done'

interface MemberRow {
  // Client-only stable identity for React keys. Stripped before sending to
  // the booking submit handler.
  id: string
  name: string
  address: StructuredAddress | null
  capital_contribution: string
  ownership_percentage: string
  is_manager: boolean
}

const INITIAL_HORIZON_DAYS = 60
const HORIZON_INCREMENT_DAYS = 28
const REFRESH_MS = 60_000

const PROGRESS_STEPS: ReadonlyArray<{ key: Exclude<Step, 'done'>; labelKey: string }> = [
  { key: 'service', labelKey: 'progress.service' },
  { key: 'contact', labelKey: 'progress.contact' },
  { key: 'intake', labelKey: 'progress.intake' },
  { key: 'slot', labelKey: 'progress.time' },
]

// Plain-language services map to a friendly icon; anything unknown gets a doc icon.
function ServiceIcon({ serviceKey, size = 22 }: { serviceKey: string; size?: number }) {
  if (serviceKey === 'other') return <HelpCircleIcon size={size} />
  if (serviceKey.includes('amendment')) return <FileTextIcon size={size} />
  if (
    serviceKey.includes('llc') ||
    serviceKey.includes('formation') ||
    serviceKey.includes('business')
  )
    return <Building2Icon size={size} />
  return <SparklesIcon size={size} />
}

function newMemberId(): string {
  return `m_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`
}

function emptyMember(): MemberRow {
  return {
    id: newMemberId(),
    name: '',
    address: null,
    capital_contribution: '',
    ownership_percentage: '',
    is_manager: false,
  }
}

export default function BookPage() {
  const { t, lang } = useI18n()
  const [presetServiceKey, setPresetServiceKey] = useState<string | null>(null)

  const [contact, setContact] = useState({
    fullName: '',
    email: '',
    phone: '',
    companyName: '',
    attributionSource: '',
  })
  const [services, setServices] = useState<Service[] | null>(null)
  const [selectedServiceKey, setSelectedServiceKey] = useState<string | null>(null)
  const [intakeResponses, setIntakeResponses] = useState<Record<string, unknown>>({})
  const [members, setMembers] = useState<MemberRow[]>([emptyMember()])

  const [slots, setSlots] = useState<CalendarSlot[] | null>(null)
  const [slotsSource, setSlotsSource] = useState<'google' | 'stub' | null>(null)
  const [slotsLastUpdated, setSlotsLastUpdated] = useState<Date | null>(null)
  const [slotsRefreshing, setSlotsRefreshing] = useState(false)
  const [horizonDays, setHorizonDays] = useState(INITIAL_HORIZON_DAYS)
  const [loadingMoreWeeks, setLoadingMoreWeeks] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<CalendarSlot | null>(null)

  const [step, setStep] = useState<Step>('service')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // CAPTCHA token + a reset handle the widget hands back. Both stay null when
  // the site key is unset (the widget never renders), and the submit flow below
  // only requires/sends a token in that case.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const resetCaptchaRef = useRef<(() => void) | null>(null)
  const [confirmation, setConfirmation] = useState<{
    matterNumber: string
    scheduledAt: string
  } | null>(null)

  // Honor ?service=… (presets pick the service up-front and skip the picker)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    const s = p.get('service')
    if (s) {
      setPresetServiceKey(s)
      setSelectedServiceKey(s)
      setStep('contact')
    }
  }, [])

  useEffect(() => {
    callClientMcp<{ services: Service[] }>({ toolName: 'legal.service.list' })
      .then((r) => setServices(r.services))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  // A ?service= preset jumps straight to the contact step before services have
  // loaded. Once they do, validate the preset: if it doesn't resolve to a real
  // service, drop it and return the user to the picker instead of stranding
  // them on a blank intake step.
  useEffect(() => {
    if (!services || !presetServiceKey) return
    if (!services.some((s) => s.serviceKey === presetServiceKey)) {
      setPresetServiceKey(null)
      setSelectedServiceKey(null)
      setStep('service')
    }
  }, [services, presetServiceKey])

  // Monotonic request id: a newer availability fetch supersedes any in-flight
  // older one, so a slow earlier response can never overwrite fresher slots.
  const slotsReqSeq = useRef(0)

  const fetchSlots = useCallback(
    async (daysOut: number, opts: { silent?: boolean; serviceKey?: string } = {}) => {
    const seq = ++slotsReqSeq.current
    if (!opts.silent) setSlotsRefreshing(true)
    try {
      const r = await callClientMcp<{
        slots: CalendarSlot[]
        source: 'google' | 'stub'
        reason?: string
      }>({
        toolName: 'legal.calendar.availability',
        // serviceKey sizes each slot to the service's configured duration
        // (Contract G); omitted on the mount prefetch, then supplied once a
        // service is chosen so the grid matches the booked call length.
        input: { daysOut, serviceKey: opts.serviceKey },
      })
      if (seq !== slotsReqSeq.current) return // superseded by a newer fetch
      setSlots(r.slots)
      setSlotsSource(r.source)
      setSlotsLastUpdated(new Date())
      if (r.source === 'stub' && r.reason) {
        // Surface server-side fallback reason in the browser console so we
        // can diagnose without grepping function logs.
        console.warn('[availability] Google fallback to stub:', r.reason)
      }
    } catch {
      // leave previous slots in place on transient failure
    } finally {
      if (seq === slotsReqSeq.current && !opts.silent) setSlotsRefreshing(false)
    }
    },
    [],
  )

  // Initial slot load (mount only). Subsequent windows are fetched explicitly
  // by the "load more" handler and the refresh button; keeping horizonDays out
  // of the deps avoids a second, racing fetch on every window change.
  useEffect(() => {
    fetchSlots(INITIAL_HORIZON_DAYS)
  }, [fetchSlots])

  // On the slot step: refetch immediately with the chosen service (so the grid
  // reflects that service's slot length), then poll so newly-booked times drop
  // out. Re-runs if the selected service changes while on this step.
  useEffect(() => {
    if (step !== 'slot') return
    fetchSlots(horizonDays, { silent: true, serviceKey: selectedServiceKey ?? undefined })
    const id = setInterval(
      () => fetchSlots(horizonDays, { silent: true, serviceKey: selectedServiceKey ?? undefined }),
      REFRESH_MS,
    )
    return () => clearInterval(id)
  }, [step, horizonDays, fetchSlots, selectedServiceKey])

  const selectedService = useMemo(
    () => services?.find((s) => s.serviceKey === selectedServiceKey) ?? null,
    [services, selectedServiceKey],
  )

  function advanceFromService() {
    setError(null)
    if (!selectedServiceKey) {
      setError(t('error.pick_service'))
      return
    }
    setStep('contact')
  }

  function advanceFromContact() {
    setError(null)
    if (!contact.fullName.trim()) return setError(t('error.name'))
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) return setError(t('error.email'))
    if (!contact.phone || !isValidPhoneNumber(contact.phone)) return setError(t('error.phone'))
    if (!contact.attributionSource.trim()) return setError(t('error.source'))
    setStep('intake')
  }

  function validateIntake(): string | null {
    if (!selectedService) return t('error.no_service')
    for (const section of selectedService.intakeSchema.sections ?? []) {
      for (const field of section.fields ?? []) {
        if (!field.required) continue
        if (field.type === 'members_repeater') {
          if (members.length === 0) return t('error.member_required')
          for (const m of members) {
            if (!m.name.trim()) return t('error.member_name')
            if (!m.address?.formatted_address?.trim()) return t('error.member_address')
          }
          continue
        }
        const label = t(`field.${field.id}.label`, undefined, field.label)
        if (field.type === 'address_autocomplete') {
          const val = intakeResponses[field.id] as StructuredAddress | undefined
          if (!val?.formatted_address?.trim()) return t('error.fill_field', { field: label })
          continue
        }
        const val = intakeResponses[field.id]
        if (val === UNKNOWN_ANSWER) continue
        if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
          return t('error.fill_field', { field: label })
        }
      }
    }
    return null
  }

  function advanceFromIntake() {
    const err = validateIntake()
    if (err) {
      setError(err)
      return
    }
    setError(null)
    setStep('slot')
  }

  async function submitBooking() {
    if (!selectedService || !selectedSlot) return
    // When the CAPTCHA is enabled, a verified token is mandatory before we hit
    // the server (which would otherwise 403). When it's disabled the widget
    // never renders, captchaToken stays null, and this guard is skipped.
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setError(t('error.captcha'))
      return
    }
    setBusy('submit')
    setError(null)
    try {
      const responsesToSubmit = selectedService.intakeSchema.sections.some((s) =>
        s.fields.some((f) => f.type === 'members_repeater'),
      )
        ? { ...intakeResponses, members: members.map(({ id: _id, ...rest }) => rest) }
        : intakeResponses

      const result = await callClientMcp<{
        actionId: string
        effects: Array<{ matterEntityId: string; matterNumber: string; scheduledAt: string }>
      }>({
        toolName: 'legal.booking.submit',
        input: {
          clientFullName: contact.fullName.trim(),
          clientEmail: contact.email.trim(),
          clientPhone: contact.phone,
          clientCompanyName: contact.companyName.trim() || undefined,
          attributionSource: contact.attributionSource.trim(),
          serviceKey: selectedService.serviceKey,
          intakeResponses: responsesToSubmit,
          scheduledAtIso: selectedSlot.startIso,
          scheduledEndIso: selectedSlot.endIso,
        },
        // undefined when CAPTCHA is disabled → callClientMcp omits the field.
        captchaToken: captchaToken ?? undefined,
      })

      const effect = result.effects[0]
      if (!effect) throw new Error('Booking response missing matter id.')
      setConfirmation({ matterNumber: effect.matterNumber, scheduledAt: effect.scheduledAt })
      setStep('done')
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      // A Turnstile token is single-use; any failed submit consumed it, so
      // reset the widget and require a fresh solve before the next attempt.
      if (TURNSTILE_SITE_KEY) {
        setCaptchaToken(null)
        resetCaptchaRef.current?.()
      }
      if (raw.includes('SLOT_TAKEN')) {
        // Someone else grabbed this slot between when the calendar was last
        // refreshed and when we hit submit. Translate the error, force a
        // fresh availability fetch, and clear the now-invalid selection so
        // the user has to pick again.
        setError(t('slot.conflict'))
        setSelectedSlot(null)
        void fetchSlots(horizonDays, { serviceKey: selectedServiceKey ?? undefined })
      } else {
        setError(raw)
      }
    } finally {
      setBusy(null)
    }
  }

  // ---- Confirmation screen ------------------------------------------------
  if (step === 'done' && confirmation) {
    const whenStr = new Date(confirmation.scheduledAt).toLocaleString(
      lang === 'es' ? 'es-US' : undefined,
      { dateStyle: 'full', timeStyle: 'short' },
    )
    const scheduledTemplate = t('confirm.scheduled', {
      attorney: '__ATTORNEY__',
      when: '__WHEN__',
    })
    const emailTemplate = t('confirm.email', { email: '__EMAIL__' })
    const [scheduledBefore, restAfterAttorney] = scheduledTemplate.split('__ATTORNEY__')
    const [scheduledMiddle, scheduledAfter] = (restAfterAttorney ?? '').split('__WHEN__')
    const [emailBefore, emailAfter] = emailTemplate.split('__EMAIL__')
    return (
      <main className="bk-shell">
        <div className="bk-aurora" aria-hidden />
        <div className="bk-frame">
          <BookTopbar />
          <section className="bk-card bk-confirm" key="done">
            <div className="bk-success">
              <span className="bk-success-ring" aria-hidden />
              <span className="bk-success-check">
                <CheckIcon size={40} />
              </span>
            </div>
            <h1 className="bk-h1">{t('confirm.title')}</h1>
            <p className="bk-confirm-line">
              {scheduledBefore}
              <strong>Juan Carlos Pacheco</strong>
              {scheduledMiddle}
              <strong>{whenStr}</strong>
              {scheduledAfter}
            </p>
            <p className="bk-sub">
              {emailBefore}
              <strong>{contact.email}</strong>
              {emailAfter}
            </p>
            <div className="bk-matter-ref">
              {t('confirm.matter_ref')} <code>{confirmation.matterNumber}</code>
            </div>
            <Link href="/" className="bk-btn bk-btn-ghost bk-btn-wide">
              {t('confirm.back')}
            </Link>
          </section>
        </div>
      </main>
    )
  }

  const stepTitle =
    step === 'service'
      ? t('header.service')
      : step === 'contact'
        ? t('contact.heading')
        : step === 'intake'
          ? t('intake.heading')
          : t('slot.heading')
  const stepSubtitle =
    step === 'service'
      ? t('service.subtitle')
      : step === 'contact'
        ? t('contact.subtitle')
        : step === 'intake'
          ? t('intake.subtitle')
          : t('slot.subtitle')

  return (
    <main className="bk-shell">
      <div className="bk-aurora" aria-hidden />
      <div className="bk-frame">
        <BookTopbar />
        <BookProgress step={step} />

        <section className="bk-card">
          {/* key={step} remounts the stage so each step animates in cleanly */}
          <div className="bk-stage" key={step}>
            <div className="bk-stage-head">
              <h1 className="bk-h1">{stepTitle}</h1>
              <p className="bk-sub">{stepSubtitle}</p>
            </div>

            {error && (
              <div className="bk-alert" role="alert">
                {error}
              </div>
            )}

            {step === 'service' && (
              <>
                {services === null ? (
                  <div className="bk-loading">
                    <span className="bk-spinner" />
                    {t('service.loading')}
                  </div>
                ) : (
                  <div className="bk-service-grid">
                    {services.map((s) => {
                      const selected = selectedServiceKey === s.serviceKey
                      return (
                        <button
                          key={s.serviceKey}
                          type="button"
                          className={`bk-service-card ${selected ? 'selected' : ''}`}
                          aria-pressed={selected}
                          onClick={() => setSelectedServiceKey(s.serviceKey)}
                        >
                          <span className="bk-service-icon">
                            <ServiceIcon serviceKey={s.serviceKey} />
                          </span>
                          <span className="bk-service-text">
                            <span className="bk-service-title">
                              {t(`service.${s.serviceKey}.title`, undefined, s.displayName)}
                            </span>
                            <span className="bk-service-desc">
                              {t(`service.${s.serviceKey}.desc`, undefined, s.description ?? '')}
                            </span>
                          </span>
                          <span className="bk-service-tick" aria-hidden>
                            <CheckIcon size={14} />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
                <div className="bk-actions">
                  <button
                    className="bk-btn bk-btn-primary bk-btn-wide"
                    onClick={advanceFromService}
                    disabled={!selectedServiceKey}
                  >
                    {t('common.continue')}
                    <ArrowRightIcon size={18} />
                  </button>
                </div>
              </>
            )}

            {step === 'contact' && (
              <>
                <div className="bk-fields">
                  <ContactField
                    label={t('contact.name')}
                    icon={<UserIcon size={18} />}
                    value={contact.fullName}
                    onChange={(v) => setContact((p) => ({ ...p, fullName: v }))}
                    autoComplete="name"
                  />
                  <ContactField
                    label={t('contact.email')}
                    icon={<MailIcon size={18} />}
                    type="email"
                    inputMode="email"
                    value={contact.email}
                    onChange={(v) => setContact((p) => ({ ...p, email: v }))}
                    autoComplete="email"
                  />
                  <div className="bk-field">
                    <span className="bk-label">{t('contact.phone')}</span>
                    <div className="bk-input-wrap bk-phone-wrap">
                      <PhoneInput
                        international
                        defaultCountry="US"
                        value={contact.phone}
                        onChange={(v) => setContact((prev) => ({ ...prev, phone: v ?? '' }))}
                        className="phone-input"
                      />
                    </div>
                  </div>
                  <ContactField
                    label={t('contact.company')}
                    icon={<BriefcaseIcon size={18} />}
                    value={contact.companyName}
                    onChange={(v) => setContact((p) => ({ ...p, companyName: v }))}
                    autoComplete="organization"
                  />
                  <ContactField
                    label={t('contact.source')}
                    icon={<MegaphoneIcon size={18} />}
                    value={contact.attributionSource}
                    onChange={(v) => setContact((p) => ({ ...p, attributionSource: v }))}
                  />
                </div>
                <div className="bk-actions">
                  {!presetServiceKey && (
                    <button className="bk-btn bk-btn-ghost" onClick={() => setStep('service')}>
                      <ChevronLeftIcon size={18} />
                      {t('common.back')}
                    </button>
                  )}
                  <button
                    className="bk-btn bk-btn-primary bk-btn-grow"
                    onClick={advanceFromContact}
                  >
                    {t('common.continue')}
                    <ArrowRightIcon size={18} />
                  </button>
                </div>
              </>
            )}

            {step === 'intake' && selectedService && (
              <>
                <div className="bk-sections">
                  {selectedService.intakeSchema.sections.map((section) => (
                    <div key={section.id} className="bk-section">
                      <h3 className="bk-section-title">
                        {t(`section.${section.id}.title`, undefined, section.title)}
                      </h3>
                      <div className="bk-fields">
                        {section.fields.map((field) => (
                          <FieldRenderer
                            key={field.id}
                            field={field}
                            responses={intakeResponses}
                            setResponses={setIntakeResponses}
                            members={members}
                            setMembers={setMembers}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bk-actions">
                  <button className="bk-btn bk-btn-ghost" onClick={() => setStep('contact')}>
                    <ChevronLeftIcon size={18} />
                    {t('common.back')}
                  </button>
                  <button className="bk-btn bk-btn-primary bk-btn-grow" onClick={advanceFromIntake}>
                    {t('common.continue')}
                    <ArrowRightIcon size={18} />
                  </button>
                </div>
              </>
            )}

            {step === 'slot' && (
              <>
                {slotsSource === 'stub' && <div className="bk-notice">{t('slot.stub_notice')}</div>}
                {slots === null ? (
                  <div className="bk-loading">
                    <span className="bk-spinner" />
                    {t('slot.loading')}
                  </div>
                ) : slots.length === 0 ? (
                  <p className="bk-empty">{t('slot.none')}</p>
                ) : (
                  <AvailabilityCalendar
                    slots={slots}
                    live={slotsSource !== 'stub'}
                    selectedStartIso={selectedSlot?.startIso ?? null}
                    onSelect={setSelectedSlot}
                    lastUpdated={slotsLastUpdated}
                    refreshing={slotsRefreshing}
                    onRefresh={() =>
                      fetchSlots(horizonDays, { serviceKey: selectedServiceKey ?? undefined })
                    }
                    loadingMoreWeeks={loadingMoreWeeks}
                    onLoadMoreWeeks={async () => {
                      setLoadingMoreWeeks(true)
                      const next = horizonDays + HORIZON_INCREMENT_DAYS
                      setHorizonDays(next)
                      await fetchSlots(next, {
                        silent: true,
                        serviceKey: selectedServiceKey ?? undefined,
                      })
                      setLoadingMoreWeeks(false)
                    }}
                  />
                )}

                {selectedSlot && (
                  <div className="bk-selected" aria-live="polite">
                    <span className="bk-selected-icon">
                      <ClockIcon size={18} />
                    </span>
                    <span className="bk-selected-text">
                      <span className="bk-selected-label">{t('slot.selected_label')}</span>
                      <span className="bk-selected-value">
                        {new Date(selectedSlot.startIso).toLocaleString(
                          lang === 'es' ? 'es-US' : undefined,
                          {
                            weekday: 'long',
                            month: 'long',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          },
                        )}
                      </span>
                    </span>
                  </div>
                )}

                {TURNSTILE_SITE_KEY && (
                  <div className="bk-captcha" aria-live="polite">
                    <Turnstile
                      siteKey={TURNSTILE_SITE_KEY}
                      onToken={setCaptchaToken}
                      onReady={(reset) => {
                        resetCaptchaRef.current = reset
                      }}
                    />
                  </div>
                )}
                <div className="bk-actions">
                  <button className="bk-btn bk-btn-ghost" onClick={() => setStep('intake')}>
                    <ChevronLeftIcon size={18} />
                    {t('common.back')}
                  </button>
                  <button
                    className="bk-btn bk-btn-primary bk-btn-grow"
                    disabled={
                      !selectedSlot ||
                      busy === 'submit' ||
                      (Boolean(TURNSTILE_SITE_KEY) && !captchaToken)
                    }
                    onClick={submitBooking}
                  >
                    {busy === 'submit' && <span className="bk-spinner bk-spinner-sm" />}
                    {busy === 'submit' ? t('slot.booking') : t('slot.confirm')}
                    {busy !== 'submit' && <CheckIcon size={18} />}
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        <p className="bk-secure">
          <LockIcon size={14} />
          {t('book.secure')}
        </p>
      </div>
    </main>
  )
}

function BookTopbar() {
  return (
    <header className="bk-topbar">
      <div className="bk-brand">
        <span className="bk-brand-mark">
          <ScaleIcon size={18} />
        </span>
        <span className="bk-brand-name">Pacheco Law</span>
      </div>
      <LanguageToggle />
    </header>
  )
}

function BookProgress({ step }: { step: Step }) {
  const { t } = useI18n()
  const idx = PROGRESS_STEPS.findIndex((s) => s.key === step)
  const safeIdx = idx < 0 ? 0 : idx
  const railPct = (safeIdx / (PROGRESS_STEPS.length - 1)) * 100
  const mobilePct = ((safeIdx + 1) / PROGRESS_STEPS.length) * 100
  const current = PROGRESS_STEPS[safeIdx]

  return (
    <nav
      className="bk-progress"
      aria-label={t('progress.step_of', { n: safeIdx + 1, total: PROGRESS_STEPS.length })}
    >
      <div className="bk-progress-mobile">
        <div className="bk-progress-mobile-row">
          <span className="bk-progress-step">
            {t('progress.step_of', { n: safeIdx + 1, total: PROGRESS_STEPS.length })}
          </span>
          <span className="bk-progress-current">{current ? t(current.labelKey) : ''}</span>
        </div>
        <div className="bk-progress-bar">
          <div className="bk-progress-bar-fill" style={{ width: `${mobilePct}%` }} />
        </div>
      </div>

      <ol className="bk-progress-rail">
        <div className="bk-progress-rail-track" aria-hidden>
          <div className="bk-progress-rail-fill" style={{ width: `${railPct}%` }} />
        </div>
        {PROGRESS_STEPS.map((s, i) => {
          const state = i < safeIdx ? 'done' : i === safeIdx ? 'current' : 'upcoming'
          return (
            <li key={s.key} className={`bk-progress-node ${state}`}>
              <span className="bk-progress-dot">
                {i < safeIdx ? <CheckIcon size={14} /> : i + 1}
              </span>
              <span className="bk-progress-label">{t(s.labelKey)}</span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function ContactField({
  label,
  icon,
  value,
  onChange,
  type = 'text',
  inputMode,
  autoComplete,
}: {
  label: string
  icon: React.ReactNode
  value: string
  onChange: (v: string) => void
  type?: string
  inputMode?: 'email' | 'text' | 'tel'
  autoComplete?: string
}) {
  const id = useId()
  return (
    <div className="bk-field">
      <label className="bk-label" htmlFor={id}>
        {label}
      </label>
      <div className="bk-input-wrap">
        <span className="bk-input-icon" aria-hidden>
          {icon}
        </span>
        <input
          id={id}
          className="bk-input"
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}

// Sentinel stored as a field's answer when the client checks "I don't know" on a
// field whose schema sets allow_unknown (WP2.4). It counts as an answer, so a
// required field is satisfied; the attorney sees the client explicitly didn't know.
const UNKNOWN_ANSWER = '__unknown__'

function FieldRenderer({
  field,
  responses,
  setResponses,
  members,
  setMembers,
}: {
  field: ServiceField
  responses: Record<string, unknown>
  setResponses: React.Dispatch<React.SetStateAction<Record<string, unknown>>>
  members: MemberRow[]
  setMembers: React.Dispatch<React.SetStateAction<MemberRow[]>>
}) {
  const { t } = useI18n()
  const fieldId = useId()
  const value = responses[field.id]
  const set = (v: unknown) => setResponses((prev) => ({ ...prev, [field.id]: v }))
  const fieldLabel = t(`field.${field.id}.label`, undefined, field.label)
  const isUnknown = value === UNKNOWN_ANSWER
  const unknownToggle = field.allow_unknown ? (
    <label className="bk-checkbox bk-unknown">
      <input
        type="checkbox"
        checked={isUnknown}
        onChange={(e) => set(e.target.checked ? UNKNOWN_ANSWER : '')}
      />
      <span>{t('field.unknown', undefined, "I don't know")}</span>
    </label>
  ) : null

  if (field.type === 'members_repeater') {
    return (
      <div className="bk-field bk-field-wide">
        <span className="bk-label">
          <UsersIcon size={15} />
          {fieldLabel}
          {field.required ? <em className="bk-req">*</em> : ''}
        </span>
        {members.map((m, idx) => (
          <fieldset key={m.id} className="bk-member">
            <legend className="bk-member-legend">{t('member.label', { n: idx + 1 })}</legend>
            <div className="bk-member-grid">
              <div className="bk-field">
                <label className="bk-label">{t('member.fullname')}</label>
                <input
                  className="bk-input bk-input-bare"
                  value={m.name}
                  onChange={(e) =>
                    setMembers((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)),
                    )
                  }
                />
              </div>
              <div className="bk-field">
                <label className="bk-label">{t('member.capital')}</label>
                <input
                  className="bk-input bk-input-bare"
                  type="number"
                  inputMode="decimal"
                  value={m.capital_contribution}
                  onChange={(e) =>
                    setMembers((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, capital_contribution: e.target.value } : x,
                      ),
                    )
                  }
                />
              </div>
              <div className="bk-field">
                <label className="bk-label">{t('member.ownership')}</label>
                <input
                  className="bk-input bk-input-bare"
                  type="number"
                  inputMode="decimal"
                  value={m.ownership_percentage}
                  onChange={(e) =>
                    setMembers((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, ownership_percentage: e.target.value } : x,
                      ),
                    )
                  }
                />
              </div>
              <label className="bk-checkbox">
                <input
                  type="checkbox"
                  checked={m.is_manager}
                  onChange={(e) =>
                    setMembers((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, is_manager: e.target.checked } : x)),
                    )
                  }
                />
                <span>{t('member.manager')}</span>
              </label>
            </div>
            <AddressAutocomplete
              label={t('member.address')}
              required
              value={m.address}
              onChange={(addr) =>
                setMembers((prev) => prev.map((x, i) => (i === idx ? { ...x, address: addr } : x)))
              }
            />
            {members.length > 1 && (
              <button
                type="button"
                className="bk-member-remove"
                onClick={() => setMembers((prev) => prev.filter((_, i) => i !== idx))}
              >
                {t('member.remove')}
              </button>
            )}
          </fieldset>
        ))}
        <button
          type="button"
          className="bk-btn bk-btn-soft bk-member-add"
          onClick={() => setMembers((prev) => [...prev, emptyMember()])}
        >
          {t('member.add')}
        </button>
      </div>
    )
  }

  if (field.type === 'address_autocomplete') {
    return (
      <div className="bk-field bk-field-wide">
        <AddressAutocomplete
          label={fieldLabel}
          required={field.required}
          value={(value as StructuredAddress) ?? null}
          onChange={(addr) => set(addr)}
        />
      </div>
    )
  }

  if (field.type === 'select' && field.options) {
    return (
      <div className="bk-field">
        <label htmlFor={fieldId} className="bk-label">
          {fieldLabel}
          {field.required ? <em className="bk-req">*</em> : ''}
        </label>
        <select
          id={fieldId}
          className="bk-input bk-select"
          value={isUnknown ? '' : typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.target.value)}
          required={field.required && !isUnknown}
          disabled={isUnknown}
        >
          <option value="">{t('select.choose')}</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {t(`option.${opt}`, undefined, opt.replace(/_/g, ' '))}
            </option>
          ))}
        </select>
        {unknownToggle}
      </div>
    )
  }

  if (field.type === 'textarea') {
    return (
      <div className="bk-field bk-field-wide">
        <label htmlFor={fieldId} className="bk-label">
          {fieldLabel}
          {field.required ? <em className="bk-req">*</em> : ''}
        </label>
        <textarea
          id={fieldId}
          className="bk-input bk-textarea"
          value={isUnknown ? '' : typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.target.value)}
          rows={4}
          required={field.required && !isUnknown}
          disabled={isUnknown}
        />
        {unknownToggle}
      </div>
    )
  }

  const inputType = field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'
  return (
    <div className="bk-field">
      <label htmlFor={fieldId} className="bk-label">
        {fieldLabel}
        {field.required ? <em className="bk-req">*</em> : ''}
      </label>
      <input
        id={fieldId}
        className="bk-input bk-input-bare"
        type={inputType}
        inputMode={field.type === 'number' ? 'decimal' : undefined}
        value={
          isUnknown
            ? ''
            : typeof value === 'string' || typeof value === 'number'
              ? String(value)
              : ''
        }
        onChange={(e) => set(e.target.value)}
        required={field.required && !isUnknown}
        disabled={isUnknown}
      />
      {unknownToggle}
    </div>
  )
}
