'use client'

// Modern legal-tech sidebar: navy gradient, EB Garamond wordmark with a gold
// crest, icon-led nav with rounded active pills + gold active accent. Styled
// via .att-side-* classes in globals.css (so hover/active states work).
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FIRM_NAME, PRODUCT_TAGLINE, PRODUCT_STAGE } from '@/lib/brand'
import {
  Building2Icon,
  CalendarIcon,
  CheckCircleIcon,
  CopyIcon,
  FileTextIcon,
  HelpCircleIcon,
  LayersIcon,
  LayoutGridIcon,
  MailIcon,
  ScaleIcon,
  SettingsIcon,
  UsersIcon,
  BriefcaseIcon,
} from '@/components/icons'

const NAV: Array<{
  href: string
  label: string
  exact?: boolean
  Icon: (props: { size?: number }) => React.JSX.Element
}> = [
  { href: '/attorney', label: 'Dashboard', exact: true, Icon: LayoutGridIcon },
  { href: '/attorney/matters', label: 'Matters', Icon: BriefcaseIcon },
  { href: '/attorney/contacts', label: 'Contacts', Icon: UsersIcon },
  { href: '/attorney/clients', label: 'Clients', Icon: Building2Icon },
  { href: '/attorney/review', label: 'Review', Icon: CheckCircleIcon },
  { href: '/attorney/calendar', label: 'Calendar', Icon: CalendarIcon },
  { href: '/attorney/mail', label: 'Mail', Icon: MailIcon },
  { href: '/attorney/services', label: 'Services', Icon: LayersIcon },
  { href: '/attorney/templates', label: 'Templates', Icon: CopyIcon },
  { href: '/attorney/questionnaires', label: 'Questionnaires', Icon: HelpCircleIcon },
  { href: '/attorney/billing', label: 'Billing', Icon: FileTextIcon },
  { href: '/attorney/settings', label: 'Settings', Icon: SettingsIcon },
]

export function AttorneySidebar() {
  const pathname = usePathname()
  const isActive = (item: (typeof NAV)[number]) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href)

  return (
    <aside className="att-side">
      <Link href="/attorney" className="att-side-brand">
        <span className="att-side-mark">
          <ScaleIcon size={18} />
        </span>
        <span className="att-side-brand-text">
          <span className="att-side-brand-name">{FIRM_NAME}</span>
          <span className="att-side-brand-sub">
            {PRODUCT_TAGLINE} · {PRODUCT_STAGE}
          </span>
        </span>
      </Link>
      <nav className="att-side-nav">
        {NAV.map((item) => {
          const active = isActive(item)
          const { Icon } = item
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`att-side-link ${active ? 'active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="att-side-ico">
                <Icon size={18} />
              </span>
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
      <div className="att-side-foot">AI-native legal practice</div>
    </aside>
  )
}
