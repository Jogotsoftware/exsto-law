import { NextResponse } from 'next/server'
import { buildClearedAdminSessionCookie } from '@/lib/adminSession'

export const runtime = 'nodejs'

// Clear the admin session cookie. POST so it isn't triggerable by a bare GET.
export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.headers.set('Set-Cookie', buildClearedAdminSessionCookie())
  return res
}
