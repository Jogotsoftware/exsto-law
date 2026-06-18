// Contract D — comms launchers. Other surfaces (S2's client/matter pages) call
// these to open the composer / event creator PRE-WIRED to a record. They are
// standalone functions (callable from any button handler) that navigate to the
// Mail / Calendar surface with the binding encoded in the query string; those
// pages read it on mount and open their composer/scheduler prefilled. Keep the
// signatures stable — S2 imports these.

export interface LaunchComposeArgs {
  // Either a known recipient email, or a contactId the Mail page resolves to one.
  to?: string
  contactId?: string
  matterId?: string
  // Optional starting subject / template selection.
  subject?: string
  templateId?: string
}

export interface LaunchSchedulerArgs {
  contactId?: string
  matterId?: string
}

function go(path: string, params: Record<string, string | undefined>): void {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, v)
  }
  const url = qs.toString() ? `${path}?${qs.toString()}` : path
  if (typeof window !== 'undefined') window.location.assign(url)
}

// Open the Mail composer pre-wired to a contact/matter (and optional subject).
export function launchCompose(args: LaunchComposeArgs = {}): void {
  go('/attorney/mail', {
    compose: '1',
    to: args.to,
    contactId: args.contactId,
    matterId: args.matterId,
    subject: args.subject,
    templateId: args.templateId,
  })
}

// Open the Calendar event creator pre-wired to a matter (and optional contact).
export function launchScheduler(args: LaunchSchedulerArgs = {}): void {
  go('/attorney/calendar', {
    create: '1',
    matterId: args.matterId,
    contactId: args.contactId,
  })
}
