// Production CAPTCHA hook for the unauthenticated public write path (booking/
// intake). The per-IP rate limiter is the first line; a CAPTCHA is the real
// anti-automation control for a public form. This is the SERVER half: when a
// provider secret is configured it requires + verifies a token; when it isn't
// (the demo default) it is a no-op so nothing breaks. Enabling it in production
// also requires adding the widget to the booking form so the client sends the
// token as `captchaToken` on the request body.
//
// Supports Cloudflare Turnstile (TURNSTILE_SECRET) and hCaptcha (HCAPTCHA_SECRET).

interface CaptchaConfig {
  secret: string
  verifyUrl: string
}

function captchaConfig(): CaptchaConfig | null {
  if (process.env.TURNSTILE_SECRET) {
    return {
      secret: process.env.TURNSTILE_SECRET,
      verifyUrl: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    }
  }
  if (process.env.HCAPTCHA_SECRET) {
    return { secret: process.env.HCAPTCHA_SECRET, verifyUrl: 'https://api.hcaptcha.com/siteverify' }
  }
  return null
}

export interface CaptchaResult {
  ok: boolean
  reason?: string
}

// Verifies the token when CAPTCHA is configured; otherwise allows (no-op).
export async function verifyCaptchaIfConfigured(
  token: string | undefined,
  remoteIp?: string,
): Promise<CaptchaResult> {
  const cfg = captchaConfig()
  if (!cfg) return { ok: true } // not enabled — demo / dev default

  if (!token) return { ok: false, reason: 'Captcha verification required.' }

  const form = new URLSearchParams({ secret: cfg.secret, response: token })
  if (remoteIp && remoteIp !== 'unknown') form.set('remoteip', remoteIp)

  try {
    const res = await fetch(cfg.verifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    })
    const data = (await res.json()) as { success?: boolean }
    return data.success ? { ok: true } : { ok: false, reason: 'Captcha verification failed.' }
  } catch {
    // Fail closed: if we can't reach the verifier while CAPTCHA is ENABLED,
    // reject rather than wave the request through.
    return { ok: false, reason: 'Captcha verification unavailable.' }
  }
}
