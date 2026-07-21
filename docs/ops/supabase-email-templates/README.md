# Supabase Auth email templates — branded confirmation + recovery (PT-3)

The founder's ask: the Supabase confirmation email is "super ugly" and the
project has no forgot/reset-password flow at all. The app code for the
forgot/reset flow is in this PR (`/portal/forgot-password`,
`/portal/reset-password`, `/api/client/auth/reset-password`); this directory
holds the branded HTML for the two Supabase-side email templates the flow
depends on. **Supabase project configuration cannot be changed from a
feature branch** — these two steps are manual, one-time, done in the Supabase
dashboard by whoever holds project access (Joe / the orchestrator).

Supabase's email templates are **project-wide**, not per-tenant — every firm
on this Exsto clone shares the same Supabase Auth project (see
`auth.users` is global across all tenants). So these templates are branded as
the **product** ("Legal Instruments"), never a specific firm's name — the
same reasoning verticals/legal/src/email/brand.ts documents for why the
in-app transactional emails carry firm branding but these two can't.

## What to do, exactly

1. Open the Supabase dashboard for this project → **Authentication** →
   **Email Templates**.
2. Select **Confirm signup**. Replace the body with the contents of
   [`confirmation.html`](./confirmation.html) (paste as raw HTML — the editor
   has an HTML/source toggle). Leave the **Subject** as-is or set it to
   `Confirm your email` — copy is already in the body. Save.
3. Select **Reset password**. Replace the body with the contents of
   [`recovery.html`](./recovery.html). Subject: `Reset your password`. Save.
4. Do **not** touch the other templates (Magic Link, Invite, Email Change) —
   out of scope for this PR; they're still the Supabase defaults.

Both templates use Supabase's own Go-template variables
(`{{ .ConfirmationURL }}`, `{{ .Email }}`) — Supabase substitutes these
server-side when it sends the mail, the same variables the current default
templates already use, so nothing else needs to change for them to resolve.

## Redirect URL allow-list

Supabase refuses to redirect to a URL that isn't on the project's **Auth →
URL Configuration → Redirect URLs** allow-list, even if the `redirectTo` the
app requests is well-formed. The app already relies on one entry for
confirmation (`/portal/login`); this PR adds a second for recovery
(`/portal/reset-password`). Confirm BOTH are present for every deployed
origin (production + any preview/staging domains in use):

- `https://exsto-law.netlify.app/portal/login` (confirmation — should
  already be present; #434 fixed a wrong-fallback-domain bug here, this is
  just confirming it's still correct)
- `https://exsto-law.netlify.app/portal/reset-password` (recovery — **new**,
  add this one)

If Supabase's allow-list UI on this project supports wildcards, a single
`https://exsto-law.netlify.app/portal/**` entry covers both (and any future
portal auth screen) — otherwise add both exact paths. Either form must
tolerate the `?firm=<slug>` query suffix the app appends for tenant-aware
branding (MULTI-TENANT-1) — Supabase matches redirect URLs on origin + path,
not the full query string, so this should already work with an exact-path or
wildcard entry; verify one round-trip end-to-end after saving (request a
reset for a real portal account, confirm the emailed link lands on
`/portal/reset-password` without a Supabase-side "redirect URL not allowed"
error).

## Recommended: raise the minimum password length in the dashboard too

The app enforces an 8-character minimum everywhere a password is SET or
RESET through our own server routes (`lib/passwordPolicy.ts` — see the PR
body for why a character ban was intentionally NOT added there). One path
bypasses our server entirely: `/portal/login`'s "Create an account" toggle
calls Supabase's `auth.signUp()` directly from the browser (no app-server
hop), and the browser-side check is only a fast inline nudge, not the
authoritative one for that specific path. Supabase itself enforces its own
project-level minimum password length; go to **Authentication → Policies**
(or **Auth → Settings**, depending on dashboard version) → **Password
Requirements** / **Minimum password length**, and set it to **8** so that
one direct path is backed by the same rule as everywhere else, at the
project's own enforcement layer.
