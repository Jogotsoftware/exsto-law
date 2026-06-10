# ADR 0036: Merged demo app for Netlify deployment (amends ADR 0029)

## Status
Accepted; amends ADR 0029.

## Context
ADR 0029 specified the legal vertical UI as two separate Next.js apps — `apps/legal-attorney` for the attorney surface and `apps/legal-client` for the client portal — each behind its own port and its own process. That structure was clean for the local-developer story (run two processes in two terminals), but two implications made it awkward for Netlify deployment:

1. Both apps relied on a third process — the `@exsto/mcp-server` — to receive proxied MCP tool calls. The Next.js apps' `/api/mcp` route forwarded requests to that process via `MCP_SERVER_URL`. Netlify Functions can't reach a localhost process; deploying the MCP server as its own Netlify-hosted thing adds a separate site or Function configuration that does no value-add work.
2. Two separate Netlify sites would mean two URLs to manage, two builds, two env-var settings — for a demo that has exactly one audience (Juan Carlos walking through both surfaces on a laptop) and benefits nothing from physical separation.

The user-facing demo also reads more cleanly as a single URL with route trees: `/attorney/*` and `/client/*`. There is no business case for serving the surfaces from different origins until real auth and real customer separation arrive — at which point the architecture will be revisited.

## Decision

Replace `apps/legal-attorney` and `apps/legal-client` with a single Next.js app, `apps/legal-demo`. It hosts:

- `/` — surface chooser landing page
- `/attorney/*` — attorney surface (matters dashboard, matter detail, review queue, draft review)
- `/client/*` — client portal (landing, intake, booking)
- `/api/attorney/mcp` — server-side Next.js route handler that imports `@exsto/mcp-tools` directly and binds the attorney actor; no separate process
- `/api/client/mcp` — same, with the public-intake actor

The standalone `@exsto/mcp-server` package is retained for stdio-based MCP clients (e.g., Claude Code, IDE integrations). The wedge UI no longer depends on it.

A single `netlify.toml` lives under `apps/legal-demo/`. The Netlify build runs `pnpm install --frozen-lockfile && pnpm build && pnpm --filter @exsto/legal-demo exec next build` from the repo root and publishes `apps/legal-demo/.next`. The `@netlify/plugin-nextjs` plugin is referenced explicitly.

The two `?demo_user=` identities from ADR 0035 are preserved: `?demo_user=juan-carlos` on `/attorney` and `?demo_user=marcus-holloway` (or `=priya-iyer`) on `/client`.

## Consequences

### What this makes easier
- One Netlify site, one URL, one set of env vars.
- The MCP server process is no longer required for the wedge demo — Netlify Functions handle the tool calls directly. Local developers no longer need to start a third terminal either.
- The Next.js routing model fits cleanly: the attorney and client surfaces have shared chrome (the landing page) but distinct layouts that swap theme variables via a body class.

### What this makes harder
- The architectural cleanliness of "the attorney is a different surface from the client" is now a route-tree split inside one process rather than two processes. For a future where one customer pays for the attorney surface and a different customer pays for the client portal, the surfaces would need to be split again — or made multi-tenant within the single app, which is the more likely architecture anyway.
- `@exsto/mcp-server` is now a side project rather than the canonical interface for the wedge UI. The standalone HTTP MCP server is kept for stdio MCP clients and for the case where someone wants to point a non-Next consumer (a CLI, an IDE extension) at the substrate. Its role in the wedge story is now optional.

## Alternatives considered

- **Keep the two apps; deploy the MCP server as a Netlify Function.** Possible, but the MCP server is currently an `http.createServer` instance — it would need to be reshaped for the Lambda model. Doing so without first solving the question "do we even need a separate MCP server process for the wedge" is busywork.
- **Keep the two apps; deploy each as its own Netlify site, both calling each other's `/api/mcp` routes via direct workspace imports (no MCP server).** Cleanest preservation of ADR 0029's split, but doubles every Netlify operation (build, env, monitoring) for a demo that has no isolation requirement.
- **Single Next.js app with no route split — `/` is everything, choose surface via query param.** Faster to build but mixes attorney and client UIs into one page tree; the visual switching is loud during the demo.

## Accepted
Yes. `apps/legal-demo/` is the canonical wedge UI. `apps/legal-attorney/` and `apps/legal-client/` are deleted. ADR 0029's directory convention still applies for future verticals; the merged-app pattern is the implementation choice for the wedge specifically, not a refutation of the convention.
