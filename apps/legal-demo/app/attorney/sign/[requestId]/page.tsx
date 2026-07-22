'use client'

// ESIGN-ATTORNEY-REVIEW-1 — attorney signing surface: the attorney signs their
// OWN countersignature request (added via #476) in-app, instead of only being
// able to view status. Mirrors app/portal/sign/[requestId]/page.tsx, but calls
// the attorney MCP route (legal.esign.sign_load / sign_submit / sign_decline)
// instead of the client-portal one. Reuses the shared SignDocument surface.
//
// TASK-QUEUE-3 — brought up to parity with the document-review reader: the
// attorney's own saved signature (Settings → Signature) now prefills instead
// of forcing a fresh draw/type every time, and a queue-started "Start Tasks"
// session walks straight through selected sign tasks the same way it already
// walks document-review tasks (Exit / Prev / Next, auto-advance on
// sign/decline, Matter pill + Brief button).
import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { SignDocument, type SavedSignature, type SignableDoc } from '@/components/SignDocument'
import { BriefButton } from '@/components/BriefButton'
import {
  clearTaskSession,
  hrefFor,
  readTaskSession,
  writeTaskSession,
  type TaskSession,
} from '@/lib/taskSession'

type AttorneySignableDoc = SignableDoc & {
  envelopeId: string
  matterEntityId: string | null
  matterNumber: string | null
}

export default function AttorneySignPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = use(params)
  const router = useRouter()
  const [doc, setDoc] = useState<AttorneySignableDoc | null>(null)
  const [savedSignature, setSavedSignature] = useState<SavedSignature | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [session, setSession] = useState<TaskSession | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const inSession = new URLSearchParams(window.location.search).get('queue') === 'session'
    setSession(inSession ? readTaskSession() : null)
  }, [requestId])
  const sessionPos = session ? session.items.findIndex((it) => it.id === requestId) : -1

  useEffect(() => {
    setDoc(null)
    setError(null)
    callAttorneyMcp<AttorneySignableDoc>({
      toolName: 'legal.esign.sign_load',
      input: { requestId },
    })
      .then((r) => setDoc(r))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    callAttorneyMcp<{ signature: SavedSignature | null }>({
      toolName: 'legal.settings.attorney_signature.get',
    })
      .then((r) => setSavedSignature(r.signature))
      .catch(() => setSavedSignature(null))
  }, [requestId])

  function exitSession() {
    clearTaskSession()
    router.push('/attorney/review')
  }

  function goSession(delta: number) {
    if (!session || sessionPos < 0) return
    const next = sessionPos + delta
    if (next < 0 || next >= session.items.length) return
    writeTaskSession({ items: session.items, index: next })
    router.push(hrefFor(session.items[next]!))
  }

  // Sign/decline landed. In a step-through session, auto-advance to the next
  // task (which may be a document_review row — hrefFor routes accordingly), or
  // exit back to the queue when done. Outside a session, let SignDocument show
  // its own "Signed"/"Declined" screen.
  function advanceOrExit(): boolean {
    if (session && sessionPos >= 0) {
      const next = sessionPos + 1
      if (next < session.items.length) {
        writeTaskSession({ items: session.items, index: next })
        router.push(hrefFor(session.items[next]!))
      } else {
        clearTaskSession()
        router.push('/attorney/review')
      }
      return true
    }
    return false
  }

  if (error)
    return (
      <div className="page">
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      </div>
    )
  if (!doc)
    return (
      <div className="page">
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      </div>
    )

  const prevDisabled = !session || sessionPos <= 0
  const nextDisabled = !session || sessionPos < 0 || sessionPos >= session.items.length - 1

  return (
    <main className="li-rev">
      <div className="li-rev-top">
        <div className="li-rev-top-left">
          {sessionPos >= 0 && session ? (
            <button type="button" className="li-rev-pill" onClick={exitSession}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <polyline
                  points="15 18 9 12 15 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Exit signing ({sessionPos + 1} of {session.items.length})
            </button>
          ) : (
            <Link href="/attorney/review" className="li-rev-pill">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <polyline
                  points="15 18 9 12 15 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Exit signing
            </Link>
          )}
          {doc.matterEntityId && (
            <Link
              href={`/attorney/matters/${doc.matterEntityId}`}
              className="li-rev-pill li-rev-pill--matter"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M4 4h9l5 5v11H4z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <path
                  d="M13 4v5h5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
              Matter&nbsp;<span className="li-rev-mono">{doc.matterNumber}</span>
            </Link>
          )}
          {doc.matterEntityId && (
            <BriefButton
              lazy
              scope={{ kind: 'matter', matterEntityId: doc.matterEntityId }}
              className="li-rev-pill"
              label="Brief"
            />
          )}
        </div>
        <div className="li-rev-top-right">
          <button
            type="button"
            className="li-rev-nav"
            onClick={() => goSession(-1)}
            disabled={prevDisabled}
            title="Previous task"
            aria-label="Previous task"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <polyline
                points="15 18 9 12 15 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="li-rev-nav"
            onClick={() => goSession(1)}
            disabled={nextDisabled}
            title="Next task"
            aria-label="Next task"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <polyline
                points="9 18 15 12 9 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <SignDocument
        doc={doc}
        fileUrl={doc.isFile ? `/api/attorney/esign/${doc.envelopeId}/file` : null}
        // ES-MULTIDOC-1 — each document streams through the attorney file
        // route with its ?doc=N index; markdown documents render inline.
        fileUrlForDoc={(i) => `/api/attorney/esign/${doc.envelopeId}/file?doc=${i}`}
        savedSignature={savedSignature}
        onSign={async ({ signatureName, signatureData, fieldValues, consent }) => {
          const r = await callAttorneyMcp<{ completed: boolean }>({
            toolName: 'legal.esign.sign_submit',
            input: { requestId, signatureName, signatureData, fieldValues, consent },
          })
          return { completed: Boolean(r.completed) }
        }}
        onDecline={async () => {
          await callAttorneyMcp({
            toolName: 'legal.esign.sign_decline',
            input: { requestId },
          })
        }}
        onSigned={advanceOrExit}
        onDeclined={advanceOrExit}
      />
    </main>
  )
}
