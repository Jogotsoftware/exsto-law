'use client'

// Brief engine WP2 — the Matter Brief door on the matter-detail header (design:
// docs/design/briefs/DESIGN.md §6). A plain header button that opens the
// BriefModal; ALL brief state (get on open, generate on click only — never on
// open) lives in the modal, so the button costs the page nothing. Shared shape
// so WP3 (CRM client header) and later homes reuse it with a different target.
import { useState } from 'react'
import { FileTextIcon } from '@/components/icons'
import { BriefModal } from '@/components/BriefModal'

export function BriefButton({ matterEntityId }: { matterEntityId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="li-brief-btn"
        onClick={() => setOpen(true)}
        title="The synthesized brief of everything on this matter"
      >
        <FileTextIcon size={15} />
        Matter brief
      </button>
      {open && <BriefModal matterEntityId={matterEntityId} onClose={() => setOpen(false)} />}
    </>
  )
}
