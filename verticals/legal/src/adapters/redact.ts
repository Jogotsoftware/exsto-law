// Defense-in-depth secret redaction for text we persist or surface.
//
// A security audit (2026-06-11) confirmed that today's provider SDKs
// (Anthropic, gaxios/Google) build their error messages from the API RESPONSE
// body, never the request header — so resolved keys do not currently reach the
// strings we store via markConnectionError. This helper makes that property
// hold by construction regardless of future SDK behavior: before persisting any
// third-party error text, scrub the exact secret(s) we just used. It is the
// caller's job to pass the secret values it holds; we also scrub anything that
// looks like a long bearer/sk- token as a backstop.

const TOKEN_LIKE = /\b(?:sk-|pk-|whsec_|Bearer\s+)[A-Za-z0-9_\-]{12,}\b/g

export function redactSecret(text: string, ...secrets: Array<string | null | undefined>): string {
  let out = text
  for (const s of secrets) {
    if (s && s.length >= 6) {
      // Escape regex metacharacters in the literal secret before global replace.
      const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      out = out.replace(new RegExp(escaped, 'g'), '***')
    }
  }
  return out.replace(TOKEN_LIKE, '***')
}
