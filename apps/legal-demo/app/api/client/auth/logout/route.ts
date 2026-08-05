import { NextResponse } from 'next/server'
import { buildClearedClientSessionCookie } from '@/lib/clientSession'
import { requestOrigin } from '@/lib/requestOrigin'

export const runtime = 'nodejs'

// ORIGIN-1 rule 2: sign out back to the host the user is on (requestOrigin
// validates the forwarded host — request.url's origin is still not trusted,
// Netlify Functions bake an internal port into it).
function logout(request: Request): NextResponse {
  const res = NextResponse.redirect(`${requestOrigin(request)}/`)
  res.headers.set('Set-Cookie', buildClearedClientSessionCookie())
  return res
}

// GET so a plain link/navigation can sign out; POST too for form/fetch callers.
export async function GET(request: Request) {
  return logout(request)
}

export async function POST(request: Request) {
  return logout(request)
}
