import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  importNotes,
  listImportFolders,
  previewFolderImport,
  type GranolaFolder,
  type ImportResult,
  type ImportSelection,
  type NotePreview,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Granola folder-import surface for the attorney workspace. Reads list folders
// and preview a folder's notes (with auto-match); the write tool pulls the
// selected notes' transcripts and records them via call.ingest. The Granola key
// is resolved server-side per tenant by the adapter — never taken from input.

registerTool({
  name: 'legal.granola.folders',
  description:
    "List the connected Granola account's folders so the attorney can pick one to import meeting notes from.",
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ folders: await listImportFolders(ctx) }),
} satisfies Tool<Record<string, never>, { folders: GranolaFolder[] }>)

registerTool({
  name: 'legal.granola.preview',
  description:
    'Scan a Granola folder: list its meeting notes and auto-match each to an existing matter by attendee email (metadata only, no transcript pulled yet). Unmatched notes are returned with match=null.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    notes: await previewFolderImport(ctx, input.folderId),
  }),
} satisfies Tool<{ folderId: string }, { notes: NotePreview[] }>)

registerTool({
  name: 'legal.granola.import',
  description:
    "Pull the selected Granola notes' transcripts and record them on their matched matter via call.ingest. Idempotent (re-importing a note is a no-op). Notes with matterEntityId=null are recorded into the review queue.",
  mode: 'write',
  handler: async (ctx: ActionContext, input) => ({
    results: await importNotes(ctx, input.selections),
  }),
} satisfies Tool<{ selections: ImportSelection[] }, { results: ImportResult[] }>)
