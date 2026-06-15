# Claude Handoff — Exsto-Law (legal vertical)

> Generated 2026-06-15 for a laptop migration. Orientation file only.
> **Canonical: `CLAUDE.md`, `ARCHITECTURE.md`, and `docs/DECISIONS-*.md`.**
> exsto-law is the **pattern source** other Exsto clones copy from.

## What this is
**exsto-law** — the legal-practice vertical and the **first real client clone** of the Exsto
foundation. Attorney-facing tool (intake/booking, matter timeline, document drafting, research).

## Where it lives
- **Old-machine path:** `C:\Users\Work\code\Upload\exsto-law`
- **GitHub:** https://github.com/Jogotsoftware/exsto-law · default branch `main`
- **⚠️ `main` is PROTECTED** (required checks `verify` + `invariants`, PR required, enforce_admins).
- **Live:** https://exstolaw.netlify.app
- **This handoff is on branch `laptop-migration-snapshot`** (main is protected). On the new
  machine: `git checkout laptop-migration-snapshot` to read it.

> **Note:** the only other uncommitted file in the tree was a Netlify deploy artifact
> (`deploy-<id>.zip`) — intentionally **not committed** (regenerable build output; it would just
> bloat the repo). It still ships in the iCloud folder copy if you want it.

## Foundation
Live on foundation **v1.0.3**. Substrate work goes through the action layer / MCP tools — never
direct DB. See the foundation repo (`exsto`) for the substrate rules.

## Key features shipped (a 17-PR arc, 2026-06-11/12)
- **Settings → Integrations:** user-managed API keys (Anthropic / Granola / Google / Perplexity /
  OpenAI), **Vault-stored**; the Claude adapter resolves the tenant Vault key per call (beats the env key).
- **Perplexity research panel** on the matter timeline (`research.recorded` event kind).
- **Service library:** services are editable, versioned `workflow_definition` config (in-app
  questionnaire editor + drafting-prompt editor + create-from-scratch, completeness-gated enable).
- **Granola folder import** (REST `public-api.granola.ai/v1`; attendee-email → matter match).
- **Real auth:** signed httpOnly session cookie (server-verified, prod cookie-gated).
- **Security hardening:** public-MCP default-deny allowlist (`clientPolicy.ts`), OAuth
  `safeInternalPath` (open-redirect fix), per-IP rate limiting, **HMAC-signed OAuth state**, CAPTCHA hook.

## ⚠️ Deploy actions (or auth fails closed)
- The live Netlify env **must** set `OAUTH_STATE_SECRET` (≥16 chars) or Google OAuth fails closed.
- Enabling CAPTCHA additionally needs the frontend widget on `/book` + `TURNSTILE_SECRET`/`HCAPTCHA_SECRET`.

## Integration keys & secrets
`.env` / Vault hold the secrets and are gitignored → not on GitHub. They ship only in the folder copy.
