// Next.js server-startup hook (stable since Next 15). One log line per boot so
// the LIVE state of the two builder feature flags is verifiable from the deploy
// logs (BUILDER-HARDENING-1 WP1) — "is the engine on in prod?" must never require
// guessing from behavior. Values mirror how the runtime reads them
// (verticals/legal/src/lifecycle/flags.ts): the workflow engine defaults OFF
// ('1'/'true' ⇒ on); the build wizard defaults ON since WP-L D8 ('0'/'false' ⇒ off).
export async function register(): Promise<void> {
  const engineOn = (v: string | undefined): string => (v === '1' || v === 'true' ? 'ON' : 'OFF')
  const wizardOn = (v: string | undefined): string => (v === '0' || v === 'false' ? 'OFF' : 'ON')
  console.log(
    `[flags] LEGAL_WORKFLOW_ENGINE=${engineOn(process.env.LEGAL_WORKFLOW_ENGINE)} ` +
      `LEGAL_BUILD_WIZARD=${wizardOn(process.env.LEGAL_BUILD_WIZARD)}`,
  )
}
