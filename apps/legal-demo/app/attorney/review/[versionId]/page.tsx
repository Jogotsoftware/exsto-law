'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  DocumentReviewer,
  type DocumentReviewerDisposeResult,
  type DocumentReviewerLoadedInfo,
} from '@/components/DocumentReviewer'
import {
  clearTaskSession,
  hrefFor,
  readTaskSession,
  writeTaskSession,
  type TaskSession,
} from '@/lib/taskSession'
import { BriefButton } from '@/components/BriefButton'

export default function DraftReviewPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params)
  const router = useRouter()

  const [session, setSession] = useState<TaskSession | null>(null)
  // Re-derive from the URL + sessionStorage on every version shown — covers
  // both the initial load and a fresh ?queue=session link opened while
  // already on a review page (a client-side nav that swaps `versionId` without
  // remounting this component).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const inSession = new URLSearchParams(window.location.search).get('queue') === 'session'
    setSession(inSession ? readTaskSession() : null)
  }, [versionId])
  // Matter/document identity for the top bar's "Matter <number>" pill — reported
  // by DocumentReviewer once it loads (this wrapper no longer fetches the draft
  // itself; the extracted component owns that read).
  const [loaded, setLoaded] = useState<DocumentReviewerLoadedInfo | null>(null)

  const sessionPos = session ? session.items.findIndex((it) => it.id === versionId) : -1

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

  // A disposition (approve/reject) landed. In a step-through session, auto-advance
  // to the next task (which may be an esign row — hrefFor routes accordingly), or
  // exit back to the queue when done — and tell DocumentReviewer we've handled the
  // aftermath ourselves (`true`) so it doesn't also try to swap/refresh a surface
  // that's about to navigate away. Outside a session, let DocumentReviewer
  // refresh/swap itself in place.
  function handleCompleted(_result: DocumentReviewerDisposeResult): boolean {
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

  // A new version now supersedes the one on the URL (edit-save, or approve's
  // system-token resolution minting v(n+1)) — DocumentReviewer already swapped
  // to it internally; sync the URL so a refresh/share stays on the right version.
  function handleVersionChanged(newVersionId: string) {
    router.replace(`/attorney/review/${newVersionId}`)
  }

  const prevDisabled = !session || sessionPos <= 0
  const nextDisabled = !session || sessionPos < 0 || sessionPos >= session.items.length - 1

  return (
    <main className="li-rev">
      {/* top toolbar: exit / matter pills + prev / next */}
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
              Exit review ({sessionPos + 1} of {session.items.length})
            </button>
          ) : (
            // Direct-open (row click / deep link, no Start-Tasks session): no
            // honest n/m is available here without fetching the whole pending
            // queue just to guess a position the attorney never walked — so the
            // pill reads plain "Exit review" rather than fabricate a count.
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
              Exit review
            </Link>
          )}
          {loaded && (
            <Link
              href={`/attorney/matters/${loaded.matterEntityId}`}
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
              Matter&nbsp;<span className="li-rev-mono">{loaded.matterNumber}</span>
            </Link>
          )}
          {loaded && (
            <BriefButton
              lazy
              scope={{ kind: 'matter', matterEntityId: loaded.matterEntityId }}
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
            title="Previous draft"
            aria-label="Previous draft"
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
            title="Next draft"
            aria-label="Next draft"
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

      <DocumentReviewer
        versionId={versionId}
        onLoaded={setLoaded}
        onCompleted={handleCompleted}
        onVersionChanged={handleVersionChanged}
      />
    </main>
  )
}
