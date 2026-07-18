'use client'

// ASSISTANT-ACTS-1 — the edit/send modal the chat opens when the assistant calls
// compose_email. The model drafts subject + body; the attorney reviews, edits,
// attaches, and sends HERE — their action in this modal IS the approval, so the
// tool that opened it wrote nothing. Sends through the SAME dedicated attachment
// route the Mail tab compose form uses (mode: 'compose'), so a matter is always
// required even when nothing is attached (the route's contract, unlike the plain
// MCP legal.mail.compose which only covers the no-attachment case).
import { useEffect, useMemo, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { Modal } from '@/components/Modal'
import { MailComposer, type ComposerValue } from '@/components/MailComposer'
import { SignatureBlock, type FirmSignature } from '@/components/SignatureBlock'
import { AttachmentPicker, type PickedAttachment } from '@/components/mail/AttachmentPicker'
import { markdownToHtml } from '@/lib/templateBody'
import { XIcon } from '@/components/icons'

type MatterRef = { matterEntityId: string; matterNumber: string }

// Mirrors verticals/legal/src/api/mailAttachments.ts MAX_ATTACHMENTS — the
// server refuses a send over this count; enforced here too so the attorney sees
// the limit before hitting Send, not after.
const MAX_ATTACHMENTS = 10

// Client-side mirror of verticals/legal/src/api/emailVoiceChecks.ts VoiceViolation
// — a client component may not import @exsto/legal values directly (its index is
// side-effectful), so this rides over MCP (legal.email.voice_check) like every
// other client-facing read, and the shape is duplicated here.
interface VoiceViolation {
  rule: 'em_dash' | 'banned_phrase' | 'filler_adverb' | 'body_header' | 'sign_off'
  where: 'subject' | 'body'
  offending: string
}
const RULE_LABEL: Record<VoiceViolation['rule'], string> = {
  em_dash: 'em dash',
  banned_phrase: 'banned phrase',
  filler_adverb: 'filler adverb',
  body_header: 'newsletter-style header',
  sign_off: 'sign-off shape',
}

// Mirrors UnifiedAssistantChat's slugifyTitle — a document produced in chat has
// only a title, so save_reply's documentKind is derived from it the same way
// DocumentCard's own "Save to matter" button does.
function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'document'
  )
}

export interface EmailComposeModalProps {
  matterEntityId?: string
  contactEntityId?: string
  initialSubject: string
  initialBodyMarkdown: string
  // Documents produced this turn that the tool hinted to attach, plus any the
  // attorney adds from a DocumentCard. draftVersionId set once saved to matter.
  pendingDocs: Array<{ title: string; markdown: string; draftVersionId?: string }>
  // Titles the assistant hinted to attach that didn't match any document produced
  // this turn (already dropped from pendingDocs by the caller) — shown as a
  // muted note rather than silently vanishing.
  unmatchedTitles?: string[]
  // Fires once a pendingDoc without a draftVersionId is saved to the matter at
  // send time, so the DocumentCard it came from learns the id (no duplicate save
  // on a later "Save to matter" click).
  onDocSaved?: (info: { title: string; draftVersionId: string }) => void
  onSent: (info: { to: string; subject: string; attachmentLabels: string[] }) => void
  onClose: () => void
}

