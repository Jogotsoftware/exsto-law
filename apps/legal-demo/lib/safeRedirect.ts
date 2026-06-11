// Validate an internal post-auth redirect target. The OAuth `returnTo` rides in
// an UNSIGNED state param, so it is attacker-controlled; a value like
// `//attacker.com/phishing` passes a naive `startsWith('/')` check and becomes a
// protocol-relative URL that the browser follows OFF-SITE (open redirect →
// phishing). Only allow clean, same-origin relative paths; everything else
// falls back. Used on both sides of the redirect (callback route + the
// auth/complete client page) so neither trusts the value alone.
export function safeInternalPath(value: string | null | undefined, fallback = '/attorney'): string {
  if (!value) return fallback
  // Reject protocol-relative (`//host`), backslash tricks (browsers fold `\`
  // into `/`), and anything not rooted at a single leading slash.
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('\t') ||
    value.includes('\n')
  ) {
    return fallback
  }
  try {
    // Resolve against a throwaway origin; if it escapes that origin it wasn't a
    // pure relative path. Return only path+query+hash.
    const u = new URL(value, 'https://internal.invalid')
    if (u.origin !== 'https://internal.invalid') return fallback
    return u.pathname + u.search + u.hash
  } catch {
    return fallback
  }
}
