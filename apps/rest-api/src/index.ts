// Entry point for the REST/OpenAPI adapter. Importing this module registers the
// generic substrate tools (via @exsto/mcp-tools) and starts the HTTP server.
import '@exsto/mcp-tools' // side effect: register the generic substrate tools
import { startTracing } from '@exsto/shared'
import { startRestServer } from './server.js'

export { createRestServer, startRestServer } from './server.js'
export { buildOpenApiSpec } from './openapi.js'

const entry = process.argv[1] ?? ''
if (entry.endsWith('index.js') || entry.endsWith('index.ts')) {
  startTracing('exsto-rest-api')
    .then(() => startRestServer())
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
