'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { callClientMcp } from '@/lib/mcpClient'
import { callClientPortalMcp } from '@/lib/mcpClientPortal'
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
  // BUILDER-UX-2 WP-7 — locale variants of the client-facing text, keyed by locale
  // ('es'). options_i18n is a locale → parallel-array map (same order as options).
  // A missing locale/field ALWAYS falls back to the English text — never blank.
  label_i18n?: Record<string, string>
  placeholder_i18n?: Record<string, string>
  options_i18n?: Record<string, string[]>
  // 1.1 WP5 — attorney-filled / system-filled field. Present in the schema so the
  // document's {{token}} is covered, but NEVER shown to the client on the booking
  // form and never asked of them. The client view filters these out.
  internal?: boolean
}

interface ServiceSection {
  id: string
  title: string
  // WP-7 — locale variants of the section title.
  title_i18n?: Record<string, string>
  fields: ServiceField[]
}

// TODO(UI-BUILDER-FIX-1 Phase 1): clientDisplayName/clientDescription are null for
// services whose client copy hasn't been authored/approved yet — the tile falls
// back to the ATTORNEY-facing displayName/description (jurisdiction-heavy) so
// nothing renders blank. Remove this note once all live services carry client copy.
function tileTitle(
  s: Service,
  lang: string,
  t: (k: string, v?: undefined, f?: string) => string,
): string {
  // WP-7: the stored locale variant wins; then the English client copy; then the
  // static translation map; then the attorney-facing name. Never blank, never a key.
  return (
    s.clientCopyI18n?.[lang]?.displayName ??
    s.clientDisplayName ??
    t(`service.${s.serviceKey}.title`, undefined, s.displayName)
  )
}
function tileDesc(
  s: Service,
  lang: string,
  t: (k: string, v?: undefined, f?: string) => string,
): string {
  return (
    s.clientCopyI18n?.[lang]?.description ??
    s.clientDescription ??
    t(`service.${s.serviceKey}.desc`, undefined, s.description ?? '')
  )
}

// WP-7 — questionnaire text with stored locale variants (fall back to the static
// translation map, then the English schema text).
function fieldLabelOf(
  field: ServiceField,
  lang: string,
  t: (k: string, v?: undefined, f?: string) => string,
): string {
  return field.label_i18n?.[lang] ?? t(`field.${field.id}.label`, undefined, field.label)
}
function optionLabelOf(
  field: ServiceField,
  opt: string,
  lang: string,
  t: (k: string, v?: undefined, f?: string) => string,
): string {
  const i = field.options?.indexOf(opt) ?? -1
  return (
    (i >= 0 ? field.options_i18n?.[lang]?.[i] : undefined) ??
    t(`option.${opt}`, undefined, opt.replace(/_/g, ' '))
  )
}

interface Service {
  id: string
  serviceKey: string
  displayName: string
  description: string | null
  clientDisplayName: string | null
  clientDescription: string | null
  clientCopyI18n?: Record<string, { displayName?: string; description?: string }> | null
  intakeSchema: { sections: ServiceSection[] }
  // False = intake-only (document-review style): no slot step, submit happens
  // on the intake step, no consultation on the confirmation screen.
  appointmentRequired: boolean
  // MACHINE-COMMS-1: true only when the service is active AND has an authored
  // lifecycle. Non-bookable services are never offered on this page.
  bookable: boolean
}

type Step = 'service' | 'contact' | 'intake' | 'slot' | 'account' | 'done'

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

// A file staged through /api/client/intake/uploads for a file_upload field.
// The token is the ONLY handle on the stored object (opaque, HMAC-signed);
// filename/size are echoed back purely for display. Keyed by field id in the
// wizard's stagedUploads state; the tokens ride the submit as stagedUploads[].
interface StagedFile {
  token: string
  filename: string
  sizeBytes: number
}

const INITIAL_HORIZON_DAYS = 60
const HORIZON_INCREMENT_DAYS = 28
const REFRESH_MS = 60_000

const PROGRESS_STEPS: ReadonlyArray<{ key: Exclude<Step, 'done'>; labelKey: string }> = [
  { key: 'service', labelKey: 'progress.service' },
  { key: 'contact', labelKey: 'progress.contact' },
  { key: 'intake', labelKey: 'progress.intake' },
  { key: 'slot', labelKey: 'progress.time' },
  { key: 'account', labelKey: 'progress.account' },
]

// "Something else" (UI-BUILDER-FIX-1 Phase 3): a SYNTHETIC picker tile tied to NO
// workflow_definition. Selecting it runs the same wizard (contact → one free-text
// question) but submits legal.intake.something_else — a client_request for
// attorney triage. No matter opens, no workflow starts.
const SOMETHING_ELSE_KEY = 'something_else'
const SOMETHING_ELSE_TILE: Service = {
  id: SOMETHING_ELSE_KEY,
  serviceKey: SOMETHING_ELSE_KEY,
  displayName: 'Something else',
  description: "Not sure what you need? Tell us and we'll point you the right way.",
  clientDisplayName: null,
  clientDescription: null,
  intakeSchema: {
    sections: [
      {
        id: 'request',
        title: 'Your request',
        fields: [
          {
            id: 'request_text',
            label: 'What do you need help with?',
            type: 'textarea',
            required: true,
          },
        ],
      },
    ],
  },
  // Intake-only shape: no slot step, submit fires from the intake step.
  appointmentRequired: false,
  bookable: true,
}

