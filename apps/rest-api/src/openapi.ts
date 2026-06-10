// OpenAPI 3.1 document GENERATED from the tool catalog (one source of truth, so
// REST and MCP never drift). No endpoint is hand-written: every exposed tool
// becomes one POST path. Served at GET /v1/openapi.json and consumed by the docs
// generator (scripts/gen-docs.mjs) and /v1/docs.
import { exposedTools, toolToPath } from './catalog.js'

export const API_VERSION = 'v1'

function operationId(toolName: string): string {
  return toolName.replace(/[^a-zA-Z0-9]+/g, '_')
}

function domainTag(toolName: string): string {
  return toolName.split('.')[0] ?? 'substrate'
}

const ERROR_RESPONSES = {
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '404': { $ref: '#/components/responses/NotFound' },
  '422': { $ref: '#/components/responses/OperationFailed' },
  '429': { $ref: '#/components/responses/RateLimited' },
  '500': { $ref: '#/components/responses/InternalError' },
} as const

function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  }
}

export function buildOpenApiSpec(): Record<string, unknown> {
  const paths: Record<string, unknown> = {}
  const tagSet = new Set<string>()

  for (const tool of exposedTools()) {
    const isWrite = tool.mode === 'write'
    const tag = domainTag(tool.name)
    tagSet.add(tag)

    const operation: Record<string, unknown> = {
      operationId: operationId(tool.name),
      summary: tool.description,
      description: `${tool.description}\n\nMaps to the \`${tool.name}\` operation on the shared core (same operation the MCP \`${tool.name}\` tool calls).`,
      tags: [tag],
      'x-exsto-mode': tool.mode,
      requestBody: {
        required: isWrite,
        content: {
          'application/json': {
            // The tool's own JSON Schema (single source of truth, shared with the
            // MCP tools/list surface). Falls back to a permissive object.
            schema: tool.inputSchema ?? {
              type: 'object',
              additionalProperties: true,
              description: `Input for ${tool.name}. See the tool contract; fields are passed through to the core operation.`,
            },
          },
        },
      },
      parameters: isWrite
        ? [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: false,
              schema: { type: 'string' },
              description:
                'Optional. Replaying a write with the same key returns the original response instead of submitting a second action.',
            },
          ]
        : [],
      responses: {
        '200': {
          description: 'The operation result.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolResult' } } },
        },
        ...ERROR_RESPONSES,
      },
      security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
    }

    paths[`/${API_VERSION}/${toolToPath(tool.name)}`] = { post: operation }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Exsto Substrate REST API',
      version: '0.1.0',
      description:
        'A thin REST/OpenAPI adapter over the Exsto operation core (ADR 0038). Every endpoint delegates to the SAME action/query core the MCP server uses; it never issues its own substrate SQL. Authenticate with an API key; the tenant + actor are derived from the key server-side. Writes flow through the append-only action layer.',
    },
    servers: [{ url: '/', description: 'This server' }],
    tags: [...tagSet].sort().map((t) => ({ name: t })),
    paths,
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Authorization: Bearer <api-key>',
        },
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', example: 'operation_failed' },
                message: { type: 'string' },
                details: {},
              },
            },
          },
        },
        ToolResult: {
          type: 'object',
          required: ['data'],
          properties: {
            data: { description: 'The operation result (shape depends on the operation).' },
          },
        },
      },
      responses: {
        Unauthorized: errorResponse('Missing or invalid API key.'),
        Forbidden: errorResponse('The principal is not permitted to perform this operation.'),
        NotFound: errorResponse('No such operation on the REST surface.'),
        OperationFailed: errorResponse(
          'The request was understood but the operation could not be completed.',
        ),
        RateLimited: errorResponse('Rate limit exceeded; retry after the Retry-After interval.'),
        InternalError: errorResponse('Unexpected server error.'),
      },
    },
    security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
  }
}
