'use client'

// Matter › Activity: per-matter Emails card (WP-B2). Real Gmail threads matched to
// THIS matter — legal.mail.threads now accepts an optional matterEntityId filter
// (extends the existing tool; mail/page.tsx's firm-wide inbox is unaffected, it
// simply never passes the filter). Opening a row jumps into the real Mail tab at
// the same thread (?thread=); "Draft email" reuses the existing compose prime.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { launchCompose } from '@/lib/contractD'
import { GemCluster } from '@/components/GemSparkle'
import { MailIcon } from '@/components/icons'

interface ThreadSummary {
  gmailThreadId: string
  subject: string
  snippet: string
  lastAt: string | null
  messageCount: number
  participantEmails: string[]
  participantNames: Record<string, string>
}

function relativeDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(
    undefined,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  )
}

// Compact "Name +N more" sender label, same convention as the Mail inbox.
function senderLabel(t: ThreadSummary): string {
  const emails = t.participantEmails
  if (emails.length === 0) return '(unknown)'
  const bare = (emails[0] ?? '').toLowerCase()
  const first = t.participantNames[bare] ?? emails[0]
  return emails.length > 1 ? `${first} +${emails.length - 1}` : (first ?? '')
}

export function MatterEmailsCard({ matterEntityId }: { matterEntityId: string }) {
  const router = useRouter()
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clientEmail, setClientEmail] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    callAttorneyMcp<{ threads: ThreadSummary[] }>({
      toolName: 'legal.mail.threads',
      input: { matterEntityId },
    })
      .then((r) => {
        if (!cancelled) setThreads(r.threads)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setThreads([])
        }
      })
    callAttorneyMcp<{ matter: { clientEmail: string | null } | null }>({
      toolName: 'legal.matter.get',
      input: { matterEntityId },
    })
      .then((r) => {
        if (!cancelled) setClientEmail(r.matter?.clientEmail ?? undefined)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [matterEntityId])

  return (
    <section className="li-mat-card">
      <div className="li-mat-card-head">
        <h2 className="li-mat-card-title">Emails</h2>
        <button
          type="button"
          className="li-mat-draftemail-btn"
          onClick={() => launchCompose({ matterId: matterEntityId, to: clientEmail })}
        >
          <GemCluster size={17} />
          Draft email
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {threads === null ? (
        <p className="text-muted text-sm">
          <span className="spinner" /> Loading emails…
        </p>
      ) : threads.length === 0 ? (
        <p className="text-muted" style={{ padding: '4px 4px 8px' }}>
          No emails matched to this matter yet.
        </p>
      ) : (
        <div className="li-mat-emails-list">
          {threads.slice(0, 8).map((t) => (
            <button
              key={t.gmailThreadId}
              type="button"
              className="li-mat-email-row"
              onClick={() => router.push(`/attorney/mail?thread=${t.gmailThreadId}`)}
            >
              <span className="li-mat-email-ico">
                <MailIcon size={16} />
              </span>
              <span className="li-mat-email-main">
                <div className="li-mat-email-subject">{t.subject || '(no subject)'}</div>
                <div className="li-mat-email-meta">
                  {senderLabel(t)} · {relativeDate(t.lastAt)}
                </div>
              </span>
              <span className="li-mat-email-chip">
                {t.messageCount} {t.messageCount === 1 ? 'message' : 'messages'}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