// PORTAL-1: the signed-in portal identity, when a client session cookie exists.
interface PortalMe {
  email: string
  displayName: string
}

// The fee quote the server computed for the selected service (PORTAL-1 WP3).
interface FeeQuote {
  basis: 'fixed' | 'hourly-rate'
  amount: string | null
  rate: string | null
  currency: string
  description: string
}

// Plain-language services map to a friendly icon; anything unknown gets a doc icon.
function ServiceIcon({ serviceKey, size = 22 }: { serviceKey: string; size?: number }) {
  if (serviceKey === 'other' || serviceKey === SOMETHING_ELSE_KEY)
    return <HelpCircleIcon size={size} />
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

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
  // file_upload answers: files upload immediately (staging), tokens submit later.
  const [stagedUploads, setStagedUploads] = useState<Record<string, StagedFile[]>>({})

  const [slots, setSlots] = useState<CalendarSlot[] | null>(null)
  const [slotsSource, setSlotsSource] = useState<'google' | 'unavailable' | null>(null)
  const [slotsLastUpdated, setSlotsLastUpdated] = useState<Date | null>(null)
  const [slotsRefreshing, setSlotsRefreshing] = useState(false)
  const [horizonDays, setHorizonDays] = useState(INITIAL_HORIZON_DAYS)
  const [loadingMoreWeeks, setLoadingMoreWeeks] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<CalendarSlot | null>(null)

  const [step, setStep] = useState<Step>('service')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // PORTAL-1: signed-in clients skip the contact step AND the account gate —
  // identity comes from the session; the submit runs through the authed portal
  // endpoint attributed to their own actor. undefined = still checking.
  const [portalMe, setPortalMe] = useState<PortalMe | null | undefined>(undefined)
  useEffect(() => {
    fetch('/api/client/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) =>
        setPortalMe(
          me && typeof me.email === 'string'
            ? { email: me.email, displayName: me.displayName ?? me.email }
            : null,
        ),
      )
      .catch(() => setPortalMe(null))
  }, [])
  const signedIn = Boolean(portalMe)

  // The account gate (anonymous flow): password + the fee card.
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [feeQuote, setFeeQuote] = useState<FeeQuote | null>(null)
  const [feeAccepted, setFeeAccepted] = useState(false)

  // CAPTCHA token + a reset handle the widget hands back. Both stay null when
  // the site key is unset (the widget never renders), and the submit flow below
  // only requires/sends a token in that case.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const resetCaptchaRef = useRef<(() => void) | null>(null)
  // A token belongs to the widget instance on the step that hosts it. Any step
  // change unmounts that widget (its expired-callback dies with it), so a
  // retained token would enable submit against a visibly-unsolved widget —
  // drop it and require a fresh solve on the hosting step.
  useEffect(() => {
    setCaptchaToken(null)
    resetCaptchaRef.current = null
  }, [step])
  const [confirmation, setConfirmation] = useState<{
    matterNumber: string
    // Null for intake-only services — the confirmation renders "request
    // received" copy instead of a consultation time.
    scheduledAt: string | null
    // PORTAL-1: true when the intake gate just created their portal account —
    // the confirmation tells them to confirm their email and sign in.
    accountCreated?: boolean
    accountExisted?: boolean
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
      // Only bookable services (active + authored lifecycle) are offered; a
      // non-bookable one is simply excluded, never rendered disabled. A stale
      // ?service= preset pointing at one falls back to the picker via the
      // preset-validation effect below.
      // The "Something else" tile is client-side (tied to no workflow_definition)
      // and always renders LAST, whatever the firm's live services are.
      .then((r) =>
        setServices([...r.services.filter((s) => s.bookable === true), SOMETHING_ELSE_TILE]),
      )
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  // A signed-in client never sees the contact step (the ?service preset jumps
  // there before the session check resolves).
  useEffect(() => {
    if (step === 'contact' && signedIn) setStep('intake')
  }, [step, signedIn])

  // PORTAL-1 (WP4): signed-in intake prefill from what the firm already knows —
  // the client's most recent answers for this service. Merged only into fields
  // the client hasn't touched this session; they edit and confirm before submit.
  const prefilledFor = useRef<string | null>(null)
  useEffect(() => {
    if (!signedIn || step !== 'intake' || !selectedServiceKey) return
    if (prefilledFor.current === selectedServiceKey) return
    prefilledFor.current = selectedServiceKey
    callClientPortalMcp<{ responses: Record<string, unknown> | null }>({
      toolName: 'legal.client.intake_prefill',
      input: { serviceKey: selectedServiceKey },
    })
      .then((r) => {
        if (!r.responses) return
        setIntakeResponses((prev) => ({ ...r.responses, ...prev }))
      })
      .catch(() => undefined)
  }, [signedIn, step, selectedServiceKey])

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
          source: 'google' | 'unavailable'
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
        if (r.source === 'unavailable' && r.reason) {
          // Surface the server-side reason in the browser console so we can
          // diagnose without grepping function logs. The UI shows the honest
          // unavailable state — never fabricated slots.
          console.warn('[availability] calendar unavailable:', r.reason)
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
  // No service chosen yet ⇒ assume the appointment flow (the 4-node rail before
  // services load is cosmetic; it settles once the picker resolves).
  const needsSlot = selectedService ? selectedService.appointmentRequired !== false : true

  function advanceFromService() {
    setError(null)
    if (!selectedServiceKey) {
      setError(t('error.pick_service'))
      return
    }
    // Signed-in clients skip the contact step — the firm already knows them;
    // the server resolves name/email from the session at submit.
    setStep(signedIn ? 'intake' : 'contact')
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
        // WP5: internal (attorney/system-filled) fields are never asked of the client,
        // so they are never client-required — skip them in intake validation.
        if (field.internal) continue
        if (!field.required) continue
        if (field.type === 'members_repeater') {
          if (members.length === 0) return t('error.member_required')
          for (const m of members) {
            if (!m.name.trim()) return t('error.member_name')
            if (!m.address?.formatted_address?.trim()) return t('error.member_address')
          }
          continue
        }
        const label = fieldLabelOf(field, lang, t)
        if (field.type === 'file_upload') {
          // The answer is the staged files themselves, not intakeResponses text.
          if ((stagedUploads[field.id] ?? []).length === 0) {
            return t('error.fill_field', { field: label })
          }
          continue
        }
        if (field.type === 'address_autocomplete') {
          const val = intakeResponses[field.id] as StructuredAddress | undefined
          if (!val?.formatted_address?.trim()) return t('error.fill_field', { field: label })
          continue
        }
        const val = intakeResponses[field.id]
        if (val === UNKNOWN_ANSWER) continue
        if (
          val === undefined ||
          val === null ||
          (typeof val === 'string' && val.trim() === '') ||
          (Array.isArray(val) && val.length === 0)
        ) {
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
    // "Something else" (UI-BUILDER-FIX-1 item 3) is a TRIAGE REQUEST, not a
    // booking: no matter, no workflow — and no account gate (there is nothing
    // to put in a portal yet). It submits straight from this step, captcha-
    // gated by the widget this step hosts for it.
    if (selectedServiceKey === SOMETHING_ELSE_KEY) {
      void submitSomethingElse()
      return
    }
    // Intake-only services have no slot to pick: signed-in clients submit here;
    // new clients go to the account gate (the FINAL step of intake).
    if (!needsSlot) {
      if (signedIn) void submitBooking()
      else void goToAccountGate()
      return
    }
    setStep('slot')
  }

  // "Something else" submit (UI-BUILDER-FIX-1 item 3): a client_request for
  // attorney triage via the public legal.intake.something_else tool. Same
  // captcha discipline as the booking submit; single-use token resets on error.
  async function submitSomethingElse() {
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setError(t('error.captcha'))
      return
    }
    setBusy('submit')
    setError(null)
    try {
      // Signed-in clients skipped the contact step — their portal identity is
      // the requester; the handler dedupes the contact by email either way.
      await callClientMcp<{ requestId: string }>({
        toolName: 'legal.intake.something_else',
        input: {
          clientFullName: (signedIn ? portalMe?.displayName : contact.fullName)?.trim() ?? '',
          clientEmail: (signedIn ? portalMe?.email : contact.email)?.trim() ?? '',
          clientPhone: contact.phone || undefined,
          requestText: String(intakeResponses['request_text'] ?? '').trim(),
        },
        captchaToken: captchaToken ?? undefined,
      })
      // No matter exists — the confirmation renders the "request received" copy
      // and hides the matter reference + portal link.
      setConfirmation({ matterNumber: '', scheduledAt: null })
      setStep('done')
    } catch (err) {
      if (TURNSTILE_SITE_KEY) {
        setCaptchaToken(null)
        resetCaptchaRef.current?.()
      }
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  // PORTAL-1 (WP1): entering the account gate STAGES the intake as a lead first
  // — a client who balks at the password step stays recoverable and queryable.
  // Fire-and-forget: staging failure must not block the funnel (finalize
  // self-heals), and the response's fee quote drives the consent card.
  async function goToAccountGate() {
    setStep('account')
    setFeeAccepted(false)
    try {
      const res = await fetch('/api/client/intake/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientFullName: contact.fullName.trim(),
          clientEmail: contact.email.trim(),
          clientPhone: contact.phone || null,
          clientCompanyName: contact.companyName.trim() || null,
          serviceKey: selectedServiceKey,
          intakeResponses,
        }),
      })
      const data = (await res.json().catch(() => null)) as { quote?: FeeQuote | null } | null
      setFeeQuote(data?.quote ?? null)
    } catch {
      setFeeQuote(null)
    }
  }

  // The intake answers + staged upload tokens the submit sends, shared by both
  // doors (signed-in portal submit and the anonymous intake-gate finalize).
  function buildSubmitPayload() {
    if (!selectedService) return null
    const responsesToSubmit = selectedService.intakeSchema.sections.some((s) =>
      s.fields.some((f) => f.type === 'members_repeater'),
    )
      ? { ...intakeResponses, members: members.map(({ id: _id, ...rest }) => rest) }
      : intakeResponses

    // Staged file tokens for the SELECTED service's file_upload fields only —
    // a file attached while browsing a different service (then abandoned via
    // Back) must never bind to this booking's matter. The server verifies
    // each token and binds the objects to the new matter.
    const fileFieldIds = new Set(
      selectedService.intakeSchema.sections.flatMap((s) =>
        s.fields.filter((f) => f.type === 'file_upload').map((f) => f.id),
      ),
    )
    const stagedTokens = Object.entries(stagedUploads)
      .filter(([fieldId]) => fileFieldIds.has(fieldId))
      .flatMap(([, files]) => files.map((f) => f.token))

    return {
      serviceKey: selectedService.serviceKey,
      intakeResponses: responsesToSubmit,
      // The server REJECTS a slot on an intake-only service — omit both.
      ...(needsSlot && selectedSlot
        ? { scheduledAtIso: selectedSlot.startIso, scheduledEndIso: selectedSlot.endIso }
        : {}),
      stagedUploads: stagedTokens.length > 0 ? stagedTokens : undefined,
    }
  }

  function handleSubmitFailure(raw: string) {
    // A Turnstile token is single-use; any failed submit consumed it, so
    // reset the widget and require a fresh solve before the next attempt.
    if (TURNSTILE_SITE_KEY) {
      setCaptchaToken(null)
      resetCaptchaRef.current?.()
    }
    if (raw.includes('SLOT_TAKEN') || raw.includes('another booking')) {
      // Someone else grabbed this slot between when the calendar was last
      // refreshed and when we hit submit. Translate the error, force a
      // fresh availability fetch, and clear the now-invalid selection so
      // the user has to pick again.
      setError(t('slot.conflict'))
      setSelectedSlot(null)
      setStep('slot')
      void fetchSlots(horizonDays, { serviceKey: selectedServiceKey ?? undefined })
    } else {
      setError(raw)
    }
  }

  // SIGNED-IN submit (PORTAL-1 WP4): the authed portal endpoint books as the
  // client's own actor — no contact step, no account gate, no captcha. A costed
  // service answers 409 FEE_CONSENT_REQUIRED first; the fee card renders and
  // the accepted resubmit records the consent server-side.
  async function submitBooking() {
    if (!selectedService) return
    if (needsSlot && !selectedSlot) return
    const payload = buildSubmitPayload()
    if (!payload) return
    setBusy('submit')
    setError(null)
    try {
      const res = await fetch('/api/client/portal/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, feeAccepted: feeAccepted || undefined }),
      })
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        code?: string
        quote?: FeeQuote
        matterNumber?: string | null
        scheduledAt?: string | null
      } | null
      if (res.status === 409 && data?.code === 'FEE_CONSENT_REQUIRED' && data.quote) {
        // Show the exact cost; nothing proceeds until they accept (law 2).
        setFeeQuote(data.quote)
        setFeeAccepted(false)
        return
      }
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? 'Booking failed.')
      setConfirmation({
        matterNumber: data.matterNumber ?? '—',
        scheduledAt: data.scheduledAt ?? null,
      })
      setStep('done')
    } catch (err) {
      handleSubmitFailure(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  // ANONYMOUS submit (PORTAL-1 WP1): the account gate finalize — account
  // creation + booking are atomic on success; the staged lead survives a balk.
  async function submitWithAccount() {
    if (!selectedService) return
    if (password.length < 8) {
      setError(
        t('account.password_short', undefined, 'Choose a password of at least 8 characters.'),
      )
      return
    }
    if (password !== password2) {
      setError(t('account.password_mismatch', undefined, 'The passwords do not match.'))
      return
    }
    if (feeQuote && !feeAccepted) {
      setError(
        t('account.fee_required', undefined, 'Please review and accept the fee to continue.'),
      )
      return
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setError(t('error.captcha'))
      return
    }
    const payload = buildSubmitPayload()
    if (!payload) return
    setBusy('submit')
    setError(null)
    try {
      const res = await fetch('/api/client/intake/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientFullName: contact.fullName.trim(),
          clientEmail: contact.email.trim(),
          clientPhone: contact.phone || undefined,
          clientCompanyName: contact.companyName.trim() || undefined,
          attributionSource: contact.attributionSource.trim(),
          ...payload,
          password,
          feeAccepted: feeQuote ? feeAccepted : undefined,
          captchaToken: captchaToken ?? undefined,
        }),
      })
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        code?: string
        quote?: FeeQuote
        matterNumber?: string | null
        scheduledAt?: string | null
        accountCreated?: boolean
        accountExisted?: boolean
      } | null
      if (res.status === 409 && data?.code === 'FEE_CONSENT_REQUIRED' && data.quote) {
        setFeeQuote(data.quote)
        setFeeAccepted(false)
        return
      }
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? 'Booking failed.')
      setConfirmation({
        matterNumber: data.matterNumber ?? '—',
        scheduledAt: data.scheduledAt ?? null,
        accountCreated: data.accountCreated,
        accountExisted: data.accountExisted,
      })
      setStep('done')
    } catch (err) {
      handleSubmitFailure(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  // ---- Confirmation screen ------------------------------------------------
  if (step === 'done' && confirmation) {
    const hasSlot = confirmation.scheduledAt !== null
    // whenStr only exists on the has-slot branch (a null date renders "Invalid Date").
    const whenStr = hasSlot
      ? new Date(confirmation.scheduledAt as string).toLocaleString(
          lang === 'es' ? 'es-US' : undefined,
          { dateStyle: 'full', timeStyle: 'short' },
        )
      : ''
    const scheduledTemplate = hasSlot
      ? t('confirm.scheduled', { attorney: '__ATTORNEY__', when: '__WHEN__' })
      : t('confirm.intake_received', { attorney: '__ATTORNEY__' })
    const emailTemplate = hasSlot
      ? t('confirm.email', { email: '__EMAIL__' })
      : t('confirm.email_intake', { email: '__EMAIL__' })
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
            <h1 className="bk-h1">{hasSlot ? t('confirm.title') : t('confirm.title_intake')}</h1>
            <p className="bk-confirm-line">
              {scheduledBefore}
              <strong>Juan Carlos Pacheco</strong>
              {scheduledMiddle}
              {hasSlot && <strong>{whenStr}</strong>}
              {scheduledAfter}
            </p>
            <p className="bk-sub">
              {emailBefore}
              <strong>{contact.email}</strong>
              {emailAfter}
            </p>
            {/* No matter reference on a "Something else" triage request (item 3):
                nothing was booked, so an empty matterNumber hides the block. */}
            {confirmation.matterNumber && (
              <div className="bk-matter-ref">
                {t('confirm.matter_ref')} <code>{confirmation.matterNumber}</code>
              </div>
            )}
            {confirmation.accountCreated && (
              <p className="bk-sub">
                {t(
                  'confirm.account_created',
                  undefined,
                  'Your client portal account is ready — check your email for a confirmation link, then sign in to track this matter, read documents, and pay invoices.',
                )}
              </p>
            )}
            {confirmation.accountExisted && (
              <p className="bk-sub">
                {t(
                  'confirm.account_existed',
                  undefined,
                  'This booking is linked to your existing portal account — sign in with your usual password.',
                )}
              </p>
            )}
            {/* A triage request creates no matter/portal — only link the portal
                when something was actually booked. */}
            {confirmation.matterNumber && (
              <Link href="/portal" className="bk-btn bk-btn-primary bk-btn-wide">
                {t('confirm.portal', undefined, 'Open your client portal')}
              </Link>
            )}
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
          : step === 'account'
            ? t('account.heading', undefined, 'Create your account')
            : t('slot.heading')
  const stepSubtitle =
    step === 'service'
      ? t('service.subtitle')
      : step === 'contact'
        ? t('contact.subtitle')
        : step === 'intake'
          ? t('intake.subtitle')
          : step === 'account'
            ? t(
                'account.subtitle',
                undefined,
                'Everything about your matter will live in your secure portal.',
              )
            : t('slot.subtitle')

  return (
    <main className="bk-shell">
      <div className="bk-aurora" aria-hidden />
      <div className="bk-frame">
        <BookTopbar />
        <BookProgress
          step={step}
          steps={PROGRESS_STEPS.filter(
            (s) =>
              (needsSlot || s.key !== 'slot') &&
              // Signed-in clients skip the contact step and the account gate.
              (!signedIn || (s.key !== 'contact' && s.key !== 'account')) &&
              // "Something else" (item 3) is a triage request — no account gate.
              (selectedServiceKey !== SOMETHING_ELSE_KEY || s.key !== 'account'),
          )}
        />

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
                {portalMe === null && (
                  <div className="bk-notice" role="note">
                    {t('funnel.existing', undefined, 'Already working with us?')}{' '}
                    <a href="/portal/login?next=%2Fbook" style={{ fontWeight: 600 }}>
                      {t('funnel.signin', undefined, 'Sign in to your client portal')}
                    </a>{' '}
                    {t(
                      'funnel.existing_tail',
                      undefined,
                      'to book with your details prefilled — or continue below if you are new here.',
                    )}
                  </div>
                )}
                {portalMe && (
                  <div className="bk-notice" role="note">
                    {t('funnel.signedin', undefined, 'Booking as')}{' '}
                    <strong>{portalMe.displayName}</strong> ({portalMe.email}) ·{' '}
                    <a href="/portal" style={{ fontWeight: 600 }}>
                      {t('funnel.portal', undefined, 'Go to your portal')}
                    </a>
                  </div>
                )}
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
                            <span className="bk-service-title">{tileTitle(s, lang, t)}</span>
                            <span className="bk-service-desc">{tileDesc(s, lang, t)}</span>
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
                  {selectedService.intakeSchema.sections
                    // WP5: a section whose fields are ALL internal (attorney/system-
                    // filled) never shows on the client booking form.
                    .filter((section) => section.fields.some((f) => !f.internal))
                    .map((section) => (
                      <div key={section.id} className="bk-section">
                        <h3 className="bk-section-title">
                          {section.title_i18n?.[lang] ??
                            t(`section.${section.id}.title`, undefined, section.title)}
                        </h3>
                        <div className="bk-fields">
                          {section.fields
                            .filter((field) => !field.internal)
                            .map((field) => (
                              <FieldRenderer
                                key={field.id}
                                field={field}
                                responses={intakeResponses}
                                setResponses={setIntakeResponses}
                                members={members}
                                setMembers={setMembers}
                                staged={stagedUploads[field.id] ?? []}
                                setStaged={(updater) =>
                                  setStagedUploads((prev) => ({
                                    ...prev,
                                    [field.id]: updater(prev[field.id] ?? []),
                                  }))
                                }
                                totalStaged={Object.values(stagedUploads).reduce(
                                  (n, files) => n + files.length,
                                  0,
                                )}
                              />
                            ))}
                        </div>
                      </div>
                    ))}
                </div>
                {/* PORTAL-1: a signed-in intake-only submit happens HERE (no
                    captcha — the authed route is session-gated). Anonymous
                    flows continue to the account gate, which hosts the captcha. */}
                {!needsSlot && signedIn && feeQuote && (
                  <FeeConsentCard
                    quote={feeQuote}
                    accepted={feeAccepted}
                    onAccept={setFeeAccepted}
                    t={t}
                  />
                )}
                {/* "Something else" (item 3) submits from THIS step (a triage
                    request never reaches the account gate), so it hosts its own
                    captcha — the same public-write discipline as the booking. */}
                {selectedServiceKey === SOMETHING_ELSE_KEY && TURNSTILE_SITE_KEY && (
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
                  {/* Back stays disabled during an in-flight intake-only submit —
                      navigating away mid-write lets the user edit fields the
                      submit already captured. */}
                  <button
                    className="bk-btn bk-btn-ghost"
                    disabled={busy === 'submit'}
                    onClick={() => setStep(signedIn ? 'service' : 'contact')}
                  >
                    <ChevronLeftIcon size={18} />
                    {t('common.back')}
                  </button>
                  {needsSlot ? (
                    <button
                      className="bk-btn bk-btn-primary bk-btn-grow"
                      onClick={advanceFromIntake}
                    >
                      {t('common.continue')}
                      <ArrowRightIcon size={18} />
                    </button>
                  ) : (
                    <button
                      className="bk-btn bk-btn-primary bk-btn-grow"
                      disabled={
                        busy === 'submit' ||
                        // Something-else submits from here, so its captcha must
                        // be solved before the button arms (same as the gate).
                        (selectedServiceKey === SOMETHING_ELSE_KEY &&
                          Boolean(TURNSTILE_SITE_KEY) &&
                          !captchaToken)
                      }
                      onClick={advanceFromIntake}
                    >
                      {busy === 'submit' && <span className="bk-spinner bk-spinner-sm" />}
                      {busy === 'submit'
                        ? t('intake.submitting')
                        : signedIn || selectedServiceKey === SOMETHING_ELSE_KEY
                          ? t('intake.submit')
                          : t('common.continue')}
                      {busy !== 'submit' && <CheckIcon size={18} />}
                    </button>
                  )}
                </div>
              </>
            )}

            {step === 'slot' && (
              <>
                {slotsSource === 'unavailable' ? (
                  <p className="bk-empty">{t('slot.unavailable')}</p>
                ) : slots === null ? (
                  <div className="bk-loading">
                    <span className="bk-spinner" />
                    {t('slot.loading')}
                  </div>
                ) : slots.length === 0 ? (
                  <p className="bk-empty">{t('slot.none')}</p>
                ) : (
                  <AvailabilityCalendar
                    slots={slots}
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

                {signedIn && feeQuote && (
                  <FeeConsentCard
                    quote={feeQuote}
                    accepted={feeAccepted}
                    onAccept={setFeeAccepted}
                    t={t}
                  />
                )}
                <div className="bk-actions">
                  <button
                    className="bk-btn bk-btn-ghost"
                    disabled={busy === 'submit'}
                    onClick={() => setStep('intake')}
                  >
                    <ChevronLeftIcon size={18} />
                    {t('common.back')}
                  </button>
                  <button
                    className="bk-btn bk-btn-primary bk-btn-grow"
                    disabled={!selectedSlot || busy === 'submit'}
                    onClick={() => {
                      if (signedIn) void submitBooking()
                      else void goToAccountGate()
                    }}
                  >
                    {busy === 'submit' && <span className="bk-spinner bk-spinner-sm" />}
                    {busy === 'submit'
                      ? t('slot.booking')
                      : signedIn
                        ? t('slot.confirm')
                        : t('common.continue')}
                    {busy !== 'submit' && <CheckIcon size={18} />}
                  </button>
                </div>
              </>
            )}

            {step === 'account' && (
              <>
                <p className="bk-sub" style={{ marginTop: 0 }}>
                  {t(
                    'account.blurb',
                    undefined,
                    'One last step: create your secure client portal account. You will use it to track your matter, read and sign documents, message the firm, and pay invoices.',
                  )}
                </p>
                <div className="bk-fields">
                  <ContactField
                    label={t('contact.email')}
                    icon={<MailIcon size={18} />}
                    type="email"
                    value={contact.email}
                    onChange={() => undefined}
                    disabled
                  />
                  <ContactField
                    label={t('account.password', undefined, 'Choose a password')}
                    icon={<LockIcon size={18} />}
                    type="password"
                    value={password}
                    onChange={setPassword}
                    autoComplete="new-password"
                  />
                  <ContactField
                    label={t('account.password2', undefined, 'Confirm password')}
                    icon={<LockIcon size={18} />}
                    type="password"
                    value={password2}
                    onChange={setPassword2}
                    autoComplete="new-password"
                  />
                </div>
                {feeQuote && (
                  <FeeConsentCard
                    quote={feeQuote}
                    accepted={feeAccepted}
                    onAccept={setFeeAccepted}
                    t={t}
                  />
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
                  <button
                    className="bk-btn bk-btn-ghost"
                    disabled={busy === 'submit'}
                    onClick={() => setStep(needsSlot ? 'slot' : 'intake')}
                  >
                    <ChevronLeftIcon size={18} />
                    {t('common.back')}
                  </button>
                  <button
                    className="bk-btn bk-btn-primary bk-btn-grow"
                    disabled={
                      busy === 'submit' ||
                      (Boolean(TURNSTILE_SITE_KEY) && !captchaToken) ||
                      (Boolean(feeQuote) && !feeAccepted)
                    }
                    onClick={submitWithAccount}
                  >
                    {busy === 'submit' && <span className="bk-spinner bk-spinner-sm" />}
                    {busy === 'submit'
                      ? t('slot.booking')
                      : t('account.submit', undefined, 'Create account & submit')}
                    {busy !== 'submit' && <CheckIcon size={18} />}
                  </button>
                </div>
                <p className="bk-secure" style={{ marginTop: 12 }}>
                  {t(
                    'account.signin_hint',
                    undefined,
                    'Already have a portal account? Your booking will be linked to it — use your existing password after submitting.',
                  )}
                </p>
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

function BookProgress({
  step,
  steps,
}: {
  step: Step
  // Intake-only services render a 3-node rail (no 'slot'); percentages derive
  // from the array so no other math changes.
  steps: ReadonlyArray<{ key: Exclude<Step, 'done'>; labelKey: string }>
}) {
  const { t } = useI18n()
  const idx = steps.findIndex((s) => s.key === step)
  const safeIdx = idx < 0 ? 0 : idx
  const railPct = (safeIdx / (steps.length - 1)) * 100
  const mobilePct = ((safeIdx + 1) / steps.length) * 100
  const current = steps[safeIdx]

  return (
    <nav
      className="bk-progress"
      aria-label={t('progress.step_of', { n: safeIdx + 1, total: steps.length })}
    >
      <div className="bk-progress-mobile">
        <div className="bk-progress-mobile-row">
          <span className="bk-progress-step">
            {t('progress.step_of', { n: safeIdx + 1, total: steps.length })}
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
        {steps.map((s, i) => {
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
  disabled,
}: {
  label: string
  icon: React.ReactNode
  value: string
  onChange: (v: string) => void
  type?: string
  inputMode?: 'email' | 'text' | 'tel'
  autoComplete?: string
  disabled?: boolean
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
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}

// PORTAL-1 (WP3) — the fee consent card: the exact cost, shown BEFORE anything
// billable proceeds, with an explicit acceptance. The server enforces the gate;
// this card is only the honest presentation of it.
function FeeConsentCard({
  quote,
  accepted,
  onAccept,
  t,
}: {
  quote: {
    basis: string
    amount: string | null
    rate: string | null
    currency: string
    description: string
  }
  accepted: boolean
  onAccept: (v: boolean) => void
  t: (key: string, vars?: Record<string, string | number>, fallback?: string) => string
}) {
  const price =
    quote.basis === 'fixed' && quote.amount
      ? `$${quote.amount}`
      : quote.rate
        ? `$${quote.rate}/hr`
        : ''
  return (
    <div className="bk-notice" role="note" style={{ marginTop: 16 }}>
      <strong>{t('fee.title', undefined, 'Fee for this service')}</strong>
      <div style={{ margin: '6px 0' }}>
        {quote.description} — <strong>{price}</strong>
        {quote.basis === 'hourly-rate' && (
          <> {t('fee.hourly_note', undefined, '(billed for time actually worked)')}</>
        )}
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => onAccept(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          {quote.basis === 'fixed'
            ? t(
                'fee.accept_fixed',
                undefined,
                'I accept this fee. It will be billed on my invoice for this service.',
              )
            : t(
                'fee.accept_hourly',
                undefined,
                'I accept this hourly rate for work on this service.',
              )}
        </span>
      </label>
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
  staged,
  setStaged,
  totalStaged,
}: {
  field: ServiceField
  responses: Record<string, unknown>
  setResponses: React.Dispatch<React.SetStateAction<Record<string, unknown>>>
  members: MemberRow[]
  setMembers: React.Dispatch<React.SetStateAction<MemberRow[]>>
  staged: StagedFile[]
  // Functional updater ONLY: an upload finishing while the user removes another
  // file must merge into the latest list, never overwrite it from a stale copy.
  setStaged: (updater: (prev: StagedFile[]) => StagedFile[]) => void
  // Files staged across ALL fields — the server caps 10 per submission, so the
  // add button hides on the submission-wide total, not this field's count.
  totalStaged: number
}) {
  const { t, lang } = useI18n()
  const fieldId = useId()
  // file_upload transient UI state — declared unconditionally (hooks rule);
  // unused by every other field type.
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const value = responses[field.id]
  const set = (v: unknown) => setResponses((prev) => ({ ...prev, [field.id]: v }))
  // Mirror the staged filenames into the questionnaire answer (what the attorney
  // sees), derived from the AUTHORITATIVE staged list so no update path can
  // leave them out of sync. Guarded so non-file fields and the initial empty
  // state never write an answer.
  const { id: syncFieldId, type: syncFieldType } = field
  useEffect(() => {
    if (syncFieldType !== 'file_upload') return
    const names = staged.map((f) => f.filename)
    setResponses((prev) => {
      const cur = prev[syncFieldId]
      const curArr = Array.isArray(cur) ? (cur as string[]) : null
      if (!curArr && names.length === 0) return prev
      if (curArr && curArr.length === names.length && curArr.every((x, i) => x === names[i])) {
        return prev
      }
      return { ...prev, [syncFieldId]: names }
    })
  }, [staged, syncFieldId, syncFieldType, setResponses])
  const fieldLabel = fieldLabelOf(field, lang, t)
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

  if (field.type === 'file_upload') {
    // Uploads go to staging IMMEDIATELY (so submit is instant and validation
    // can require a completed upload, not a pending one). The response token is
    // the only handle the browser holds; the filename list mirrors into the
    // questionnaire answers via the sync effect above. All list changes go
    // through functional updates — an upload finishing mid-removal must merge
    // into the latest list, not resurrect a removed file from a stale copy.
    const uploadFile = async (file: File) => {
      setUploadError(null)
      setUploading(true)
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch('/api/client/intake/uploads', { method: 'POST', body: fd })
        const data = (await res.json().catch(() => null)) as {
          token?: string
          filename?: string
          sizeBytes?: number
          error?: string
        } | null
        if (!res.ok || !data?.token) {
          throw new Error(data?.error ?? t('upload.failed', undefined, 'Upload failed.'))
        }
        const added: StagedFile = {
          token: data.token,
          filename: data.filename ?? file.name,
          sizeBytes: data.sizeBytes ?? file.size,
        }
        setStaged((prev) => [...prev, added])
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : String(err))
      } finally {
        setUploading(false)
      }
    }
    return (
      <div className="bk-field bk-field-wide">
        <span className="bk-label">
          <FileTextIcon size={15} />
          {fieldLabel}
          {field.required ? <em className="bk-req">*</em> : ''}
        </span>
        {staged.length > 0 && (
          <ul className="bk-upload-list">
            {staged.map((f) => (
              <li key={f.token} className="bk-upload-item">
                <FileTextIcon size={14} />
                <span className="bk-upload-name">{f.filename}</span>
                <span className="bk-upload-size">{formatFileSize(f.sizeBytes)}</span>
                <button
                  type="button"
                  className="bk-upload-remove"
                  aria-label={t('upload.remove', undefined, 'Remove')}
                  onClick={() => setStaged((prev) => prev.filter((x) => x.token !== f.token))}
                >
                  <X size={16} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {totalStaged < 10 && (
          <label
            className={`bk-btn bk-btn-soft bk-upload-add${uploading ? ' bk-upload-busy' : ''}`}
          >
            <input
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.tif,.tiff,.txt"
              style={{ display: 'none' }}
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void uploadFile(file)
              }}
            />
            {uploading
              ? t('upload.uploading', undefined, 'Uploading…')
              : staged.length > 0
                ? t('upload.add_another', undefined, 'Attach another document')
                : t('upload.attach', undefined, 'Attach a document')}
          </label>
        )}
        <p className="bk-hint">
          {t('upload.hint', undefined, 'PDF, Word, images, or text — up to 25 MB each.')}
        </p>
        {uploadError && <p className="bk-upload-error">{uploadError}</p>}
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
              {optionLabelOf(field, opt, lang, t)}
            </option>
          ))}
        </select>
        {unknownToggle}
      </div>
    )
  }

  // Boolean answers (yes_no / true_false) — a two-choice pill set. The stored
  // answer is the chosen label, so {{token}} merges cleanly ("Yes" / "True").
  if (field.type === 'yes_no' || field.type === 'true_false') {
    const choices = field.type === 'yes_no' ? ['Yes', 'No'] : ['True', 'False']
    const current = typeof value === 'string' && !isUnknown ? value : ''
    return (
      <div className="bk-field">
        <span className="bk-label">
          {fieldLabel}
          {field.required ? <em className="bk-req">*</em> : ''}
        </span>
        <div className="bk-pills" role="radiogroup" aria-label={fieldLabel}>
          {choices.map((opt) => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={current === opt}
              className={`bk-pill${current === opt ? ' bk-pill-on' : ''}`}
              disabled={isUnknown}
              onClick={() => set(current === opt ? '' : opt)}
            >
              {opt}
            </button>
          ))}
        </div>
        {unknownToggle}
      </div>
    )
  }

  // Multi-select (checkbox) — toggle pills; the stored answer is a string[].
  if (field.type === 'checkbox' && field.options) {
    const selected = Array.isArray(value) ? (value as string[]) : []
    const toggle = (opt: string) =>
      set(selected.includes(opt) ? selected.filter((x) => x !== opt) : [...selected, opt])
    return (
      <div className="bk-field bk-field-wide">
        <span className="bk-label">
          {fieldLabel}
          {field.required ? <em className="bk-req">*</em> : ''}
        </span>
        <div className="bk-pills" role="group" aria-label={fieldLabel}>
          {field.options.map((opt) => (
            <button
              key={opt}
              type="button"
              aria-pressed={selected.includes(opt)}
              className={`bk-pill${selected.includes(opt) ? ' bk-pill-on' : ''}`}
              disabled={isUnknown}
              onClick={() => toggle(opt)}
            >
              {optionLabelOf(field, opt, lang, t)}
            </button>
          ))}
        </div>
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
