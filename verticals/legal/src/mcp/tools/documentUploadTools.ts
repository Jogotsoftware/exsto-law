import { registerTool, type Tool } from '@exsto/mcp-tools'
import { listMatterDocuments, type UploadedDocItem } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Read tool for the matter Documents tab's "Uploaded documents" list. Metadata
// only (filename / type / size / when) — never the storage object key or bytes.
// Uploading and downloading the bytes go through the dedicated Next routes
// (multipart in, server-proxied attachment out), not the JSON MCP transport.
registerTool({
  name: 'legal.document.list',
  description:
    'List the files uploaded to a matter (filename, content type, size, uploaded-at) — metadata only, no bytes. Download is via the matter document download route.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string', description: 'The matter entity id.' },
    },
    required: ['matterEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => {
    const documents = await listMatterDocuments(
      ctx,
      (input as { matterEntityId: string }).matterEntityId,
    )
    return { documents }
  },
} satisfies Tool<{ matterEntityId: string }, { documents: UploadedDocItem[] }>)
