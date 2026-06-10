# How to start a new AI-native tool on the Exsto substrate

This is the template quickstart: clone → bootstrap → remove the example → build
your vertical. The substrate (Layers 0–2) is the reusable foundation; your
product is a Layer 3 vertical on top of it. Read `ARCHITECTURE.md` for the why,
`docs/product/02_LAYER_0-2_DEFINITION_OF_DONE.md` for what the substrate
guarantees, and `CLAUDE.md` for the rules.

## 1. Pick the branch

Start from **`main`** — the canonical, customer-agnostic substrate line (the whole
foundation stack was merged to `main`; the old `core-substrate` branch is frozen at
an earlier point and should not be used). `substrate-and-legal-wedge` is the full
legal example to study.

```bash
git clone <repo-url> my-tool && cd my-tool   # main is the default branch
pnpm install && pnpm build
```

## 2. Bootstrap the database

Create a Supabase project, then:

```bash
cp .env.example .env.local        # fill in SUPABASE_URL, keys, DATABASE_URL
supabase link --project-ref <your-project-ref>
pnpm migrate                      # supabase db push — applies migrations 0001–0025
pnpm seed                         # applies the customer-agnostic seed
```

You now have the full substrate: 61 tables, RLS + append-only + bitemporal
enforcement, the worker queue, pgvector, durable idempotency, API-key auth, and
migration history. (Verified hands-free on a fresh project — see
`docs/FOUNDATION_CERTIFICATION.md`.)

**Connection roles (ADR 0037):** the `postgres` role bypasses RLS — use it only
for `pnpm migrate`/`pnpm seed`. Your app and worker must connect as a non-owner
role (`authenticated`/`anon` or a dedicated app role) or tenant isolation is
silently off. Verify: `SUBSTRATE_TEST_DATABASE_URL=<disposable> pnpm test:invariants`.

## 3. Remove the example vertical

The legal wedge is an example, not the substrate. To start clean:

- Delete `verticals/legal` and `apps/legal-demo`.
- In `packages/mcp-tools`: remove the legal tool imports from `src/index.ts` and
  the legal tool files; drop `@exsto/legal` from `package.json`.
- In root `package.json`: repoint `dev` / `dev:web` away from `@exsto/legal-demo`;
  remove `seed:demo` / `preflight`.
- Remove `verticals/*` from `pnpm-workspace.yaml` and `./verticals/legal` from
  `tsconfig.json` if you are not keeping a vertical there.

The deep substrate (`packages/{shared,substrate,primitives}`, `supabase/migrations`,
`workers/runtime`) is already vertical-agnostic — leave it untouched.

## 4. Build your vertical

You extend the substrate with **data, not schema changes** (invariants 12, 23):

1. **Define your kinds** — entity/attribute/relationship/event/judgment/outcome
   kinds via the `kind.define` action (`substrate.kind.define` MCP tool) or by
   adding rows to your own seed. No migration needed for new kinds.
2. **Write through the action layer** — every change is an action. Use the
   generic `substrate.action.submit` tool, or add typed handlers/APIs following
   `docs/patterns/action-handler.md` and `docs/patterns/ai-action-handler.md`.
3. **Expose MCP tools** — put your domain tools in your OWN package
   (`packages/<your>-tools`), not the core `mcp-tools` index, following
   `docs/patterns/mcp-tool.md`. The MCP server is the canonical interface.
4. **Add worker handlers** — register background jobs in `workers/runtime`
   following `docs/patterns/projection-worker.md`.
5. **Build your app(s)** under `apps/<your-app>`; read context with
   `entity.context` and `entity.search`.

See `adr/0029-layer-3-directory-convention.md` for the vertical directory shape
and `adr/0030-legal-vertical-substitution.md` for a worked example.

## 5. Use the project skills

Project Claude Code skills live under `.claude/skills/` (e.g. `exsto-new-vertical`,
`exsto-substrate-migration`, `exsto-add-kind`, `exsto-mcp-tool`,
`exsto-bootstrap-tenant`). They scaffold the steps above the right way — prefer
them over hand-writing migrations or tools. `CLAUDE.md` carries the hard rules
Claude Code enforces while you build.

## 6. Stay correct

- `pnpm test:invariants` (with a DB URL) must stay green — it proves tenant
  isolation, append-only, bitemporal protection, and migration history hold.
- Every new migration must keep RLS + the append-only/bitemporal posture (the
  `exsto-substrate-migration` skill scaffolds this); CI runs the full suite
  against a fresh Supabase stack on every push.
- Never write to substrate tables outside the action layer (`CLAUDE.md` hard
  rule 1).
