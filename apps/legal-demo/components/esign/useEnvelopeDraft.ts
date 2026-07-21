'use client'

// ESIGN-UNIFY-1 (ES-1, design §3) — the composer's in-memory envelope draft.
// NO draft envelope is ever persisted (§2 principle 4): the wizard assembles
// everything here and submits ONE esign.send when the attorney confirms.
import { useCallback, useMemo, useState } from 'react'
// Type-only import from the vertical package — erased at build, so no server
// code reaches the client bundle (same pattern as configEditors.tsx).
import type { FieldPlacement } from '@exsto/legal'

export type RecipientRole = 'needs_to_sign' | 'needs_to_view' | 'receives_copy'

export interface DraftRecipient {
  name: string
  email: string
  title: string
  role: RecipientRole
  /** 1-based signing order; collapsed to 1 for every row when ordering is OFF. */
  order: number
}

export interface EnvelopeDraft {
  file: File | null
  subject: string
  message: string
  matterId: string | null
  contactId: string | null
  recipients: DraftRecipient[]
  /** §5.1 — resolved coordinate placements; the ES-2 canvas writes these. */
  placements: FieldPlacement[]
  useSigningOrder: boolean
}

export const EMPTY_RECIPIENT: DraftRecipient = {
  name: '',
  email: '',
  title: '',
  role: 'needs_to_sign',
  order: 1,
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface EnvelopeDraftApi {
  draft: EnvelopeDraft
  setFile: (file: File | null) => void
  setSubject: (subject: string) => void
  setMessage: (message: string) => void
  setAttach: (next: { matterId: string | null; contactId: string | null }) => void
  setRecipient: (index: number, patch: Partial<DraftRecipient>) => void
  addRecipient: () => void
  removeRecipient: (index: number) => void
  moveRecipient: (from: number, to: number) => void
  setUseSigningOrder: (on: boolean) => void
  setPlacements: (placements: FieldPlacement[]) => void
  /** Pre-fill row 1 from the attached matter/contact — never overwrites a row
   *  the attorney already touched (the #439 rule). */
  prefillFirstRecipient: (name: string, email: string) => void
  /** Recipients with a non-empty email (what actually sends). */
  filledRecipients: DraftRecipient[]
  /** Per-step validation error, or null when the step is complete. */
  stepError: (step: number) => string | null
}

export function useEnvelopeDraft(): EnvelopeDraftApi {
  const [draft, setDraft] = useState<EnvelopeDraft>({
    file: null,
    subject: '',
    message: '',
    matterId: null,
    contactId: null,
    recipients: [{ ...EMPTY_RECIPIENT }],
    placements: [],
    useSigningOrder: false,
  })

  const setFile = useCallback((file: File | null) => {
    setDraft((d) => ({
      ...d,
      file,
      // Subject default = document title, never a "Signature requested:" prefix
      // (§3 step 4). Only fills an untouched subject.
      subject: d.subject.trim() ? d.subject : (file?.name.replace(/\.pdf$/i, '') ?? ''),
    }))
  }, [])

  const setSubject = useCallback((subject: string) => {
    setDraft((d) => ({ ...d, subject }))
  }, [])

  const setMessage = useCallback((message: string) => {
    setDraft((d) => ({ ...d, message }))
  }, [])

  const setAttach = useCallback((next: { matterId: string | null; contactId: string | null }) => {
    setDraft((d) => ({ ...d, matterId: next.matterId, contactId: next.contactId }))
  }, [])

  const setRecipient = useCallback((index: number, patch: Partial<DraftRecipient>) => {
    setDraft((d) => ({
      ...d,
      recipients: d.recipients.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }))
  }, [])

  const addRecipient = useCallback(() => {
    setDraft((d) => ({
      ...d,
      recipients: [
        ...d.recipients,
        { ...EMPTY_RECIPIENT, order: d.useSigningOrder ? d.recipients.length + 1 : 1 },
      ],
    }))
  }, [])

  const removeRecipient = useCallback((index: number) => {
    setDraft((d) => {
      const rows = d.recipients.filter((_, i) => i !== index)
      return {
        ...d,
        recipients: renumber(rows.length ? rows : [{ ...EMPTY_RECIPIENT }], d.useSigningOrder),
      }
    })
  }, [])

  const moveRecipient = useCallback((from: number, to: number) => {
    setDraft((d) => {
      if (from === to || from < 0 || to < 0 || from >= d.recipients.length || to >= d.recipients.length) {
        return d
      }
      const rows = [...d.recipients]
      const [moved] = rows.splice(from, 1)
      rows.splice(to, 0, moved!)
      return { ...d, recipients: renumber(rows, d.useSigningOrder) }
    })
  }, [])

  const setUseSigningOrder = useCallback((on: boolean) => {
    // OFF collapses every order to 1 (parallel — already supported by
    // deliverNextGroup); ON renumbers by current row position.
    setDraft((d) => ({ ...d, useSigningOrder: on, recipients: renumber(d.recipients, on) }))
  }, [])

  const setPlacements = useCallback((placements: FieldPlacement[]) => {
    setDraft((d) => ({ ...d, placements }))
  }, [])

  const prefillFirstRecipient = useCallback((name: string, email: string) => {
    if (!email) return
    setDraft((d) => {
      const first = d.recipients[0]
      if (!first || first.name.trim() || first.email.trim()) return d
      return {
        ...d,
        recipients: d.recipients.map((r, i) => (i === 0 ? { ...r, name, email } : r)),
      }
    })
  }, [])

  const filledRecipients = useMemo(
    () => draft.recipients.filter((r) => r.email.trim()),
    [draft.recipients],
  )

  const stepError = useCallback(
    (step: number): string | null => {
      if (step === 0 && !draft.file) return 'Choose a PDF to send.'
      if (step === 1) {
        if (filledRecipients.length === 0) {
          return 'Add at least one recipient with an email address.'
        }
        const bad = filledRecipients.find((r) => !EMAIL_RE.test(r.email.trim()))
        if (bad) return `"${bad.email.trim()}" doesn't look like an email address.`
        if (!filledRecipients.some((r) => r.role === 'needs_to_sign')) {
          return 'At least one recipient must have the "Needs to sign" role.'
        }
      }
      return null
    },
    [draft.file, filledRecipients],
  )

  return {
    draft,
    setFile,
    setSubject,
    setMessage,
    setAttach,
    setRecipient,
    addRecipient,
    removeRecipient,
    moveRecipient,
    setUseSigningOrder,
    setPlacements,
    prefillFirstRecipient,
    filledRecipients,
    stepError,
  }
}

function renumber(rows: DraftRecipient[], useSigningOrder: boolean): DraftRecipient[] {
  return rows.map((r, i) => ({ ...r, order: useSigningOrder ? i + 1 : 1 }))
}
