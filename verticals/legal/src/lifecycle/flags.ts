// Feature flag for the configurable workflow ENGINE (ADR 0045, PR3 write path).
// Day-one default is OFF: with the flag off, matter.open writes exactly what it
// wrote before (no workflow_instance), and the legal.matter.advance handler is
// only reachable through an explicit caller — there is no engine-driven write.
// Flip LEGAL_WORKFLOW_ENGINE=1 (or 'true') in an environment to let matter.open
// stand up an instance for services that have an authored lifecycle.
export function workflowEngineEnabled(): boolean {
  const v = process.env.LEGAL_WORKFLOW_ENGINE
  return v === '1' || v === 'true'
}

// Feature flag for the AI BUILD WIZARD (propose + approve a new service from the
// chatbot). Default is ON (Legal Instruments WP-L, decision D8): the guided build
// is certified (BUILDER-CERT-1) and is the comp's flagship assistant entry point,
// so every deployment gets it unless explicitly disabled. Set LEGAL_BUILD_WIZARD=0
// (or 'false') to turn it off — with the flag off, the assistant registers none of
// the service-authoring tools and its system prompt says nothing about them (the
// pre-D8 dormant behavior).
export function buildWizardEnabled(): boolean {
  const v = process.env.LEGAL_BUILD_WIZARD
  return v !== '0' && v !== 'false'
}
