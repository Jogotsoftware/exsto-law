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
  options?: string[]
  help?: string
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

  const fetchSlots = useCallback(async (daysOut: number, opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setSlotsRefreshing(true)
    try {
      const r = await callClientMcp<{
        slots: CalendarSlot[]
        source: 'google' | 'stub'
        reason?: string
      }>({
        toolName: 'legal.calendar.availability',
        input: { daysOut },
      })
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
      if (!opts.silent) setSlotsRefreshing(false)
    }
  }, [])

  // Initial slot load + 60s background refresh while on the slot step.
  useEffect(() => {
    fetchSlots(horizonDays, { silent: slots !== null })
  }, [horizonDays, fetchSlots])

  useEffect(() => {
    if (step !== 'slot') return
    const id = setInterval(() => fetchSlots(horizonDays, { silent: true }), REFRESH_MS)
    return () => clearInterval(id)
  }, [step, horizonDays, fetchSlots])

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
        void fetchSlots(horizonDays)
      } else {
        setError(raw)
      }
    } finally {
      setBusy(null)
    }
  }

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
      <main className="book-main">
        <div className="book-lang-bar">
          <LanguageToggle />
        </div>
        <div className="confirm-card">
          <div className="check-mark">✓</div>
          <h1>{t('confirm.title')}</h1>
          <p style={{ fontSize: '1.05rem', color: '#374151' }}>
            {scheduledBefore}
            <strong>Juan Carlos Pacheco</strong>
            {scheduledMiddle}
            <strong>{whenStr}</strong>
            {scheduledAfter}
          </p>
          <p style={{ color: 'var(--muted)' }}>
            {emailBefore}
            <strong>{contact.email}</strong>
            {emailAfter}
          </p>
          <p style={{ marginTop: '2rem', color: 'var(--muted)', fontSize: '0.88rem' }}>
            {t('confirm.matter_ref')} <code>{confirmation.matterNumber}</code>
          </p>
          <Link href="/">
            <button>{t('confirm.back')}</button>
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="book-main">
      <div className="book-lang-bar">
        <LanguageToggle />
      </div>
      <Stepper step={step} />

      {step === 'service' && (
        <header className="book-header">
          <h1>{t('header.service')}</h1>
        </header>
      )}
      {step !== 'service' && (
        <header className="book-header">
          <h1>{t('header.book')}</h1>
        </header>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {step === 'service' && (
        <section>
          {services === null && (
            <div className="loading-block">
              <span className="spinner" />
              {t('service.loading')}
            </div>
          )}
          {services && (
            <div className="service-list">
              {services.map((s) => (
                <label
                  key={s.serviceKey}
                  className={`service-card ${selectedServiceKey === s.serviceKey ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="service"
                    value={s.serviceKey}
                    checked={selectedServiceKey === s.serviceKey}
                    onChange={() => setSelectedServiceKey(s.serviceKey)}
                  />
                  <div>
                    <div className="service-title">
                      {t(`service.${s.serviceKey}.title`, undefined, s.displayName)}
                    </div>
                    {s.description && (
                      <div className="service-desc">
                        {t(`service.${s.serviceKey}.desc`, undefined, s.description)}
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
          <div className="step-actions sticky">
            <button
              className="primary full"
              onClick={advanceFromService}
              disabled={!selectedServiceKey}
            >
              {t('common.continue')}
            </button>
          </div>
        </section>
      )}

      {step === 'contact' && (
        <section>
          <h2>{t('contact.heading')}</h2>
          <label>
            <span>{t('contact.name')}</span>
            <input
              value={contact.fullName}
              onChange={(e) => setContact((prev) => ({ ...prev, fullName: e.target.value }))}
              required
              autoComplete="name"
            />
          </label>
          <label>
            <span>{t('contact.email')}</span>
            <input
              type="email"
              value={contact.email}
              onChange={(e) => setContact((prev) => ({ ...prev, email: e.target.value }))}
              required
              autoComplete="email"
              inputMode="email"
            />
          </label>
          <label>
            <span>{t('contact.phone')}</span>
            <PhoneInput
              international
              defaultCountry="US"
              value={contact.phone}
              onChange={(v) => setContact((prev) => ({ ...prev, phone: v ?? '' }))}
              className="phone-input"
            />
          </label>
          <label>
            <span>{t('contact.company')}</span>
            <input
              value={contact.companyName}
              onChange={(e) => setContact((prev) => ({ ...prev, companyName: e.target.value }))}
              autoComplete="organization"
            />
          </label>
          <label>
            <span>{t('contact.source')}</span>
            <input
              value={contact.attributionSource}
              onChange={(e) =>
                setContact((prev) => ({ ...prev, attributionSource: e.target.value }))
              }
              required
            />
          </label>
          <div className="step-actions sticky">
            {!presetServiceKey && (
              <button onClick={() => setStep('service')}>{t('common.back')}</button>
            )}
            <button className="primary full" onClick={advanceFromContact}>
              {t('common.continue')}
            </button>
          </div>
        </section>
      )}

      {step === 'intake' && selectedService && (
        <section>
          <h2>{t('intake.heading')}</h2>
          {selectedService.intakeSchema.sections.map((section) => (
            <div key={section.id} className="intake-section">
              <h3>{t(`section.${section.id}.title`, undefined, section.title)}</h3>
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
          ))}
          <div className="step-actions sticky">
            <button onClick={() => setStep('contact')}>{t('common.back')}</button>
            <button className="primary full" onClick={advanceFromIntake}>
              {t('common.continue')}
            </button>
          </div>
        </section>
      )}

      {step === 'slot' && (
        <section>
          <h2>{t('slot.heading')}</h2>
          {slotsSource === 'stub' && (
            <div
              style={{
                background: 'var(--warn-soft)',
                border: '1px solid #fcd34d',
                color: '#92400e',
                padding: '0.6rem 0.85rem',
                borderRadius: 8,
                fontSize: '0.88rem',
                marginBottom: '0.85rem',
              }}
            >
              {t('slot.stub_notice')}
            </div>
          )}
          {slots === null ? (
            <div className="loading-block">
              <span className="spinner" />
              {t('slot.loading')}
            </div>
          ) : slots.length === 0 ? (
            <p>{t('slot.none')}</p>
          ) : (
            <AvailabilityCalendar
              slots={slots}
              selectedStartIso={selectedSlot?.startIso ?? null}
              onSelect={setSelectedSlot}
              lastUpdated={slotsLastUpdated}
              refreshing={slotsRefreshing}
              onRefresh={() => fetchSlots(horizonDays)}
              loadingMoreWeeks={loadingMoreWeeks}
              onLoadMoreWeeks={async () => {
                setLoadingMoreWeeks(true)
                const next = horizonDays + HORIZON_INCREMENT_DAYS
                setHorizonDays(next)
                await fetchSlots(next, { silent: true })
                setLoadingMoreWeeks(false)
              }}
            />
          )}
          {TURNSTILE_SITE_KEY && (
            <div className="captcha-block" aria-live="polite">
              <Turnstile
                siteKey={TURNSTILE_SITE_KEY}
                onToken={setCaptchaToken}
                onReady={(reset) => {
                  resetCaptchaRef.current = reset
                }}
              />
            </div>
          )}
          <div className="step-actions sticky">
            <button onClick={() => setStep('intake')}>{t('common.back')}</button>
            <button
              className="primary full"
              disabled={
                !selectedSlot || busy === 'submit' || (Boolean(TURNSTILE_SITE_KEY) && !captchaToken)
              }
              onClick={submitBooking}
            >
              {busy === 'submit' && <span className="spinner" />}
              {busy === 'submit' ? t('slot.booking') : t('slot.confirm')}
            </button>
          </div>
        </section>
      )}
    </main>
  )
}

function Stepper({ step }: { step: Step }) {
  const { t } = useI18n()
  const steps: Array<{ key: Step; labelKey: string }> = [
    { key: 'service', labelKey: 'step.service' },
    { key: 'contact', labelKey: 'step.contact' },
    { key: 'intake', labelKey: 'step.intake' },
    { key: 'slot', labelKey: 'step.time' },
  ]
  const idx = steps.findIndex((s) => s.key === step)
  return (
    <div className="stepper">
      {steps.map((s, i) => (
        <div
          key={s.key}
          className={`stepper-step ${i <= idx ? 'active' : ''} ${i === idx ? 'current' : ''}`}
        >
          {t(s.labelKey)}
        </div>
      ))}
    </div>
  )
}

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

  if (field.type === 'members_repeater') {
    return (
      <div>
        <label>
          <span>
            {fieldLabel}
            {field.required ? ' *' : ''}
          </span>
        </label>
        {members.map((m, idx) => (
          <fieldset key={m.id} className="member-row">
            <legend>{t('member.label', { n: idx + 1 })}</legend>
            <div className="member-grid">
              <label>
                <span>{t('member.fullname')}</span>
                <input
                  value={m.name}
                  onChange={(e) =>
                    setMembers((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)),
                    )
                  }
                  required
                />
              </label>
              <label>
                <span>{t('member.capital')}</span>
                <input
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
              </label>
              <label>
                <span>{t('member.ownership')}</span>
                <input
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
              </label>
              <label className="member-manager">
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
                className="member-remove"
                onClick={() => setMembers((prev) => prev.filter((_, i) => i !== idx))}
              >
                {t('member.remove')}
              </button>
            )}
          </fieldset>
        ))}
        <button type="button" onClick={() => setMembers((prev) => [...prev, emptyMember()])}>
          {t('member.add')}
        </button>
      </div>
    )
  }

  if (field.type === 'address_autocomplete') {
    return (
      <AddressAutocomplete
        label={fieldLabel}
        required={field.required}
        value={(value as StructuredAddress) ?? null}
        onChange={(addr) => set(addr)}
      />
    )
  }

  const helpText = field.help ? t(`field.${field.id}.help`, undefined, field.help) : null

  if (field.type === 'select' && field.options) {
    return (
      <label htmlFor={fieldId}>
        <span>
          {fieldLabel}
          {field.required ? ' *' : ''}
        </span>
        <select
          id={fieldId}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.target.value)}
          required={field.required}
        >
          <option value="">{t('select.choose')}</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {t(`option.${opt}`, undefined, opt.replace(/_/g, ' '))}
            </option>
          ))}
        </select>
        {helpText && <div className="help">{helpText}</div>}
      </label>
    )
  }

  if (field.type === 'textarea') {
    return (
      <label htmlFor={fieldId}>
        <span>
          {fieldLabel}
          {field.required ? ' *' : ''}
        </span>
        <textarea
          id={fieldId}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.target.value)}
          rows={4}
          required={field.required}
        />
        {helpText && <div className="help">{helpText}</div>}
      </label>
    )
  }

  const inputType = field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'
  return (
    <label htmlFor={fieldId}>
      <span>
        {fieldLabel}
        {field.required ? ' *' : ''}
      </span>
      <input
        id={fieldId}
        type={inputType}
        inputMode={field.type === 'number' ? 'decimal' : undefined}
        value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
        onChange={(e) => set(e.target.value)}
        required={field.required}
      />
      {helpText && <div className="help">{helpText}</div>}
    </label>
  )
}
