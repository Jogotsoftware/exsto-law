// Legal vertical MCP tools — the legal surface's adapter over the shared operation
// core. These register into the same @exsto/mcp-tools registry the generic
// substrate tools use, so a consumer that wants the legal tools side-effect-imports
// this entry (`import '@exsto/legal/mcp'`) alongside `@exsto/mcp-tools`.
//
// This file used to live in packages/mcp-tools/src/index.ts. It was moved here so
// the shared @exsto/mcp-tools package stays vertical-agnostic (it no longer depends
// on @exsto/legal) — ADR 0024/0038: one core, generic adapter + per-vertical tools.
// Importing a tool module runs its registerTool() side effect.
import './tools/openMatter.js'
// ADR 0045 PR3: the thin write tool the matter Workflow window calls to advance a
// matter one step through its bound lifecycle (delegates to the action handler).
import './tools/matterAdvanceTools.js'
// ADR 0045 PR6: customize ONE matter's workflow (add/reorder/remove a step) without
// altering the service default — writes workflow_instance.states_override. Attorney
// -only (deliberately NOT in clientPolicy.ts allowlists).
import './tools/matterWorkflowTools.js'
import './tools/calendarCategoriesTools.js'
import './tools/matterAccessTools.js'
import './tools/documentUploadTools.js'
import './tools/listMatters.js'
import './tools/getMatter.js'
import './tools/submitQuestionnaire.js'
import './tools/recordCallTools.js'
import './tools/generateDraft.js'
import './tools/listPendingDrafts.js'
import './tools/getDraftVersion.js'
import './tools/listDocumentVersions.js'
import './tools/getSharedDraftVersion.js'
import './tools/reviewDraft.js'
import './tools/getIntakeQuestionnaire.js'
import './tools/bookingTools.js'
import './tools/serviceLibraryTools.js'
// AI document review: manual (re)run of the review pipeline for one uploaded
// matter document. Attorney-only.
import './tools/documentReviewTools.js'
// ADR 0045 PR4a: author/read a service's workflow lifecycle graph (states).
import './tools/serviceLifecycleTools.js'
// ADR 0045 PR4b: the closed step-action + gate catalog the service-editor Workflow
// builder composes a lifecycle from (server-side guardrail, data-driven UI).
import './tools/workflowCatalogTools.js'
// ADR 0045 PR4c: the reusable workflow STEP library — save a step + drop it into
// any service's workflow from the builder (mirrors the questionnaire library).
import './tools/workflowStepLibraryTools.js'
import './tools/templatesTools.js'
import './tools/standaloneTemplateTools.js'
import './tools/questionnaireLibraryTools.js'
import './tools/questionTemplateTools.js'
import './tools/taskTools.js'
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
import './tools/feedbackNotificationTools.js'
import './tools/feedbackClaimTools.js'
import './tools/granolaImportTools.js'
import './tools/clientPortalTools.js'
import './tools/clientRequestTools.js'
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
// Online invoice payments (Stripe Connect): firm payment-connection status /
// refresh / disconnect. The client-portal checkout tool lives in
// clientPortalTools.js; connect itself is the /api/billing/connect/init redirect.
import './tools/paymentsTools.js'
// Trust (IOLTA) accounting: deposit/disburse/refund, apply-to-invoice (earned
// transfer), per-client balance + ledger, and three-way reconciliation.
import './tools/trustTools.js'
// S9 (tenancy & RBAC): firm user management — invite / assign role / deactivate.
import './tools/userTools.js'
// Skills: reusable legal playbooks (ported from claude-for-legal) the chatbot
// loads on demand — stored as substrate data, managed via these tools.
import './tools/skillTools.js'
// Platform control plane (ADR 0046): tenants / modules / access / promotion.
// Reachable ONLY from /admin/api/mcp (default-deny via adminPolicy.ts).
import './tools/adminTools.js'
// Platform Stripe credentials (owner setup) — admin-only, Vault-backed.
import './tools/adminPaymentsTools.js'
// Firm-facing module read (legal.module.enabled) — attorney nav gating. NOT an
// admin tool; reads only the caller's own tenant.
import './tools/moduleTools.js'

// The public-client-portal allowlist travels with the tools it gates.
export {
  CLIENT_PORTAL_TOOLS,
  isClientPortalTool,
  CLIENT_PORTAL_AUTHED_TOOLS,
  isClientPortalAuthedTool,
} from './clientPolicy.js'

// The admin-console allowlist travels with the control-plane tools it gates.
export { ADMIN_CONSOLE_TOOLS, isAdminConsoleTool } from './adminPolicy.js'
