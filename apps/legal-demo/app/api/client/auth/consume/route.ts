import { NextResponse } from 'next/server'
import '@exsto/legal/mcp'
import { safeInternalPath } from '@/lib/safeRedirect'
import { verifyClientMagicToken } from '@/lib/clientSession'
import { mintClientSessionResponse } from '@/lib/clientSessionMint'

export const runtime = 'nodejs'

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exstolaw.netlify.app'
).replace(/\/$/, '')

// POST { token, continue? } — consume a magic-link token and start a session.
//
//   • verify the magic token's MAC + expiry (domain-separated: an attorney or
//     client-session token fails here),
//   • re-check active + RE-RESOLVE matterIds + mint the cookie (shared mint path),
//   • redirect to a validated internal path (default /portal).
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    token?: unknown
    continue?: unknown
  } | null
  const token = typeof body?.token === 'string' ? body.token : null
  const continueParam = typeof body?.continue === 'string' ? body.continue : null
  const dest = safeInternalPath(continueParam, '/portal')

  const magic = verifyClientMagicToken(token)
  if (!magic) {
    return NextResponse.json(
      { error: 'This sign-in link is invalid or has expired. Request a new one.' },
      { status: 401 },
    )
  }

  return mintClientSessionResponse(magic.tenantId, magic.clientContactId, {
    redirect: `${BASE_URL}${dest}`,
    path: dest,
  })
}
