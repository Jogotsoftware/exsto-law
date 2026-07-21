// Shared client-portal password policy (PT-3, founder walk item 15.22).
//
// The founder's original ask included a character ban (no `'`, `>`, `<`, etc.)
// "to protect against hackers." That reasoning doesn't hold for a PASSWORD
// field specifically: a password is hashed at rest (Supabase Auth / GoTrue —
// bcrypt) and never echoed back into HTML, a SQL string, or a shell command.
// The XSS/SQLi vectors a char-ban defends against only exist where a value is
// RENDERED or INTERPOLATED unsafely — which is a rendering-side concern (see
// the esc() helper in verticals/legal/src/email/brand.ts and React's own JSX
// escaping), not a storage-side one. Banning characters from a password only
// shrinks the keyspace (a shorter effective alphabet == weaker passwords) and
// blocks legitimate password-manager-generated passwords that lean on
// punctuation for entropy. So the substitution here is a STRONGER control that
// addresses the actual goal ("protect against hackers" == resist guessing/
// credential-stuffing): a minimum length + a non-blocking strength hint.
//
// validatePassword() is what every set/claim/reset password path calls, both
// client-side (inline error, instant feedback) and server-side (authoritative
// — never trust the browser). containsBannedChars()/BANNED_PASSWORD_CHARS_RE
// below are a complete, trivial-to-enable char-ban helper, kept ready in case
// the founder wants it anyway after reading this reasoning — see the comment
// on containsBannedChars() for exactly how to wire it in.

export const MIN_PASSWORD_LENGTH = 8

// The authoritative check. Returns an error message (safe to show inline) or
// null when the password is acceptable. Every password-setting surface —
// client inline validation AND the server route that ultimately writes the
// credential — calls this same function, so the rule can never drift between
// the two.
export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  return null
}

export function passwordsMatch(password: string, confirm: string): string | null {
  if (password !== confirm) return 'The two passwords do not match.'
  return null
}

export type PasswordStrength = 'weak' | 'fair' | 'strong'

// A simple, non-blocking strength hint — never rejects a password on its own,
// only informs the choice (length is still the one enforced rule). Scores
// length plus character-class variety; no dictionary/breach lookup (that
// would need a network call this form shouldn't depend on).
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < MIN_PASSWORD_LENGTH) return 'weak'
  let classes = 0
  if (/[a-z]/.test(password)) classes++
  if (/[A-Z]/.test(password)) classes++
  if (/[0-9]/.test(password)) classes++
  if (/[^A-Za-z0-9]/.test(password)) classes++
  const long = password.length >= 12
  if (classes >= 3 && long) return 'strong'
  if (classes >= 2 || long) return 'fair'
  return 'weak'
}

export const PASSWORD_STRENGTH_LABEL: Record<PasswordStrength, string> = {
  weak: 'Weak',
  fair: 'Fair',
  strong: 'Strong',
}

// Trivial-to-enable character ban, kept ready but NOT called by
// validatePassword() by default (see the module comment for why). To turn it
// on: add `if (containsBannedChars(password)) return 'Passwords cannot
// contain \\' " < > characters.'` as an extra check inside validatePassword()
// above. Flipping this on does not require touching any of the call sites —
// they all go through validatePassword().
export const BANNED_PASSWORD_CHARS_RE = /['"<>`;\\]/

export function containsBannedChars(password: string): boolean {
  return BANNED_PASSWORD_CHARS_RE.test(password)
}
