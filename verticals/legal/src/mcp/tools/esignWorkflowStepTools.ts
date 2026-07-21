import { registerTool, type Tool } from '@exsto/mcp-tools'
import { getEsignWorkflowStepContext, type EsignWorkflowStepContext } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// ESIGN-UNIFY-1 ES-4 (design §7) — the matter workflow's e-sign step opens with
// its envelope ALREADY BUILT: this read returns the latest approved version of
// the step's document kind, the recipients resolved from the service template's
// e-sign roles (editable in the composer), the pre-placed marker count, and any
// envelope already sent from the document (so a re-opened step shows honest
// sent/awaiting state instead of a second Send). Writes nothing — the composer
// submits the one esign.send via legal.esign.send_for_signature on confirm.
interface Input {
  matterEntityId: string
  documentKind: string
}

const contextTool: Tool<Input, EsignWorkflowStepContext> = {
  name: 'legal.esign.workflow_step_context',
  description:
    "Assemble the matter workflow e-sign step's confirm-and-send context: the latest APPROVED version of the step's document kind, recipients pre-resolved from the service template's e-sign roles (matter client / attorney of record / manual rows), the count of pre-placed signature markers, the default subject, and the latest envelope already sent from that document (if any). Read-only; sending goes through legal.esign.send_for_signature.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => getEsignWorkflowStepContext(ctx, input),
}

registerTool(contextTool)
