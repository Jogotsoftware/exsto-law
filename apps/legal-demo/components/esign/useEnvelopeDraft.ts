'use client'

// ESIGN-UNIFY-1 (ES-1, design §3) — the composer's in-memory envelope draft.
// NO draft envelope is ever persisted (§2 principle 4): the wizard assembles
// everything here and submits ONE esign.send when the attorney confirms.
import { useCallback, useMemo, useState } from 'react'
// Type-only import from the vertical package — erased at build, so no server
// code reaches the client bundle (same pattern as configEditors.tsx).
import type { FieldPlacement } from '@exsto/legal'
import { workflowStepUsesSigningOrder } from '@/lib/esignComposeSource'

export type RecipientRole = 'needs_to_sign' | 'needs_to_view' | 'receives_copy'

export interface DraftRecipient {
  name: string
  email: string
  title: string
  role: RecipientRole
  /** 1-based signing order; collapsed to 1 for every row when ordering is OFF. */
  order: number
  /** ES-4 (workflow-step mode): the marker signer key this recipient owns
   *  ({{type:key}}) — seeded from the template's e-sign roles so the draft
   *  send binds fields to the right signer. Null for free-typed rows. */
  key?: string | null
}

/** ES-MULTIDOC-1 — one uploaded document in the envelope's ordered set. Its
 *  array position IS the docIndex placements bind to. */
export interface DraftDocument {
  /** Stable local id for React keys + reorder/remove (NOT the substrate id). */
  id: string
  file: File
  title: string
}

export interface EnvelopeDraft {
  /** ES-MULTIDOC-1 — the ordered set of uploaded PDFs (upload/blank source).
   *  Empty for a locked source (document/workflow-step), which carries its one
   *  document on the ComposerSource itself. Order = docIndex. */
  documents: DraftDocument[]
  subject: string
  message: string
  matterId: string | null
  contactId: string | null
  recipients: DraftRecipient[]
  /** §5.1 — resolved coordinate placements across ALL documents; the ES-2 canvas
   *  writes these. Each placement's docIndex binds it to a document. */
  placements: FieldPlacement[]
  useSigningOrder: boolean
  /** ES-4: the document is fixed by the launch source (the workflow step's
   *  approved version) — step 1 needs no file and offers no replace/add. */
  documentLocked: boolean
}

let draftDocSeq = 0
function makeDraftDocument(file: File): DraftDocument {
  draftDocSeq += 1
  return { id: `d${draftDocSeq}`, file, title: file.name.replace(/\.pdf$/i, '') }
}

