# Deploying the Pacheco Law wedge to Netlify

A single Netlify site hosts the entire demo. The Next.js app at `apps/legal-demo` serves both the attorney surface (`/attorney/*`) and the client portal (`/client/*`), and exposes two server-side API routes (`/api/attorney/mcp`, `/api/client/mcp`) that call the substrate directly — no separate MCP server process required.

## What you need

- A Netlify account (free tier is fine for the demo).
- The repo pushed to GitHub (Netlify connects to the repo, not the local clone).
- The Supabase `exsto-wedge` project ID and the database password (Supabase dashboard ▸ Settings ▸ Database).
- An Anthropic API key (`ANTHROPIC_API_KEY`).

## One-time setup

Install the Netlify CLI on your laptop if you don't have it:

```bash
npm install -g netlify-cli
netlify login
```

## Create the site

From the repo root:

```bash
netlify init
```

Pick **Create & configure a new site**. Use defaults for build settings — Netlify reads `apps/legal-demo/netlify.toml` (which we've checked in) and gets the build command, publish directory, and the Next.js plugin from there.

If the CLI asks for a base directory, leave it as the repo root (".").

## Set environment variables

Either through the dashboard (Site settings ▸ Environment variables) or via the CLI:

```bash
netlify env:set DATABASE_URL "postgresql://postgres.qlqkpuyhppfodmpeybcz:YOUR_DB_PASSWORD@aws-1-us-east-1.pooler.supabase.com:6543/postgres"
netlify env:set SUPABASE_URL "https://qlqkpuyhppfodmpeybcz.supabase.co"
netlify env:set ANTHROPIC_API_KEY "your-anthropic-key"   # platform default; per-firm key set in Settings
netlify env:set NODE_ENV "production"

# --- Sign-in / OAuth (REQUIRED for Google sign-in + calendar/mail connect) ---
# OAUTH_STATE_SECRET signs the OAuth state so tenant/returnTo can't be forged.
# Google sign-in FAILS CLOSED without it. Generate: openssl rand -base64 32
netlify env:set OAUTH_STATE_SECRET "$(openssl rand -base64 32)"
netlify env:set GOOGLE_OAUTH_CLIENT_ID "your-google-oauth-client-id"
netlify env:set GOOGLE_OAUTH_CLIENT_SECRET "your-google-oauth-client-secret"
netlify env:set GOOGLE_OAUTH_REDIRECT_URI "https://<your-site>.netlify.app/api/auth/google/callback"

# Public-intake actor (only needed for the client portal MCP route)
netlify env:set LEGAL_CLIENT_TENANT_ID "00000000-0000-0000-0000-000000000001"
netlify env:set LEGAL_CLIENT_ACTOR_ID "00000000-0000-0000-0000-000000000004"

# Attorney side derives ctx from the signed-in session (actor table) — no
# tenant/actor env vars needed.
```

`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are not required by the deployed app — the substrate writes use `DATABASE_URL` directly.

**Integration keys are managed in the UI** (Settings → Integrations, stored in
Vault per tenant): Anthropic, Granola, Google, Perplexity. The env vars above are
only **platform defaults / OAuth client config**; a per-firm API key pasted in
Settings overrides the env default. Never put a firm's Granola/Perplexity key in
the deploy env.

**Optional** env:

- `LEGAL_DRAFTING_MODEL` — pin the drafting model (defaults to `claude-sonnet-4-6`).
- `TURNSTILE_SECRET` **or** `HCAPTCHA_SECRET` — enable the booking-form CAPTCHA
  gate (also add the matching widget to `/book`). Unset = no CAPTCHA.
- `PUBLIC_RATE_MAX` / `PUBLIC_RATE_WINDOW_MS` — tune the public-route rate limit
  (defaults: 20 requests / 60s per IP).
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — booking-page address autocomplete.

## Seed the database first

The deployed app reads from the same `exsto-wedge` Supabase project the local demo uses. If you've already run `pnpm seed:demo` locally against it, the Pine Hollow Roasters matter is already loaded. If not, do it now from your laptop:

```bash
# .env.local in the repo root needs the same DATABASE_URL you set above
pnpm install
pnpm build
pnpm seed:demo
```

## Deploy

```bash
netlify deploy --build               # preview deploy at a netlify.app subdomain
# inspect the preview URL — confirm /attorney and /client both render
netlify deploy --build --prod        # promote to production
```

Once deployed, your demo URLs are:

- `https://<your-site>.netlify.app/attorney?demo_user=juan-carlos`
- `https://<your-site>.netlify.app/client?demo_user=marcus-holloway`

The landing page at `https://<your-site>.netlify.app/` is a chooser with links to both.

## What to expect on first cold start

The first request to any `/api/*` route after deployment will be slower — the Netlify Function cold-starts, initializes the pg connection pool, and registers all the MCP tools. Subsequent requests in the same container are warm and fast.

The Anthropic adapter only runs when you click **Regenerate draft (live API)** on the review screen. The default demo path reads the cached draft from Supabase and does not need the Anthropic key — but the preflight check uses it and the regenerate button does too, so it's set as a deploy env var.

## ADR 0035 reminder — auth

The `?demo_user=` query param is dev-mode only. The deployed app sets `NODE_ENV=production` per the env-var step above, which means the demo identity still pre-fills UI for convenience but the API routes are not gated by it. Anyone with the URL can hit the API. **Before you share this URL with people who shouldn't see Pacheco Law's data, wire real auth (Supabase Auth or equivalent) per QUESTIONS.md #3.**

## Troubleshooting

- **Build fails at Netlify with a `corepack` error.** Older Node images on Netlify don't have corepack enabled by default. The netlify.toml pins `NODE_VERSION = "22"`; if that's not picked up, try `NETLIFY_USE_PNPM = "true"` as an env var.
- **API routes 500 with "DATABASE_URL is required".** The env var isn't bound to the production context. `netlify env:list --context production` to inspect; `netlify env:set` with `--context production` to force.
- **`/api/attorney/mcp` returns "Unknown tool".** The Netlify Function may not have evaluated the side-effect imports in `@exsto/mcp-tools/dist/index.js` that register the tools. Confirm `pnpm build` ran successfully in the Netlify build log and that the workspace dependencies got bundled.
- **Pages load but MCP calls fail with CORS errors.** Same-origin should always work; if you're hitting CORS, the `/api/...` paths probably aren't being served by Netlify Functions. Confirm the deploy summary shows the API routes as functions.

## Reverting

```bash
netlify deploy --build --prod --skip-functions-cache    # force rebuild
```

Or roll back via the Netlify dashboard's **Deploys** tab.
