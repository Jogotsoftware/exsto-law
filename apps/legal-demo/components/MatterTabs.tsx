'use client'

// Shared tab bar for the matter editor: Overview · Activity · Documents · Tasks ·
// Billing. Rendered by the /attorney/matters/[id] layout so the matter's panels
// feel like one workspace instead of one long scroll.
import { NavTabs } from './NavTabs'

export function MatterTabs({ matterEntityId }: { matterEntityId: string }) {
  const base = `/attorney/matters/${matterEntityId}`
  return (
    <NavTabs
      ariaLabel="Matter workspace"
      className="li-mat-tabs"
      tabs={[
        { href: base, label: 'Overview' },
        { href: `${base}/activity`, label: 'Activity' },
        { href: `${base}/documents`, label: 'Documents' },
        { href: `${base}/tasks`, label: 'Tasks' },
        { href: `${base}/billing`, label: 'Billing' },
      ]}
    />
  )
}
