# Pacheco Law wedge — demo runbook

Demo of the operating-agreement intake → consultation → drafting → review loop for Juan Carlos Pacheco. Local-only; founder driving.

The seed loads one full matter — **Pine Hollow Roasters, LLC**, a two-member specialty coffee roaster in Asheville. Marcus Holloway (55%, manager) and Priya Iyer (45%) submitted an intake questionnaire, had a 27-minute consultation with Juan Carlos, and the drafting agent (Sage) has produced a first-draft NC LLC operating agreement and engagement letter, both awaiting review.

---

## Pre-demo (10 minutes before)

In the repo root:

```bash
pnpm install
pnpm build
pnpm seed:demo   # resets the Pacheco Law tenant + loads the Pine Hollow matter
pnpm preflight   # verifies DB, Anthropic key, seed data, ports
```

If `pnpm preflight` shows red on anything, fix it before Juancito arrives. Yellow warnings are okay to proceed; reading the warning text is enough.

Start the demo app in one terminal:

```bash
pnpm dev:web    # http://localhost:3000
```

The app serves both surfaces from one process at:

- <http://localhost:3000/attorney?demo_user=juan-carlos> (attorney)
- <http://localhost:3000/client?demo_user=marcus-holloway> (client portal)
- <http://localhost:3000/> (surface chooser landing)

Open both surfaces in side-by-side browser windows.

---

## The story arc

### 1. "Here's what the client sees"

Switch to the client portal tab (<http://localhost:3000/client?demo_user=marcus-holloway>). Show the landing page, then click **Start the questionnaire**.

- The form pre-fills Marcus's contact info from the URL.
- Scroll through the sections — business, members, operations, engagement terms.
- Don't actually submit. (Submitting now would create *another* matter and clutter the demo state. If Juancito wants to feel the submit flow, that's fine — it goes into the dashboard alongside Pine Hollow.)

Then go to **Book a consultation**. Show the booking slots — these are stubbed from a fake Google Calendar but in production these would be the merged availability of the attorney's two calendars.

Talking point: *"This is the entry point. The questionnaire is structured so the answers feed directly into the drafting prompt later. The booking flow integrates with Google Calendar — we're stubbing it here, but in production it reads both your work and personal calendars and only shows times you're actually free."*

### 2. "Here's what Juan Carlos sees after the consultation"

