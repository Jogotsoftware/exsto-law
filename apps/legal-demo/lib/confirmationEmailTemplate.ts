// N1 — bilingual, firm-branded "confirm your email" template. Plain inline
// styles only (email clients strip <style> blocks unpredictably).
export type ConfirmationEmailLang = 'en' | 'es'

const COPY = {
  en: {
    subject: (firm: string) =>
      `Confirm your email to finish setting up your ${firm} portal account`,
    preheader: 'One click and you are in — this link expires in 24 hours.',
    heading: 'Confirm your email',
    body: (firm: string) =>
      `${firm} uses a secure client portal to share documents, messages, and invoices. Click below to confirm your email and finish setting up your account.`,
    button: 'Confirm email & sign in',
    fallback: 'Or copy this link into your browser:',
    expiry:
      'This link expires in 24 hours. If you did not request this, you can ignore this email.',
    footer: (firm: string) => `Sent by ${firm} via the client portal.`,
  },
  es: {
    subject: (firm: string) =>
      `Confirma tu correo para terminar de configurar tu cuenta del portal de ${firm}`,
    preheader: 'Un clic y listo — este enlace expira en 24 horas.',
    heading: 'Confirma tu correo electrónico',
    body: (firm: string) =>
      `${firm} usa un portal de clientes seguro para compartir documentos, mensajes y facturas. Haz clic abajo para confirmar tu correo y terminar de configurar tu cuenta.`,
    button: 'Confirmar correo e iniciar sesión',
    fallback: 'O copia este enlace en tu navegador:',
    expiry: 'Este enlace expira en 24 horas. Si no solicitaste esto, puedes ignorar este correo.',
    footer: (firm: string) => `Enviado por ${firm} a través del portal de clientes.`,
  },
} as const

export function buildConfirmationEmail(input: {
  firmName: string
  confirmUrl: string
  lang: ConfirmationEmailLang
}): { subject: string; html: string; text: string } {
  const c = COPY[input.lang] ?? COPY.en
  const firm = input.firmName

  const html = `
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${c.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
      <tr><td style="background:#0b2545;padding:24px 32px;">
        <span style="color:#d4af37;font-size:18px;font-weight:600;letter-spacing:0.02em;">${firm}</span>
      </td></tr>
      <tr><td style="padding:32px;">
        <h1 style="margin:0 0 16px;font-size:20px;color:#0b2545;">${c.heading}</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#333333;">${c.body(firm)}</p>
        <p style="margin:0 0 24px;">
          <a href="${input.confirmUrl}" style="display:inline-block;background:#0b2545;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:6px;">${c.button}</a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#666666;">${c.fallback}</p>
        <p style="margin:0 0 24px;font-size:13px;word-break:break-all;"><a href="${input.confirmUrl}" style="color:#0b2545;">${input.confirmUrl}</a></p>
        <p style="margin:0;font-size:13px;color:#999999;">${c.expiry}</p>
      </td></tr>
      <tr><td style="padding:16px 32px;border-top:1px solid #eeeeee;">
        <p style="margin:0;font-size:12px;color:#999999;">${c.footer(firm)}</p>
      </td></tr>
    </table>
  </td></tr>
</table>`.trim()

  const text = [
    c.heading,
    '',
    c.body(firm),
    '',
    input.confirmUrl,
    '',
    c.expiry,
    '',
    c.footer(firm),
  ].join('\n')

  return { subject: c.subject(firm), html, text }
}
