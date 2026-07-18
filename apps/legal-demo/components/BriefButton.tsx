'use client'

// Brief engine WP2/WP3 — the Brief door (design: docs/design/briefs/DESIGN.md
// §6: "Shared <BriefButton scope target/> + <BriefModal/>"). A plain button
// that opens the BriefModal; ALL brief state (get on open, generate on click
// only — never on open) lives in the modal, so the button costs the page
// nothing. `scope` is the one thing that differs between homes — the matter
// header (WP2) and the CRM client detail (WP3) pass a different target and get
// the matter-flavored or client-flavored copy/tool calls for free.
import { useState } from 'react'
import { FileTextIcon } from '@/components/icons'
import { BriefModal, type BriefScope } from '@/components/BriefModal'

export function BriefButton({
  scope,
  className,
  label,
}: {
  scope: BriefScope
  // Homes style this differently (li-brief-btn beside the matter Actions menu
  // vs li-crm-btn beside CRM's Email/Schedule/Edit) — default to li-brief-btn.
  className?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const defaultLabel = scope.kind === 'matter' ? 'Matter brief' : 'Client brief'
  const title =
    scope.kind === 'matter'
      ? 'The synthesized brief of everything on this matter'
      : 'The synthesized brief of this client and every one of their matters'
  return (
    <>
      <button
        type="button"
        className={className ?? 'li-brief-btn'}
        onClick={() => setOpen(true)}
        title={title}
      >
        <FileTextIcon size={15} />
        {label ?? defaultLabel}
      </button>
      {open && <BriefModal scope={scope} onClose={() => setOpen(false)} />}
    </>
  )
}
