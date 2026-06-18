// Driver registry — the provider-swap seam (WP5.1 acceptance).
//
// Callers ask for a driver by neutral provider name; they never import a
// concrete driver. Adding DocuSign is one line here (and one new file under
// drivers/) with NO change to handlers, the API, the webhook, or the UI.
import type { EsignDriver, EsignProvider } from './types.js'
import { openSignDriver } from './drivers/opensign.js'
import { stubDriver } from './drivers/stub.js'

const drivers = new Map<string, EsignDriver>([
  [openSignDriver.provider, openSignDriver],
  [stubDriver.provider, stubDriver],
  // [docuSignDriver.provider, docuSignDriver],  // ← the seam: drops in here.
])

/**
 * The provider used when a caller does not specify one. Configurable via env so
 * the firm can switch providers (or to 'stub' in CI) without a code change.
 * Defaults to 'native' — the substrate's own sign-by-link engine (no external
 * host). 'native' is handled directly by the API, not via this driver registry
 * (which holds only EXTERNAL drivers); getEsignDriver is for non-native providers.
 */
export const DEFAULT_ESIGN_PROVIDER: EsignProvider =
  (process.env.LEGAL_ESIGN_PROVIDER as EsignProvider) || 'native'

export function getEsignDriver(provider: string = DEFAULT_ESIGN_PROVIDER): EsignDriver {
  const driver = drivers.get(provider)
  if (!driver) {
    throw new Error(
      `No e-sign driver registered for provider '${provider}'. ` +
        `Registered: ${[...drivers.keys()].join(', ')}.`,
    )
  }
  return driver
}

/** Register an additional driver at runtime (used by tests; the seam in code). */
export function registerEsignDriver(driver: EsignDriver): void {
  drivers.set(driver.provider, driver)
}
