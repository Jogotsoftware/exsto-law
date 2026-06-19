'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { UnifiedAssistantChat } from '@/components/UnifiedAssistantChat'
import { MessageCircleIcon, XIcon } from '@/components/icons'

const INTRO_GLOBAL =
  'Ask anything about using the app — intake, booking, drafting, review, Granola import, settings. Switch the model up top. Or just tell me what you think; your feedback goes straight to the team.'
const INTRO_MATTER =
  'Grounded in the matter you’re viewing — ask about it, request a draft, or get help with the app. Switch the model up top.'
const INTRO_CONTACT =
  'Grounded in the client you’re viewing — ask about them or get help with the app. Switch the model up top.'

// Derive the assistant's context from the page you're on, so the one global chat
// follows you: open it on a matter and it's grounded in that matter; on a contact,
// that contact; anywhere else it's the general app-help / feedback chat. Client
// (CRM company) scope isn't a chat scope server-side yet, so those pages get the
// general chat for now.
function scopeForPath(pathname: string): {
  matterEntityId?: string
  contactEntityId?: string
} {
  const m = pathname.match(/^\/attorney\/matters\/([^/]+)/)
  if (m && m[1] && m[1] !== 'new') return { matterEntityId: m[1] }
  const c = pathname.match(/^\/attorney\/crm\/contacts\/([^/]+)/)
  if (c && c[1]) return { contactEntityId: c[1] }
  return {}
}

// Floating assistant FAB, mounted once in the attorney layout. It hosts the unified
// assistant chat and now picks up the CURRENT PAGE's context when opened: a matter
// or a client/contact, else global app-help + beta feedback. (Replaces the
// separate per-matter embedded chat — the one assistant follows the attorney.)
export function FeedbackChat() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  // Snapshot the scope when the panel opens, so an in-progress chat doesn't reset
  // mid-conversation if the attorney navigates while it's open.
  const [scope, setScope] = useState<{ matterEntityId?: string; contactEntityId?: string }>({})
  const inputFocusRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) inputFocusRef.current?.querySelector('textarea')?.focus()
  }, [open])

  function openChat() {
    setScope(scopeForPath(pathname))
    setOpen(true)
  }

  if (!open) {
    return (
      <button type="button" className="feedback-fab" onClick={openChat} aria-label="Open assistant">
        <MessageCircleIcon size={18} />
        Assistant
      </button>
    )
  }

  const scoped = Boolean(scope.matterEntityId || scope.contactEntityId)
  const intro = scope.matterEntityId
    ? INTRO_MATTER
    : scope.contactEntityId
      ? INTRO_CONTACT
      : INTRO_GLOBAL

  return (
    <div className="feedback-panel" role="dialog" aria-label="Assistant">
      <div className="feedback-panel-head">
        <div className="feedback-panel-title">Assistant</div>
        <button
          type="button"
          className="feedback-panel-close"
          onClick={() => setOpen(false)}
          aria-label="Close"
        >
          <XIcon size={16} />
        </button>
      </div>
      <div className="feedback-panel-body" ref={inputFocusRef}>
        {/* Keyed by scope so opening on a different page starts a fresh, correctly
            grounded chat (and loads that matter/contact's thread). */}
        <UnifiedAssistantChat
          key={scope.matterEntityId ?? scope.contactEntityId ?? 'global'}
          matterEntityId={scope.matterEntityId}
          contactEntityId={scope.contactEntityId}
          loadThread={scoped}
          intro={intro}
          placeholder="Ask a question or share feedback…"
        />
      </div>
    </div>
  )
}
