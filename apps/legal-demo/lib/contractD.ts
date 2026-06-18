// Contract D — comms launchers, CONSUMED here (WP2.2), not implemented here.
//
// The buttons on the client + matter pages call these to open the existing comms
// surfaces (the Mail tab's compose, the Calendar tab's scheduler) carrying the
// contact/matter context. We do not implement sending/scheduling — Mail compose
// honors these query params (legal.mail.compose) and Calendar is the scheduler.
export interface ComposeArgs {
  contactId?: string
  matterId?: string
  templateId?: string
  to?: string
  subject?: string
}

export interface SchedulerArgs {
  contactId?: string
  matterId?: string
  to?: string
}

export function composeHref(args: ComposeArgs): string {
  const p = new URLSearchParams({ compose: '1' })
  if (args.to) p.set('to', args.to)
  if (args.subject) p.set('subject', args.subject)
  if (args.contactId) p.set('contactId', args.contactId)
  if (args.matterId) p.set('matterId', args.matterId)
  if (args.templateId) p.set('templateId', args.templateId)
  return `/attorney/mail?${p.toString()}`
}

export function schedulerHref(args: SchedulerArgs): string {
  const p = new URLSearchParams()
  if (args.contactId) p.set('contactId', args.contactId)
  if (args.matterId) p.set('matterId', args.matterId)
  if (args.to) p.set('to', args.to)
  const q = p.toString()
  return q ? `/attorney/calendar?${q}` : '/attorney/calendar'
}

export function launchCompose(args: ComposeArgs): void {
  if (typeof window !== 'undefined') window.location.assign(composeHref(args))
}

export function launchScheduler(args: SchedulerArgs): void {
  if (typeof window !== 'undefined') window.location.assign(schedulerHref(args))
}
