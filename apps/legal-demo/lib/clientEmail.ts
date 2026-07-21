// N1 — firm-branded transactional email to CLIENTS (never noreply@supabase).
// Independent of the ops-alert channel (lib/../workers/runtime/src/liveness.ts
// ALERT_EMAIL_*, which is for internal crash alerts) and independent of the
// attorney's own Gmail adapter (api/attorney/mail/send) — this is system mail
// sent as the firm to a client, so it must work even when no attorney is
// signed in. Resend-shaped by default (same {from,to,subject,html,text} POST
// as the alert channel); CLIENT_EMAIL_ENDPOINT overrides the provider URL.
//
// Best-effort by design: an unconfigured or failing send never blocks account
// creation — the account exists either way, and the confirm-page resend
// button is the recovery path. Callers should log the outcome, not throw.
export interface ClientEmailRequest {
  to: string
  subject: string
  html: string
  text: string
}

export interface ClientEmailResult {
  sent: boolean
  reason?: string
}

function configured(): { apiKey: string; from: string; endpoint: string } | null {
  const apiKey = process.env.CLIENT_EMAIL_API_KEY
  const from = process.env.CLIENT_EMAIL_FROM
  if (!apiKey || !from) return null
  return {
    apiKey,
    from,
    endpoint: process.env.CLIENT_EMAIL_ENDPOINT ?? 'https://api.resend.com/emails',
  }
}

export function clientEmailConfigured(): boolean {
  return configured() !== null
}

// `fromName` lets the display name be the firm ("Pacheco Law <onboarding@…>")
// while the verified sending address stays the one fixed domain in
// CLIENT_EMAIL_FROM — Resend requires the address itself to match a verified
// domain, but the display name is free text.
export async function sendClientEmail(
  req: ClientEmailRequest,
  fromName?: string | null,
): Promise<ClientEmailResult> {
  const cfg = configured()
  if (!cfg) {
    console.warn('[clientEmail] CLIENT_EMAIL_API_KEY/CLIENT_EMAIL_FROM not set — not sending', {
      to: req.to,
      subject: req.subject,
    })
    return { sent: false, reason: 'not_configured' }
  }
  const from = fromName ? `${fromName} <${cfg.from}>` : cfg.from
  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [req.to],
        subject: req.subject,
        html: req.html,
        text: req.text,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[clientEmail] send failed', res.status, body)
      return { sent: false, reason: `http_${res.status}` }
    }
    return { sent: true }
  } catch (e) {
    console.error('[clientEmail] send threw', e)
    return { sent: false, reason: 'exception' }
  }
}
