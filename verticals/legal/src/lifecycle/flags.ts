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
