// Granola connect orchestration (WP1.2) — the per-attorney browser OAuth that
// replaced the api-key paste. Mirrors api/google.ts: build a signed auth URL,
// then on callback exchange the code, run a real capability probe with the
// in-hand token, and only persist + mark 'connected' if the probe passes.
//
// ⚠️ ACTIVATION-GATED: the live flow needs an attorney to complete the Granola
// sign-in against a real account; not exercised in CI.
import type { ActionContext } from '@exsto/substrate'
import { disconnect, saveConnection } from '../adapters/connectionStore.js'
import { signOAuthState, verifyOAuthState } from '../adapters/oauthState.js'
import { probeGranolaToken, type GranolaSecret } from '../adapters/granolaMcp.js'
import {
  buildGranolaAuthUrl,
  exchangeGranolaCode,
  getGranolaRedirectUri,
  makePkce,
  resolveGranolaClientId,
} from '../adapters/granolaOAuth.js'
import { recordIntegrationProbe } from './integrations.js'

interface GranolaState {
  tenantId: string
  returnTo: string
  actorId: string
  clientId: string
  nonce: string
}

// Start a connect: returns the Granola authorization URL plus the PKCE verifier
// (the route stows the verifier in a short-lived httpOnly cookie — it must NOT
// travel in the signed-but-readable state).
export async function buildGranolaConnectUrl(
  tenantId: string,
  returnTo: string,
  actorId: string,
): Promise<{ url: string; verifier: string }> {
  const redirectUri = getGranolaRedirectUri()
  const clientId = await resolveGranolaClientId(redirectUri)
  const { verifier, challenge } = makePkce()
  const state = signOAuthState({
    tenantId,
    returnTo,
    actorId,
    clientId,
    nonce: cryptoNonce(),
  } satisfies GranolaState)
  const url = await buildGranolaAuthUrl({ clientId, redirectUri, state, challenge })
  return { url, verifier }
}

function cryptoNonce(): string {
  // Cheap unique nonce; randomness only needs to make the signed state distinct.
  return `${Date.now().toString(36)}-${Math.round(performance.now()).toString(36)}`
}

export interface GranolaExchangeResult {
  tenantId: string
  returnTo: string
  connected: boolean
}

// Finish a connect: verify state, exchange code → tokens, probe, persist on pass.
export async function exchangeGranolaConnect(
  state: string,
  code: string,
  verifier: string | null,
): Promise<GranolaExchangeResult> {
  let parsed: GranolaState
  try {
    parsed = verifyOAuthState<GranolaState>(state)
  } catch {
    throw new Error('Invalid OAuth state.')
  }
  if (!parsed.actorId) throw new Error('Granola connect requires a signed-in attorney.')
  if (!verifier) throw new Error('Missing PKCE verifier (cookie expired). Reconnect Granola.')

  const tokens = await exchangeGranolaCode({
    code,
    clientId: parsed.clientId,
    redirectUri: getGranolaRedirectUri(),
    verifier,
  })

  const probeCtx: ActionContext = { tenantId: parsed.tenantId, actorId: parsed.actorId }
  const auditProbe = (outcome: 'connected' | 'error', detail: string | null) =>
    recordIntegrationProbe(probeCtx, 'granola', outcome, detail).catch((e) =>
      console.error('[granola] probe audit failed (non-fatal):', e),
    )

  // Real MCP call with the in-hand token before persisting — 'connected' means
  // the grant works, not merely that a token came back.
  const probe = await probeGranolaToken(tokens.accessToken)
  if (!probe.ok) {
    await auditProbe('error', probe.detail)
    throw new Error(`Granola connected, but the capability check failed: ${probe.detail}`)
  }

  const secret: GranolaSecret = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    clientId: parsed.clientId,
    scope: tokens.scope,
  }
  await saveConnection(
    parsed.tenantId,
    'granola',
    secret,
    { scope: tokens.scope ?? null, expiresAt: new Date(tokens.expiresAt) },
    parsed.actorId,
  )
  await auditProbe('connected', null)

  return { tenantId: parsed.tenantId, returnTo: parsed.returnTo, connected: true }
}

// Disconnect the signed-in attorney's Granola: removes the Vault secret and marks
// the row 'disconnected' (mirrors disconnectGoogle).
export async function disconnectGranola(ctx: ActionContext): Promise<void> {
  await disconnect(ctx.tenantId, 'granola', ctx.actorId)
}
