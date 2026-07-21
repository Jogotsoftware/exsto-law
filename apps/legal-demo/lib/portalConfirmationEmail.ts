// N1 — shared by every account-creation/resend door (intake finalize,
// self-service signup, resend-confirmation): mint an unconfirmed account +
// token via GoTrue admin (no Supabase email sent), then send our own
// firm-branded bilingual email via Resend. One place so all three doors stay
// consistent instead of drifting.
import type { ActionContext } from '@exsto/substrate'
import { getTenantSettings } from '@exsto/legal'
import { mintSignupConfirmation, mintResendConfirmation } from './supabaseAdmin'
import { sendClientEmail } from './clientEmail'
import { buildConfirmationEmail, type ConfirmationEmailLang } from './confirmationEmailTemplate'

export interface PortalConfirmationResult {
  status: 'created' | 'exists'
  emailSent: boolean
}

export async function issuePortalConfirmationEmail(
  ctx: ActionContext,
  input: { email: string; password: string; baseUrl: string; lang: ConfirmationEmailLang },
): Promise<PortalConfirmationResult> {
  const minted = await mintSignupConfirmation(input.email, input.password)
  if (minted.status === 'exists' || !minted.tokenHash) {
    return { status: 'exists', emailSent: false }
  }

  const confirmUrl = `${input.baseUrl}/portal/login?token_hash=${encodeURIComponent(
    minted.tokenHash,
  )}&type=signup`
  const settings = await getTenantSettings(ctx)
  const firmName = settings.firmName || 'Your firm'
  const email = buildConfirmationEmail({ firmName, confirmUrl, lang: input.lang })

  const result = await sendClientEmail(
    { to: input.email, subject: email.subject, html: email.html, text: email.text },
    firmName,
  )
  return { status: 'created', emailSent: result.sent }
}

// N1 — resend for an EXISTING unconfirmed account (no password in hand: the
// resend button doesn't ask for one). No-ops silently for an unknown or
// already-confirmed email — same anti-enumeration posture as the rest of the
// auth surface; the caller shows the same "if that address needs
// confirming…" message regardless of which branch actually ran.
export async function resendPortalConfirmationEmail(
  ctx: ActionContext,
  input: { email: string; baseUrl: string; lang: ConfirmationEmailLang },
): Promise<{ emailSent: boolean }> {
  const tokenHash = await mintResendConfirmation(input.email)
  if (!tokenHash) return { emailSent: false }

  const confirmUrl = `${input.baseUrl}/portal/login?token_hash=${encodeURIComponent(
    tokenHash,
  )}&type=signup`
  const settings = await getTenantSettings(ctx)
  const firmName = settings.firmName || 'Your firm'
  const email = buildConfirmationEmail({ firmName, confirmUrl, lang: input.lang })

  const result = await sendClientEmail(
    { to: input.email, subject: email.subject, html: email.html, text: email.text },
    firmName,
  )
  return { emailSent: result.sent }
}
