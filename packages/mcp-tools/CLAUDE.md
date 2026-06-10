# The MCP tool catalog

Each MCP tool is a single file. Each file exports a tool definition (schema, description) and a handler function.

**This package is vertical-agnostic.** It registers ONLY the generic substrate tools (`src/tools/substrateTools.ts`) and must not depend on any vertical package. A vertical's tools live in that vertical (e.g. `verticals/legal/src/mcp/`), import `registerTool` from `@exsto/mcp-tools`, and register into the same shared registry; a consumer opts them in with a side-effect import (`import '@exsto/legal/mcp'`). One core, a generic adapter, and per-vertical tool modules — ADR 0024/0038, Q#5.

## Tool design principles

Tools are read-only by default. Tools that write must:

1. Construct an action object
2. Pass it through packages/substrate's action layer (which checks autonomy tier and permission scope)
3. Return the action_id and effects

Tools never write directly to substrate tables.

## Naming and granularity

Tool names follow the pattern: domain.verb.qualifier. Examples:

- entity.list.by_kind
- entity.get.by_id
- attribute.history.get
- judgment.create
- workflow.advance

Each tool does one thing. A tool that "lists or gets" is two tools. A tool that "creates or updates" is two tools.

## Pattern to copy

See docs/patterns/mcp-tool.md for the template. Copy it. Modify only the parts specific to the new tool.