Switch to the attorney tab (<http://localhost:3000/attorney?demo_user=juan-carlos>). Land on **Matters**.

- Point at the Pine Hollow row. Status: **review_pending**.
- Click into the matter.

Show the matter detail page. The status, the workflow buttons, the questionnaire JSON, the full transcript.

Talking point: *"This is the substrate. Everything is structured, everything has provenance. The questionnaire is whatever the client submitted. The transcript is what Granola captured from the call — in production this happens automatically when the recording finishes; here it's pre-loaded for the demo."*

Scroll through the transcript. It's a real 27-minute consultation covering capital structure, governance, IP assignment, non-compete, death/disability buy-out, dispute resolution. Things the questionnaire didn't ask but the call surfaced.

### 3. "And here's the draft"

Click **Review latest draft (pending_review)** at the bottom of the workflow actions, or jump to **Review queue** in the header and click in.

This is the centerpiece. Take your time here.

**Left side**: the full operating agreement. Eleven articles, ~3500 words of real NC LLC content. Walk through a few sections — Article II (capital contributions, including the Probat roaster valuation), Article III (manager-managed with Marcus as Manager), Article V (death and disability buy-out with averaged appraisals), Article VIII (non-compete: 2 years, 25-mile radius).

**Right side**: the reasoning trace.

- **Reasoning trace summary** card: model identity, overall confidence (88%), the agent's one-sentence conclusion about the draft's posture.
- **Evidence (21)** cards: each shows the source (`questionnaire` purple badge vs `transcript` orange badge), the specific field or transcript item, the value, and which clause of the OA it ended up in. Click through a few. This is the differentiator — show Juancito that every clause traces back to something the client or the call provided.
- **Alternatives considered (6)** cards: each shows a decision point (e.g., "Death/disability buy-out pricing — formula vs appraisal"), the options Sage considered, which one was selected, and why. Show that the agent didn't just write something — it had a structured decision.
- **Ambiguities flagged (6)** cards: yellow background. These are the things Sage couldn't resolve from the inputs and that Juancito needs to handle before signing — the roaster appraisal exhibit, the recipe inventory, life insurance funding, etc.

Talking point: *"This is what makes the substrate worth anything. Every clause in this draft is traceable. If you disagree with Sage on Article 8.1, you can see exactly what evidence drove it and what alternatives it weighed. If you change the underlying questionnaire response, the next draft will reason about the change explicitly. The reasoning isn't a black box."*

### 4. "And you approve, revise, or reject"

Scroll to the review section.

- **Approve**: status flips to approved, the action is logged, draft is frozen.
- **Request revision**: write a note (required), status flips to revision_requested. In production this would trigger a notification + regeneration request.
- **Reject**: kill the draft.

If you want to show the live API path, click **Regenerate draft (live API)**. This calls Claude with the same questionnaire + transcript and produces a fresh draft. Takes 20–40 seconds. Use this when the demo is going well and you want the "real thing" moment. **Don't lead with it** — if the API is slow or rate-limited, you've spent your social capital waiting.

### 5. "Same flow for the engagement letter"

Back to the matter detail. The engagement letter draft is also seeded — different document_kind, same flow. Walk through it briefly. Show that the drafting prompt + transcript scoped the engagement correctly (joint representation, fee structure, RA service inclusion, scope exclusions for trademark/securities/lease).

---

## Anticipated questions

**Q: How does the reasoning trace actually work?**
*Sage runs the drafting prompt against the questionnaire + transcript. The prompt requires it to produce both the document and a structured JSON block with evidence, alternatives, and ambiguities. We persist that JSON alongside the document body. The UI just renders it. So the trace isn't reconstructed after the fact — it's captured at generation time and is structurally part of the action's audit record.*

**Q: What if I disagree with a section of the draft?**
*Two paths. Request revision with a note (e.g., "rewrite Article 8.1 to a 20-mile radius") — the system records the revision request and you regenerate. Or just edit the draft directly in your usual document editor; the system holds the version as approved-with-edits. The substrate doesn't care which path you pick.*

**Q: Can I edit the OA template?**
*Yes, but not in v1. Right now the template lives as a markdown file in the repo. In the next version we'll lift it into the substrate's content store so you can edit it through a UI and version it. Until then, the founder edits the file and re-seeds.*

**Q: Is client data private?**
*Yes. The substrate is tenant-isolated at the database level (Postgres RLS). Every query is scoped to your tenant. No other tenant's data is reachable even by a bug. The system writes are append-only and audit-logged.*

**Q: How do I add new matter types — say, a single-member LLC, or a partnership, or an NC PLLC?*
*Same way you'd add the OA work to the system. Two artifacts: the intake questionnaire (a JSON schema) and the drafting prompt + template (markdown). Drop them in, register the entity_kind, restart. The substrate doesn't care what kind of matter it is.*

**Q: What does a draft cost?**
*Roughly $0.05–$0.15 per OA draft on Sonnet 4.6, depending on transcript length. The cached draft you're looking at right now was produced once during seeding so the demo doesn't depend on a live API call. The Regenerate button is the live path.*

**Q: When can I use this on a real matter?**
*The substrate is real and the workflow is real, but the integrations are stubbed — Granola is pre-loaded, Google Calendar is a fake availability list, and there's no e-signature. The next two weeks are: real Granola webhook, real Calendar booking, real auth. After that, you can try it on a low-stakes matter to see if you trust the drafts.*

---

## Recovery moves

**Anything broken?**

1. **Refresh the page.** Most browser-side state hiccups clear with a refresh.
2. **Re-seed.** `pnpm seed:demo` in the repo root. Resets matter data; tenant + actors stay. Demo URLs unchanged.
3. **Restart the dev server.** Stop the terminal (Ctrl+C), `pnpm build && pnpm dev:web`.
4. **Fallback to the cached draft.** If `Regenerate draft (live API)` hangs or errors, just navigate back to the previously cached version via the matter detail page → "Review latest draft." That draft is in the DB and doesn't depend on the API.

**Demo not on your home network and Supabase is slow?** The pooler URL adds latency. For an in-person demo on a less reliable network, consider running a local Postgres + applying the migration files locally instead. Beyond scope for this runbook.

---

## What is not built yet (frame as roadmap, not gaps)

- **Real Granola integration.** The transcript was pre-loaded for the demo. The webhook receiver, transcript fetch, and projection to substrate entities are designed but unwired.
- **Real Google Calendar booking.** The availability slots are stubbed; the real adapter reads the attorney's two Google accounts (work + personal).
- **Real auth.** Both apps use a `?demo_user=` query param to simulate "who's signed in." Production needs Supabase Auth or equivalent. See ADR 0035.
- **Library layer.** Templates and prompts are markdown files in the repo. In the next version, they live in the substrate as content rows so non-engineers can edit them through a UI.
- **E-signature.** Drafts deliver as markdown for now. Real DocuSign (or alternative) integration is a separate session.
- **Worker runtime for drafting.** Today the drafting call runs inline inside the MCP request — Juan Carlos waits for Claude. Once the worker runtime is wired up, drafting becomes a background job with a notification.
- **Invariant test suite.** The 23 substrate invariants have ADRs but no executable tests yet. Required for any production-grade audit posture.

---

## Reset for a second walk-through

`pnpm seed:demo` runs again, drops the Pine Hollow data, reloads it fresh. Browser sessionStorage is fine; the URLs keep the demo identity. Reload the attorney and client tabs.
