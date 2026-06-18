// Granola OAuth (browser, Dynamic Client Registration) — WP1.2.
//
// Granola exposes its data ONLY through a remote MCP server
// (https://mcp.granola.ai/mcp) behind browser-based OAuth 2.0 with Dynamic
// Client Registration (DCR): there is NO API key / service-account path for MCP.
// So the legacy api-key REST integration (public-api.granola.ai) is retired and
// each attorney connects their own Granola via this OAuth flow (per-attorney,
// migration 0016), exactly like Google.
//
// ⚠️ ACTIVATION-GATED / UNVERIFIED: the live exchange requires an attorney to
// complete the Granola browser sign-in against a real Granola account. Per the
// product decision (big-bang, no api-key fallback) the api-key path is removed,
// so until that first live sign-in succeeds Granola ingestion has no path. The
// code below is structured to Granola's documented OAuth/DCR + the well-known
// discovery doc; it is not exercised by automated tests (no live OAuth in CI).
//
// Public client + PKCE: DCR issues a public client (no secret), so the callback
// proves possession with the PKCE code_verifier instead. The verifier is secret
// and must NOT ride in the (signed-but-readable) OAuth state — the route keeps it
// in a short-lived httpOnly cookie; only the non-secret client_id travels in the
// state. Refresh tokens are SINGLE-USE and rotate: every refresh returns a new
// refresh_token that must be persisted, or the next refresh fails.
import { createHash, randomBytes } from 'node:crypto'

const MCP_BASE = (process.env.GRANOLA_MCP_BASE ?? 'https://mcp.granola.ai').replace(/\/$/, '')

export interface GranolaOAuthEndpoints {
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string | null
}

export interface GranolaTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string // ISO
  scope: string | null
}

// Discover the authorization server metadata (RFC 8414). Cached per process.
let endpointsCache: GranolaOAuthEndpoints | null = null
export async function discoverGranolaOAuth(): Promise<GranolaOAuthEndpoints> {
  if (endpointsCache) return endpointsCache
  const res = await fetch(`${MCP_BASE}/.well-known/oauth-authorization-server`)
  if (!res.ok) {
    throw new Error(`Granola OAuth discovery failed (HTTP ${res.status} at ${MCP_BASE}).`)
  }
  const meta = (await res.json()) as {
    authorization_endpoint?: string
    token_endpoint?: string
    registration_endpoint?: string
  }
  if (!meta.authorization_endpoint || !meta.token_endpoint) {
    throw new Error('Granola OAuth discovery doc missing authorization/token endpoint.')
  }
  endpointsCache = {
    authorizationEndpoint: meta.authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
    registrationEndpoint: meta.registration_endpoint ?? null,
  }
  return endpointsCache
}

// Resolve a client_id: a pre-provisioned one (env) wins; otherwise Dynamic Client
// Registration (RFC 7591) registers a public client for our redirect URI. Granola's
// DCR issues public clients (PKCE), so there is no client_secret to store.
export async function resolveGranolaClientId(redirectUri: string): Promise<string> {
  const envClient = process.env.GRANOLA_OAUTH_CLIENT_ID
  if (envClient) return envClient
  const { registrationEndpoint } = await discoverGranolaOAuth()
  if (!registrationEndpoint) {
    throw new Error(
      'Granola OAuth has no registration endpoint and GRANOLA_OAUTH_CLIENT_ID is unset.',
    )
  }
  const res = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Exsto Law',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // public client (PKCE)
    }),
  })
  if (!res.ok) {
    throw new Error(`Granola dynamic client registration failed (HTTP ${res.status}).`)
  }
  const reg = (await res.json()) as { client_id?: string }
  if (!reg.client_id) throw new Error('Granola DCR returned no client_id.')
  return reg.client_id
}

// PKCE pair: a random verifier + its S256 challenge.
export function makePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function getGranolaRedirectUri(): string {
  const uri = process.env.GRANOLA_OAUTH_REDIRECT_URI
  if (!uri) {
    throw new Error('GRANOLA_OAUTH_REDIRECT_URI is required to connect Granola.')
  }
  return uri
}

const GRANOLA_SCOPE = process.env.GRANOLA_OAUTH_SCOPE ?? 'openid offline_access'

export async function buildGranolaAuthUrl(args: {
  clientId: string
  redirectUri: string
  state: string
  challenge: string
}): Promise<string> {
  const { authorizationEndpoint } = await discoverGranolaOAuth()
  const url = new URL(authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', args.clientId)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('scope', GRANOLA_SCOPE)
  url.searchParams.set('state', args.state)
  url.searchParams.set('code_challenge', args.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

function toTokens(t: TokenResponse, priorRefresh?: string): GranolaTokens {
  if (!t.access_token) throw new Error('Granola token response had no access_token.')
  // Refresh-token rotation: a refresh response may omit refresh_token only when
  // the provider keeps the same one. Granola rotates (single-use), so prefer the
  // new one; fall back to the prior only if the response omitted it.
  const refreshToken = t.refresh_token ?? priorRefresh
  if (!refreshToken) throw new Error('Granola token response had no refresh_token.')
  return {
    accessToken: t.access_token,
    refreshToken,
    expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
    scope: t.scope ?? null,
  }
}

export async function exchangeGranolaCode(args: {
  code: string
  clientId: string
  redirectUri: string
  verifier: string
}): Promise<GranolaTokens> {
  const { tokenEndpoint } = await discoverGranolaOAuth()
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      client_id: args.clientId,
      redirect_uri: args.redirectUri,
      code_verifier: args.verifier,
    }),
  })
  if (!res.ok) {
    throw new Error(
      `Granola code exchange failed (HTTP ${res.status}: ${(await res.text()).slice(0, 200)}).`,
    )
  }
  return toTokens((await res.json()) as TokenResponse)
}

export async function refreshGranolaTokens(args: {
  refreshToken: string
  clientId: string
}): Promise<GranolaTokens> {
  const { tokenEndpoint } = await discoverGranolaOAuth()
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken,
      client_id: args.clientId,
    }),
  })
  if (!res.ok) {
    throw new Error(`Granola token refresh failed (HTTP ${res.status}).`)
  }
  return toTokens((await res.json()) as TokenResponse, args.refreshToken)
}
