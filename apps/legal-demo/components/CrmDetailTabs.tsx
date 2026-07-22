'use client'

// Overview · Documents · Activity tab bar for the CRM client and contact detail
// pages — the same NavTabs primitive + longest-prefix active rule the matter
// workspace uses (MatterTabs), so a client/contact reads like a matter: one
// header, tabbed panels. `base` is the detail root (/attorney/crm/<id> or
// /attorney/crm/contacts/<id>).
import { NavTabs } from './NavTabs'

export function CrmDetailTabs({ base }: { base: string }) {
  return (
    <NavTabs
      ariaLabel="Detail sections"
      className="li-crm-detail-tabs"
      tabs={[
        { href: base, label: 'Overview' },
        { href: `${base}/documents`, label: 'Documents' },
        { href: `${base}/activity`, label: 'Activity' },
      ]}
    />
  )
}
