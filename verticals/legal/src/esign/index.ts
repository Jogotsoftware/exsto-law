// Provider-agnostic e-sign adapter surface (Session 5, WP5.1).
export * from './types.js'
export { getEsignDriver, registerEsignDriver, DEFAULT_ESIGN_PROVIDER } from './registry.js'
export { signSigningToken, verifySigningToken, type SigningTokenPayload } from './signingToken.js'
