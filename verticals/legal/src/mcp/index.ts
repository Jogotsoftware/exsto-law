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
import './tools/simulateCall.js'
import './tools/generateDraft.js'
import './tools/listPendingDrafts.js'
import './tools/getDraftVersion.js'
import './tools/reviewDraft.js'
import './tools/getIntakeQuestionnaire.js'
import './tools/bookingTools.js'
import './tools/templateTools.js'
import './tools/calendarTools.js'
import './tools/googleTools.js'
import './tools/contactTools.js'
import './tools/partnerTools.js'
import './tools/contactLookup.js'
import './tools/settingsTools.js'
import './tools/matterHistory.js'
import './tools/workspaceTools.js'
// Note: ./tools/sendDraftLinkEmail.js exists but was never wired into the registry
// upstream; left unregistered to preserve the prior tool surface exactly.
