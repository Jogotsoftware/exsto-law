import { redirect } from 'next/navigation'

// Settings no longer renders as one long scroll — WP-G split it into real
// routed sub-pages (docs/design/legal-instruments/WIRING.md §WP-G). The bare
// /attorney/settings path lands on the first section, matching the rail's
// default expanded state.
export default function SettingsPage(): never {
  redirect('/attorney/settings/integrations')
}
