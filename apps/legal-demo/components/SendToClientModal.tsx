'use client'

// The founder's unified "Send to client" modal — the ONE composer every
// document "send via email" affordance opens (matter Documents tab, the
// Send-to-client workflow step, the review reader). Prefills To/Cc/Subject/
// Message, shows the attachment card with a PDF/Word toggle, and sends through
// legal.email.send_draft_link (Contract B: client-only To, firm-staff-only Cc,
// mail.send audit row — which is why the "Logged to the matter timeline" line
// is a static fact here, not a checkbox: every send is always logged).
import { useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { shareUrlFor } from '@/lib/draftExport'
import { CheckIcon, LockIcon, SendIcon, XIcon } from '@/components/icons'

export interface SendToClientMatter {
  entityId: string
  matterNumber: string
  clientName: string | null
  clientEmail: string | null
}

export interface SendToClientDoc {
  documentVersionId: string
  documentKind: string
  versionNumber: number
  status: string
}

interface SendToClientModalProps {
  matter: SendToClientMatter
  doc: SendToClientDoc
  onClose: () => void
  onSent: (msg: string) => void
}

// "attorney_letter" → "Attorney letter" (sentence case, matches the comp header).
function titleForKind(kind: string): string {
  const s = kind.replace(/_/g, ' ').trim() || 'document'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// The attachment meta descriptor, from the REAL version status (no invented
// "final approved" claim on a pending draft).
function statusDescriptor(status: string): string {
  if (status === 'approved') return 'final approved draft'
  if (status === 'executed') return 'executed version'
  return `${status.replace(/_/g, ' ')} draft`
}

export function SendToClientModal({ matter, doc, onClose, onSent }: SendToClientModalProps) {
  const docTitle = titleForKind(doc.documentKind)
  const [to, setTo] = useState(matter.clientEmail ?? '')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(`${docTitle} — ${matter.matterNumber}`)
  const [message, setMessage] = useState(
    `Dear ${matter.clientName?.trim() || 'client'},\n\nPlease find attached the ${docTitle.toLowerCase()} prepared for your matter (${matter.matterNumber}). Let me know if you have any questions.\n\nBest regards,`,
  )
  const [format, setFormat] = useState<'pdf' | 'word'>('pdf')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filename = `${docTitle.replace(/\s+/g, '_')}.${format === 'word' ? 'docx' : 'pdf'}`
  const metaLine = `${format === 'word' ? 'Word' : 'PDF'} · v${doc.versionNumber} · ${statusDescriptor(doc.status)}`

  async function send() {
    if (busy || !to.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await callAttorneyMcp<{ to?: string }>({
        toolName: 'legal.email.send_draft_link',
        input: {
          matterEntityId: matter.entityId,
          documentVersionId: doc.documentVersionId,
          shareUrl: shareUrlFor(doc.documentVersionId),
          to: to.trim(),
          cc: cc.trim() || undefined,
          subject: subject.trim() || undefined,
          message,
          format,
        },
      })
      onSent(`Sent to ${result.to ?? to.trim()}`)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="li-send-overlay" onClick={() => !busy && onClose()}>
      <div
        className="li-send-card"
        role="dialog"
        aria-modal="true"
        aria-label={`Send to client — ${docTitle}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="li-send-head">
          <h2 className="li-send-title">Send To Client — {docTitle}</h2>
          <button
            type="button"
            className="li-send-x"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <XIcon size={17} />
          </button>
        </div>

        {error && <div className="alert alert-error li-send-alert">{error}</div>}

        <div className="li-send-field">
          <label className="li-send-label" htmlFor="li-send-to">
            To
          </label>
          <input
            id="li-send-to"
            className="li-send-input"
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="li-send-field">
          <label className="li-send-label" htmlFor="li-send-cc">
            Cc
          </label>
          <input
            id="li-send-cc"
            className="li-send-input"
            type="text"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            placeholder="Add co-counsel or paralegal…"
            disabled={busy}
          />
        </div>
        <div className="li-send-field">
          <label className="li-send-label" htmlFor="li-send-subject">
            Subject
          </label>
          <input
            id="li-send-subject"
            className="li-send-input"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="li-send-field">
          <label className="li-send-label" htmlFor="li-send-message">
            Message
          </label>
          <textarea
            id="li-send-message"
            className="li-send-input li-send-textarea"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="li-send-field">
          <span className="li-send-label">Attachment</span>
          <div className="li-send-attach">
            <span
              className={`li-send-attach-tile${format === 'word' ? ' li-send-attach-tile--word' : ''}`}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path
                  d="M14 3v5h5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <text
                  x="12"
                  y="18.2"
                  fontSize={format === 'word' ? 7 : 5.2}
                  fontWeight="800"
                  fill="currentColor"
                  stroke="none"
                  textAnchor="middle"
                >
                  {format === 'word' ? 'W' : 'PDF'}
                </text>
              </svg>
            </span>
            <span className="li-send-attach-info">
              <span className="li-send-attach-name">{filename}</span>
              <span className="li-send-attach-meta">{metaLine}</span>
            </span>
            <span className="li-send-toggle" role="group" aria-label="Attachment format">
              <button
                type="button"
                className={`li-send-toggle-pill${format === 'pdf' ? ' is-active' : ''}`}
                aria-pressed={format === 'pdf'}
                onClick={() => setFormat('pdf')}
                disabled={busy}
              >
                PDF
              </button>
              <button
                type="button"
                className={`li-send-toggle-pill${format === 'word' ? ' is-active' : ''}`}
                aria-pressed={format === 'word'}
                onClick={() => setFormat('word')}
                disabled={busy}
              >
                Word
              </button>
            </span>
          </div>
        </div>

        {/* Deliberately NOT a checkbox: every client send is always audit-logged
            via Contract B (mail.send), so an uncheckable checkbox would be a dead
            control. This states the fact instead. */}
        <div className="li-send-logged">
          <CheckIcon size={15} />
          Logged to the matter timeline
        </div>

        <div className="li-send-footer">
          <span className="li-send-secure">
            <LockIcon size={14} />
            Sent securely via the client portal
          </span>
          <span className="li-send-actions">
            <button type="button" className="li-send-btn-cancel" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="li-send-btn-send"
              onClick={() => void send()}
              disabled={busy || !to.trim()}
            >
              {busy ? <span className="spinner" /> : <SendIcon size={15} />}
              {busy ? 'Sending…' : 'Send To Client'}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
