// Legal vertical MCP tools — the legal surface's adapter over the shared operation
// core. These register into the same @exsto/mcp-tools registry the generic
// substrate tools use, so a consumer that wants the legal tools side-effect-imports
// this entry (`import '@exsto/legal/mcp'`) alongside `@exsto/mcp-tools`.
//
// This file used to live in packages/mcp-tools/src/index.ts. It was moved here so
// the shared @exsto/mcp-tools package stays vertical-agnostic (it no longer depends
// on @exsto/legal) — ADR 0024/0038: one core, generic adapter + per-vertical tools.
// Importing a tool module runs its registerTool() side effect.
import './tools/createMatter.js'
import './tools/listMatters.js'
import './tools/getMatter.js'
import './tools/submitQuestionnaire.js'
import './tools/recordCallTools.js'
import './tools/generateDraft.js'
import './tools/listPendingDrafts.js'
import './tools/getDraftVersion.js'
import './tools/getSharedDraftVersion.js'
import './tools/reviewDraft.js'
import './tools/getIntakeQuestionnaire.js'
import './tools/bookingTools.js'
import './tools/serviceLibraryTools.js'
import './tools/templatesTools.js'
import './tools/standaloneTemplateTools.js'
import './tools/questionnaireLibraryTools.js'
import './tools/calendarTools.js'
import './tools/googleTools.js'
import './tools/contactTools.js'
import './tools/callTools.js'
import './tools/assignCallTool.js'
import './tools/meetingTools.js'
import './tools/clientTools.js'
import './tools/companyTools.js'
import './tools/partnerTools.js'
import './tools/contactLookup.js'
import './tools/settingsTools.js'
import './tools/matterHistory.js'
import './tools/workspaceTools.js'
import './tools/researchTools.js'
import './tools/assistantTools.js'
import './tools/assistantChatTools.js'
import './tools/granolaImportTools.js'
import './tools/clientPortalTools.js'
import './tools/matterMessagingTools.js'
import './tools/timeExpenseTools.js'
import './tools/savedViewTools.js'
// Beta sprint Obj 7 (make email live): register the real draft-link email tool —
// it sends through the attorney's Gmail (mail.send provenance). The matter page
// already calls legal.email.send_draft_link.
import './tools/sendDraftLinkEmail.js'
// Session 5: "Send for signature" + envelope status + portal signing.
import './tools/sendForSignature.js'
import './tools/esignAttorneyTools.js'
import './tools/esignPortalTools.js'
// Beta sprint Obj 4 (billing): roll unbilled time/expense ledger events up into
// invoices, list/inspect them, and send (activation-gated). Session 4.
import './tools/billingTools.js'

// The public-client-portal allowlist travels with the tools it gates.
export {
  CLIENT_PORTAL_TOOLS,
  isClientPortalTool,
  CLIENT_PORTAL_AUTHED_TOOLS,
  isClientPortalAuthedTool,
} from './clientPolicy.js'