export const EMPTY_RECIPIENT: DraftRecipient = {
  name: '',
  email: '',
  title: '',
  role: 'needs_to_sign',
  order: 1,
  key: null,
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** New-recipient signing order: appended after every existing row when signing
 *  order is ON (lands last, but stays reorderable like any row); collapsed to 1
 *  (parallel) when OFF. Shared by addRecipient and addMyself so both rows land
 *  the same way. */
export function nextRecipientOrder(recipientCount: number, useSigningOrder: boolean): number {
  return useSigningOrder ? recipientCount + 1 : 1
}

/** "Add myself" duplicate guard (case/whitespace-insensitive) — also drives the
 *  composer's disabled-button state ("You're already a recipient"). */
export function recipientHasEmail(recipients: DraftRecipient[], email: string): boolean {
  const needle = email.trim().toLowerCase()
  if (!needle) return false
  return recipients.some((r) => r.email.trim().toLowerCase() === needle)
}

export interface EnvelopeDraftApi {
  draft: EnvelopeDraft
  /** ES-MULTIDOC-1 — append uploaded PDFs to the ordered set (Documents step). */
  addDocuments: (files: File[]) => void
  removeDocument: (id: string) => void
  /** Reorder a document up (-1) or down (+1); rebinds nothing (placements carry
   *  the docIndex, remapped by the composer on reorder). */
  moveDocument: (id: string, dir: -1 | 1) => void
  setSubject: (subject: string) => void
  setMessage: (message: string) => void
  setAttach: (next: { matterId: string | null; contactId: string | null }) => void
  setRecipient: (index: number, patch: Partial<DraftRecipient>) => void
  addRecipient: () => void
  /** "Add myself" (founder request) — appends a countersigner row prefilled
   *  with the attorney's own name/email; no-ops on a duplicate email. */
  addMyself: (identity: { name: string; email: string }) => void
  removeRecipient: (index: number) => void
  moveRecipient: (from: number, to: number) => void
  setUseSigningOrder: (on: boolean) => void
  setPlacements: (placements: FieldPlacement[]) => void
  /** Pre-fill row 1 from the attached matter/contact — never overwrites a row
   *  the attorney already touched (the #439 rule). */
  prefillFirstRecipient: (name: string, email: string) => void
  /** ES-4 (workflow-step mode): seed the whole draft from the step's
   *  pre-resolved context — subject, recipient rows (keys/roles/orders kept),
   *  document locked. Rows stay fully editable afterwards. */
  seedWorkflowStep: (seed: { subject?: string; recipients: DraftRecipient[] }) => void
  /** Recipients with a non-empty email (what actually sends). */
  filledRecipients: DraftRecipient[]
  /** Per-step validation error, or null when the step is complete. */
  stepError: (step: number) => string | null
}

export function useEnvelopeDraft(): EnvelopeDraftApi {
  const [draft, setDraft] = useState<EnvelopeDraft>({
    documents: [],
    subject: '',
    message: '',
    matterId: null,
    contactId: null,
    recipients: [{ ...EMPTY_RECIPIENT }],
    placements: [],
    useSigningOrder: false,
    documentLocked: false,
  })

  const addDocuments = useCallback((files: File[]) => {
    const added = files.filter((f) => f instanceof File).map(makeDraftDocument)
    if (added.length === 0) return
    setDraft((d) => ({
      ...d,
      documents: [...d.documents, ...added],
      // Subject default (§3 step 4): the first document's title when the attorney
      // hasn't typed one, never a "Signature requested:" prefix. For a 2+ doc
      // envelope the sender usually names it; a single-doc upload is unchanged.
      subject: d.subject.trim()
        ? d.subject
        : d.documents.length + added.length > 1
          ? ''
          : (added[0]?.title ?? ''),
    }))
  }, [])

  const removeDocument = useCallback((id: string) => {
    setDraft((d) => {
      const idx = d.documents.findIndex((doc) => doc.id === id)
      if (idx < 0) return d
      const documents = d.documents.filter((doc) => doc.id !== id)
      // Remap placements: drop the removed document's, shift higher docs down.
      const placements = d.placements
        .filter((p) => (p.docIndex ?? 0) !== idx)
        .map((p) => {
          const di = p.docIndex ?? 0
          return di > idx ? { ...p, docIndex: di - 1 } : p
        })
      return { ...d, documents, placements }
    })
  }, [])

  const moveDocument = useCallback((id: string, dir: -1 | 1) => {
    setDraft((d) => {
      const from = d.documents.findIndex((doc) => doc.id === id)
      const to = from + dir
      if (from < 0 || to < 0 || to >= d.documents.length) return d
      const documents = [...d.documents]
      const [moved] = documents.splice(from, 1)
      documents.splice(to, 0, moved!)
      // Swap the two documents' placements (their docIndexes trade places).
      const placements = d.placements.map((p) => {
        const di = p.docIndex ?? 0
        if (di === from) return { ...p, docIndex: to }
        if (di === to) return { ...p, docIndex: from }
        return p
      })
      return { ...d, documents, placements }
    })
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
        { ...EMPTY_RECIPIENT, order: nextRecipientOrder(d.recipients.length, d.useSigningOrder) },
      ],
    }))
  }, [])

  // "Add myself" (founder request) — appends a countersigner row prefilled with
  // the signed-in attorney's own name/email, role needs_to_sign, lands last when
  // signing order is ON (nextRecipientOrder), stays reorderable afterwards.
  // No-ops if the email is already in the list — the composer disables the
  // button using the same recipientHasEmail check, this is the defense-in-depth
  // guard against a stale disabled state (e.g. a double click).
  const addMyself = useCallback((identity: { name: string; email: string }) => {
    setDraft((d) => {
      if (recipientHasEmail(d.recipients, identity.email)) return d
      return {
        ...d,
        recipients: [
          ...d.recipients,
          {
            ...EMPTY_RECIPIENT,
            name: identity.name.trim(),
            email: identity.email.trim(),
            order: nextRecipientOrder(d.recipients.length, d.useSigningOrder),
          },
        ],
      }
    })
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
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= d.recipients.length ||
        to >= d.recipients.length
      ) {
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

  const seedWorkflowStep = useCallback(
    (seed: { subject?: string; recipients: DraftRecipient[] }) => {
      setDraft((d) => ({
        ...d,
        documentLocked: true,
        subject: seed.subject?.trim() ? seed.subject : d.subject,
        recipients: seed.recipients.length ? seed.recipients : [{ ...EMPTY_RECIPIENT }],
        // Sequential template orders arrive as a real signing order; all-equal
        // orders mean parallel — the toggle reflects what the config declared.
        useSigningOrder: workflowStepUsesSigningOrder(seed.recipients),
      }))
    },
    [],
  )

  const filledRecipients = useMemo(
    () => draft.recipients.filter((r) => r.email.trim()),
    [draft.recipients],
  )

  const stepError = useCallback(
    (step: number): string | null => {
      if (step === 0 && draft.documents.length === 0 && !draft.documentLocked)
        return 'Choose a PDF to send.'
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
    [draft.documents.length, draft.documentLocked, filledRecipients],
  )

  return {
    draft,
    addDocuments,
    removeDocument,
    moveDocument,
    setSubject,
    setMessage,
    setAttach,
    setRecipient,
    addRecipient,
    addMyself,
    removeRecipient,
    moveRecipient,
    setUseSigningOrder,
    setPlacements,
    prefillFirstRecipient,
    seedWorkflowStep,
    filledRecipients,
    stepError,
  }
}

function renumber(rows: DraftRecipient[], useSigningOrder: boolean): DraftRecipient[] {
  return rows.map((r, i) => ({ ...r, order: useSigningOrder ? i + 1 : 1 }))
}