export function EmailComposeModal({
  matterEntityId,
  contactEntityId,
  initialSubject,
  initialBodyMarkdown,
  pendingDocs,
  unmatchedTitles,
  onDocSaved,
  onSent,
  onClose,
}: EmailComposeModalProps): React.ReactElement {
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(initialSubject)
  const [body, setBody] = useState<ComposerValue>({ html: '', text: '' })
  const [signature, setSignature] = useState<FirmSignature | null>(null)
  // Derived (not copied) from the pendingDocs prop: the modal stays mounted while
  // open, and a DocumentCard's "Attach to email" adds to the SAME open instance
  // (item 6b) — a plain useState copy would miss that addition. Removals are
  // tracked separately so they survive a later addition instead of being wiped
  // out by a fresh pendingDocs reference.
  const [removedTitles, setRemovedTitles] = useState<Set<string>>(new Set())
  const docs = useMemo(
    () => pendingDocs.filter((d) => !removedTitles.has(d.title)),
    [pendingDocs, removedTitles],
  )
  const [pickedAttachments, setPickedAttachments] = useState<PickedAttachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)

  // Matter scope: fixed to the prop. Contact scope: resolved from `to`, exactly
  // like the Mail tab's compose-recipient effect (legal.mail.recipient_matters) —
  // attachments and save_reply both need a matterId even when nothing is picked
  // yet, since the send route always requires one (mode: 'compose').
  const [matterOptions, setMatterOptions] = useState<MatterRef[]>([])
  const [matterId, setMatterId] = useState<string | null>(matterEntityId ?? null)
  // Set once the matter lookup completes and the matter has no client email on
  // file — distinct from "the attorney hasn't typed one yet".
  const [matterHasNoEmail, setMatterHasNoEmail] = useState(false)

  const [violations, setViolations] = useState<VoiceViolation[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initialHtml = useMemo(() => markdownToHtml(initialBodyMarkdown), [initialBodyMarkdown])

  // Prefill To from the matter's client / the contact, once, on open.
  useEffect(() => {
    let cancelled = false
    if (matterEntityId) {
      callAttorneyMcp<{ matter: { clientEmail: string | null } | null }>({
        toolName: 'legal.matter.get',
        input: { matterEntityId },
      })
        .then((r) => {
          if (cancelled) return
          setTo(r.matter?.clientEmail ?? '')
          setMatterHasNoEmail(!r.matter?.clientEmail)
        })
        .catch(() => {
          /* leave To blank — the attorney can still type an address */
        })
    } else if (contactEntityId) {
      callAttorneyMcp<{ contact: { email?: string } | null }>({
        toolName: 'legal.contact.get',
        input: { contactEntityId },
      })
        .then((r) => {
          if (!cancelled) setTo(r.contact?.email ?? '')
        })
        .catch(() => {
          /* leave To blank */
        })
    }
    return () => {
      cancelled = true
    }
    // Open-time seed only — re-running on every `to` keystroke would fight the
    // attorney's own edits.
  }, [matterEntityId, contactEntityId])

  // The firm signature preview/editor in the composer footer (mirrors the Mail
  // tab compose form).
  useEffect(() => {
    callAttorneyMcp<{ signature: FirmSignature }>({ toolName: 'legal.settings.signature.get' })
      .then((r) => setSignature(r.signature))
      .catch(() => setSignature(null))
  }, [])

  // Contact scope: resolve which matter(s) the typed address is a client of,
  // debounced on `to` — exactly the Mail tab's composeTo effect.
  useEffect(() => {
    if (matterEntityId) return // matter scope is fixed; nothing to resolve
    const email = to.trim()
    if (!email.includes('@')) {
      setMatterOptions([])
      setMatterId(null)
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      callAttorneyMcp<{ matters: MatterRef[] }>({
        toolName: 'legal.mail.recipient_matters',
        input: { email },
      })
        .then((r) => {
          if (cancelled) return
          setMatterOptions(r.matters)
          setMatterId((prev) =>
            prev && r.matters.some((m) => m.matterEntityId === prev)
              ? prev
              : (r.matters[0]?.matterEntityId ?? null),
          )
        })
        .catch(() => {
          if (!cancelled) setMatterOptions([])
        })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [matterEntityId, to])

  // House-voice advisories — debounced, never blocking. Reads the plain-text
  // body (the same text the send path records as bodyText).
  useEffect(() => {
    const t = setTimeout(() => {
      if (!subject.trim() && !body.text.trim()) {
        setViolations([])
        return
      }
      callAttorneyMcp<{ violations: VoiceViolation[] }>({
        toolName: 'legal.email.voice_check',
        input: { subject, body: body.text },
      })
        .then((r) => setViolations(r.violations))
        .catch(() => {
          /* advisory only — a failed check just shows nothing */
        })
    }, 500)
    return () => clearTimeout(t)
  }, [subject, body.text])

  function removeDoc(title: string): void {
    setRemovedTitles((prev) => new Set(prev).add(title))
  }

  function handleAttachChange(next: PickedAttachment[]): void {
    if (docs.length + next.length > MAX_ATTACHMENTS) {
      setAttachError(`You can attach up to ${MAX_ATTACHMENTS} documents to an email.`)
      return
    }
    setAttachError(null)
    setPickedAttachments(next)
  }

  const totalAttachments = docs.length + pickedAttachments.length
  const canSend =
    Boolean(to.trim()) && Boolean(matterId) && !sending && totalAttachments <= MAX_ATTACHMENTS

  async function handleSend(): Promise<void> {
    if (!canSend) return
    const trimmedTo = to.trim()
    if (!matterId) {
      setError('Pick a matter to send this email from.')
      return
    }
    setSending(true)
    setError(null)
    try {
      // Save any pending doc that hasn't been saved to the matter yet — the email
      // attaches the SAVED version (rendered to PDF at send time), not the raw
      // in-chat markdown.
      const savedRefs: Array<{ kind: 'draft'; id: string }> = []
      for (const doc of docs) {
        let versionId = doc.draftVersionId
        if (!versionId) {
          const r = await callAttorneyMcp<{ draftVersionId: string | null }>({
            toolName: 'legal.assistant.save_reply',
            input: {
              matterEntityId: matterId,
              markdown: doc.markdown,
              documentKind: slugifyTitle(doc.title).replace(/-/g, '_'),
            },
          })
          versionId = r.draftVersionId ?? undefined
          if (versionId) onDocSaved?.({ title: doc.title, draftVersionId: versionId })
        }
        if (versionId) savedRefs.push({ kind: 'draft', id: versionId })
      }
      const attachments = [...savedRefs, ...pickedAttachments.map(({ kind, id }) => ({ kind, id }))]
      const res = await fetch('/api/attorney/mail/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'compose',
          to: trimmedTo,
          // Cc rides along for when the route forwards it to enqueueClientEmail
          // (firm-staff-only, validated server-side); harmless no-op until then.
          cc: cc.trim() || undefined,
          subject: subject.trim(),
          bodyText: body.text,
          bodyHtml: body.html || undefined,
          matterId,
          attachments,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data?.error ?? 'Failed to send.')
      const attachmentLabels = [
        ...docs.map((d) => d.title),
        ...pickedAttachments.map((a) => a.label),
      ]
      onSent({ to: trimmedTo, subject: subject.trim(), attachmentLabels })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      title="Email to client"
      onClose={onClose}
      size="wide"
      footer={
        <>
          {error && <span className="li-modal-foot-error">{error}</span>}
          <button type="button" className="li-modal-btn-ghost" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button
            type="button"
            className="li-modal-btn-primary"
            onClick={() => void handleSend()}
            disabled={!canSend}
          >
            {sending && <span className="spinner" />}
            {sending ? 'Sending…' : 'Send'}
          </button>
        </>
      }
    >
      {matterHasNoEmail && !to.trim() && (
        <div className="alert alert-warn" role="alert">
          No client email on this matter — add one on the client record, or type an address below.
        </div>
      )}

      <label className="li-modal-field">
        <span>To</span>
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="client@example.com"
          disabled={sending}
        />
      </label>

      {!matterEntityId && matterOptions.length > 1 && (
        <label className="li-modal-field">
          <span>Matter</span>
          <select
            value={matterId ?? ''}
            onChange={(e) => setMatterId(e.target.value)}
            disabled={sending}
          >
            {matterOptions.map((m) => (
              <option key={m.matterEntityId} value={m.matterEntityId}>
                {m.matterNumber}
              </option>
            ))}
          </select>
        </label>
      )}
      {!matterEntityId && to.trim().includes('@') && matterOptions.length === 0 && (
        <p className="li-modal-muted">
          Not a known client contact on any matter yet — attachments and sending need one.
        </p>
      )}

      <label className="li-modal-field">
        <span>Cc</span>
        <input
          type="text"
          value={cc}
          onChange={(e) => setCc(e.target.value)}
          placeholder="Add co-counsel or paralegal…"
          disabled={sending}
        />
      </label>

      <label className="li-modal-field">
        <span>Subject</span>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={sending}
        />
      </label>

      {violations.length > 0 && (
        <div className="li-uac-voice-chips">
          {violations.map((v, i) => (
            <span key={i} className="li-uac-voice-chip">
              House voice: {RULE_LABEL[v.rule]} in {v.where}
            </span>
          ))}
        </div>
      )}

      <MailComposer
        key="email-compose"
        initialHtml={initialHtml}
        placeholder="Write your message…"
        footer={<SignatureBlock value={signature} onChange={setSignature} />}
        onChange={setBody}
        disabled={sending}
      />

      {docs.length > 0 && (
        <div className="mail-attach-bar">
          {docs.map((d) => (
            <span key={d.title} className="mail-attach-chip li-uac-pendingdoc-chip" title={d.title}>
              {d.title} — will be saved to the matter and attached as PDF
              <button
                type="button"
                aria-label={`Don't attach ${d.title}`}
                onClick={() => removeDoc(d.title)}
                disabled={sending}
              >
                <XIcon size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {unmatchedTitles && unmatchedTitles.length > 0 && (
        <p className="li-modal-muted">
          Not attached (no matching document this turn): {unmatchedTitles.join(', ')}
        </p>
      )}

      <AttachmentPicker
        matterId={matterId}
        value={pickedAttachments}
        onChange={handleAttachChange}
      />
      {attachError && <p className="li-modal-foot-error">{attachError}</p>}
    </Modal>
  )
}
