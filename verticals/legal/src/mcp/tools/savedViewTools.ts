import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  listSavedViews,
  getSavedView,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  type SavedView,
  type CreateSavedViewInput,
  type UpdateSavedViewInput,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Saved filter/sort views (beta sprint Obj 5) — back the shared list component
// (Matters, Contacts/Clients, Review). Firm-wide; the config blob is opaque to
// the backend (the UI owns its shape). Attorney-only (not in CLIENT_PORTAL_TOOLS).

const listTool: Tool<{ surface?: string }, { views: SavedView[] }> = {
  name: 'legal.savedview.list',
  description:
    'List saved filter/sort views, firm-wide. Pass surface (e.g. matters | contacts | review) to scope to one list. Each view has its name, surface, opaque config, and owner.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { surface: { type: 'string', description: 'Optional surface to scope to.' } },
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    views: await listSavedViews(ctx, input?.surface),
  }),
}

const getTool: Tool<{ savedViewId: string }, { view: SavedView | null }> = {
  name: 'legal.savedview.get',
  description: 'Fetch one saved view (name, surface, config, owner).',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { savedViewId: { type: 'string' } },
    required: ['savedViewId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    view: await getSavedView(ctx, input.savedViewId),
  }),
}

const createTool: Tool<CreateSavedViewInput, { view: SavedView }> = {
  name: 'legal.savedview.create',
  description:
    'Save a named filter/sort view for a list surface. config is the opaque filter+sort object the list component defines.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      surface: { type: 'string', description: 'matters | contacts | review | …' },
      config: { type: 'object', description: 'Opaque filter+sort config (UI-defined).' },
    },
    required: ['name', 'surface', 'config'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({ view: await createSavedView(ctx, input) }),
}

const updateTool: Tool<UpdateSavedViewInput, { view: SavedView }> = {
  name: 'legal.savedview.update',
  description: 'Update a saved view (rename or replace its filter/sort config).',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      savedViewId: { type: 'string' },
      name: { type: 'string' },
      config: { type: 'object', description: 'Replacement filter+sort config.' },
    },
    required: ['savedViewId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({ view: await updateSavedView(ctx, input) }),
}

const deleteTool: Tool<{ savedViewId: string }, { savedViewId: string; deleted: true }> = {
  name: 'legal.savedview.delete',
  description:
    'Delete a saved view (archived — kept as history, dropped from active listings). Append-only via the core entity.archive.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { savedViewId: { type: 'string' } },
    required: ['savedViewId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => deleteSavedView(ctx, input.savedViewId),
}

registerTool(listTool)
registerTool(getTool)
registerTool(createTool)
registerTool(updateTool)
registerTool(deleteTool)
