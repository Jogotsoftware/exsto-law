// MACHINE-COMMS-1 (WP1) — notes tools: the memory primitive's read/write surface.
// Powers the matter page and client page Notes sections and gives the assistant
// explicit access to firm memory. Writes flow through api/notes (generic core
// actions); reads through queries/notes.
import { registerTool, type Tool } from '@exsto/mcp-tools'
import type { ActionContext } from '@exsto/substrate'
import { createNote, updateNote, retireNote } from '../../api/notes.js'
import { listNotesForEntity, type NoteSummary } from '../../queries/notes.js'
import { getClientContext, formatClientContext } from '../../queries/clientContext.js'

const listTool: Tool<{ targetEntityId: string }, { notes: NoteSummary[] }> = {
  name: 'legal.note.list',
  description:
    'Active notes attached to a matter or a client (newest first): body, source (attorney | ai_summary | ai_extraction), author, and the source entity the note is about (e.g. a transcript).',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      targetEntityId: { type: 'string', description: 'The matter or client entity id.' },
    },
    required: ['targetEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    notes: await listNotesForEntity(ctx, input.targetEntityId),
  }),
}

const createTool: Tool<
  { body: string; matterEntityId?: string; clientEntityId?: string; aboutEntityId?: string },
  { noteEntityId: string }
> = {
  name: 'legal.note.create',
  description:
    'Create a note on a matter OR a client (exactly one), optionally pointing at a source entity (e.g. a transcript). The note joins the client’s assembled memory immediately.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      body: { type: 'string', description: 'The note text (markdown allowed).' },
      matterEntityId: { type: 'string', description: 'Attach to this matter…' },
      clientEntityId: { type: 'string', description: '…or to this client (exactly one).' },
      aboutEntityId: {
        type: 'string',
        description: 'Optional source entity the note derives from (e.g. a transcript id).',
      },
    },
    required: ['body'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => createNote(ctx, input),
}

const updateTool: Tool<{ noteEntityId: string; body: string }, { updated: boolean }> = {
  name: 'legal.note.update',
  description: 'Replace a note’s body (append-only supersession — history retained).',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      noteEntityId: { type: 'string' },
      body: { type: 'string', description: 'The new note text.' },
    },
    required: ['noteEntityId', 'body'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => {
    await updateNote(ctx, input)
    return { updated: true }
  },
}

const retireTool: Tool<{ noteEntityId: string }, { retired: boolean }> = {
  name: 'legal.note.retire',
  description: 'Retire (archive) a note — it leaves the lists; nothing is deleted.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { noteEntityId: { type: 'string' } },
    required: ['noteEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => {
    await retireNote(ctx, input.noteEntityId)
    return { retired: true }
  },
}

const contextTool: Tool<{ clientEntityId: string; maxChars?: number }, { context: string | null }> =
  {
    name: 'legal.client.context',
    description:
      'The client’s ASSEMBLED memory as one compact text block: profile, every matter INCLUDING archived (service, status, key intake facts), released documents, notes, transcript excerpts, recent messages. Most-recent-first, hard character budget. This is the context the machine writes emails and drafts from.',
    mode: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        clientEntityId: { type: 'string' },
        maxChars: { type: 'number', description: 'Hard output budget (default 12000).' },
      },
      required: ['clientEntityId'],
      additionalProperties: false,
    },
    handler: async (ctx: ActionContext, input) => {
      const context = await getClientContext(ctx, input.clientEntityId)
      return { context: context ? formatClientContext(context, input.maxChars) : null }
    },
  }

registerTool(listTool as Tool)
registerTool(createTool as Tool)
registerTool(updateTool as Tool)
registerTool(retireTool as Tool)
registerTool(contextTool as Tool)
