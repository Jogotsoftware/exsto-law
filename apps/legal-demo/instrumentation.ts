// Next.js server-startup hook (stable since Next 15). One log line per boot so
// the LIVE state of the two builder feature flags is verifiable from the deploy
// logs (BUILDER-HARDENING-1 WP1) — "is the engine on in prod?" must never require
// guessing from behavior. Values are read the same way the runtime reads them
// (verticals/legal/src/lifecycle/flags.ts: '1' or 'true' ⇒ on).
export async function register(): Promise<void> {
  const on = (v: string | undefined): string => (v === '1' || v === 'true' ? 'ON' : 'OFF')
  console.log(
    `[flags] LEGAL_WORKFLOW_ENGINE=${on(process.env.LEGAL_WORKFLOW_ENGINE)} ` +
      `LEGAL_BUILD_WIZARD=${on(process.env.LEGAL_BUILD_WIZARD)}`,
  )
}
