import { NextResponse } from 'next/server'
import { buildClearedSessionCookie } from '@/lib/session'

export const runtime = 'nodejs'

// Same hardcoded base as the OAuth callback: Netlify Functions hand Next.js a
// request.url with the internal port baked in, which breaks redirect URLs.
const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exstolaw.netlify.app'
).replace(/\/$/, '')

function logout(): NextResponse {
  const res = NextResponse.redirect(`${BASE_URL}/`)
  res.headers.set('Set-Cookie', buildClearedSessionCookie())
  return res
}

// GET so a plain link/navigation can sign out; POST too for form/fetch callers.
export async function GET() {
  return logout()
}

export async function POST() {
  return logout()
}
