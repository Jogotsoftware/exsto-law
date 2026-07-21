// The one password-validation function every set/claim/reset surface in the
// portal calls, client and server side (PT-3, founder walk item 15.22) — so a
// rule change can never drift between the inline JS check and the
// authoritative server check.
import { describe, it, expect } from 'vitest'
import {
  MIN_PASSWORD_LENGTH,
  validatePassword,
  passwordsMatch,
  passwordStrength,
  containsBannedChars,
  BANNED_PASSWORD_CHARS_RE,
} from '@/lib/passwordPolicy'

describe('validatePassword — the one min-length rule', () => {
  it('rejects anything shorter than the minimum', () => {
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(/at least 8/i)
    expect(validatePassword('')).toMatch(/at least 8/i)
  })
  it('accepts exactly the minimum length', () => {
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull()
  })
  it('accepts a long password', () => {
    expect(validatePassword('a very long passphrase indeed')).toBeNull()
  })
  it('does NOT reject punctuation the founder originally wanted banned — a hashed,', () => {
    // never-rendered credential gains nothing from a char ban and loses entropy.
    expect(validatePassword(`p'a<s>s"word`)).toBeNull()
  })
})

describe('passwordsMatch', () => {
  it('flags a mismatch', () => {
    expect(passwordsMatch('abcdefgh', 'abcdefgi')).toMatch(/do not match/i)
  })
  it('passes an exact match', () => {
    expect(passwordsMatch('abcdefgh', 'abcdefgh')).toBeNull()
  })
})

describe('passwordStrength — advisory only, never blocking', () => {
  it('scores below the minimum as weak', () => {
    expect(passwordStrength('short')).toBe('weak')
  })
  it('scores a plain lowercase-only 8-char password as weak or fair, not strong', () => {
    expect(passwordStrength('abcdefgh')).not.toBe('strong')
  })
  it('scores a long, mixed-class password as strong', () => {
    expect(passwordStrength('Tr0ub4dor&3xtra!')).toBe('strong')
  })
})

describe('containsBannedChars — trivial-to-enable, NOT wired into validatePassword by default', () => {
  it('detects the founder-named characters', () => {
    expect(containsBannedChars("o'brien")).toBe(true)
    expect(containsBannedChars('<script>')).toBe(true)
    expect(containsBannedChars('a > b')).toBe(true)
  })
  it('leaves a plain alphanumeric+symbol password alone', () => {
    expect(containsBannedChars('Sunshine!42')).toBe(false)
  })
  it('is a real, usable regex (not a stub)', () => {
    expect(BANNED_PASSWORD_CHARS_RE.test('normal-pass_1')).toBe(false)
  })
  it('validatePassword ignores banned characters by design (see module comment)', () => {
    expect(validatePassword("O'Brien!!")).toBeNull()
  })
})
