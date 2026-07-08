# BUILDER-REASONING-CHANNEL-1 — reasoning/process out of the reply, into an expandable "thinking" disclosure

Session 2026-07-08 · branch `builder-reasoning-channel-1` (off `main` @ `c1ba222`) · **NO migration** (rendering/channel only; frontier stays 0119) · PR only.

The builder was spilling machinery into the visible reply — process narration ("Using Build a Service"), skill/router tags, and internal vocab ("token", "availableTemplates", "capability_slug"). It read like a debug console. This session enforces the #300 rule (reply renders ONLY answer text + cards + proposals) at the SOURCE, and adds the transparency-on-demand surface: a collapsed, expandable "thinking" disclosure where the reasoning/process CAN be seen on demand.

## Diagnosis — cause (a), with evidence (this was diagnostic-first; the fix follows the cause)

**The reasoning channel is already cleanly separated at the API level and is NOT rendered as reply. The internal vocab reaches the reply because the model WRITES it into the reply (`text`) channel.** That is cause **(a)** — a generation/prompt-structure problem — not (b) a render path leaking a separated reasoning field.

Evidence (code-path proof — the reply prose can *only* be `text_delta`):

1. **The adapter splits channels at the API boundary.** `verticals/legal/src/adapters/claude.ts:807-817`: `text_delta → {type:'text'}` (the answer); `thinking_delta → {type:'thinking'}` (adaptive extended-thinking reasoning, requested `summarized` at `claude.ts:433-435`). Two structurally distinct streams.
2. **The client renders `text` as the transcript and DISCARDS `thinking`.** `UnifiedAssistantChat.tsx` `onText → partial.text` (the only thing rendered as reply markdown) vs `onThinking → partial.thinking`, which pre-fix was an **ephemeral animation only** — wiped on done and explicitly "neither persisted nor sent back in history" (the `!streaming.text && streaming.thinking` indicator block). So genuine reasoning never reached the reply.
3. **Where the parroted vocab comes from.** The `get_workflow_context` tool result hands the model raw machinery — `capability_slug`, `availableTemplates`, `stepTemplate`, `token`, `gateTransitions` (`verticals/legal/src/api/workflowAuthoring.ts:71-161`). Nothing at generation told the model this vocabulary belongs to its working-out, not its answer, so it narrated it into `text`. (That file is builder-authoring logic owned by a concurrent stream — **NOT touched**.)

⟹ Any `capability_slug`/`token`/`availableTemplates` seen in a transcript was emitted by the model into the `text` channel. Cause (a). Payload note: prod was NOT queried for a literal JSON payload — the brief's ⚠️ flags the shared connection pool and `.env.local`'s `DATABASE_URL` points at the pooler; the code path is dispositive without it. The persisted turn stores `reply` and (now) `reasoning` as distinct fields, so the field-vs-field separation is now explicit in storage as well.

**Rider (not the core leak):** the "Using {skill}" chips are a *separate designed render element* fed by `skill` events, shown only on the in-flight streaming bubble (never on the committed turn). They're process tags the brief also wants gone, so they're now cleared the moment answer text arrives (below) — but they were never part of the committed transcript that acceptance A screenshots.

## The fix (source-side; no post-hoc strip rules; reasoning relocated, not destroyed)

1. **Generation — clean channel separation enforced at the source** (`assistantChat.ts` `SYSTEM_PROMPT`, new `REPLY vs REASONING` rule). The reply contains ONLY the attorney-facing answer in plain English + the cards/proposals/documents tools surface. It must NEVER contain (1) process narration — "Using <skill>", "Let me call…", tool/skill/router/phase names — or (2) internal identifiers/data-structure vocabulary from tool inputs/results — field/entity ids, slugs (`capability_slug`), config keys (`availableTemplates`, `config_schema`, `gateTransitions`, `stepTemplate`), advance tokens, snake_case keys, raw JSON. Reasoning and any reference to internal structure belong in the thinking channel, shown behind the disclosure. This is a generation-time instruction (structural), **not a regex strip** — Joe's directive was to fix at the source.
2. **Relocation — reasoning routed to a collapsed, expandable disclosure** (the Claude pattern: clean by default, transparent on demand).
   - Server: the streamed `thinking` deltas are accumulated into a `reasoning` string and persisted with the turn as an **additive JSONB payload field** (`recordAssistantTurn` → `data.reasoning`, null when the turn produced none). `listAssistantThread` reads it back. No migration — `assistant.turn` payload is free-form JSON, same additive pattern as `produced_documents`/`workflow_proposals`.
   - Client: live turns relocate `partial.thinking` into the committed turn's `reasoning`; reopened threads load `reasoning` from the payload. A new `ReasoningDisclosure` component renders a collapsed "Thinking" toggle (chevron + sparkle); expanding shows the reasoning verbatim (plain summarized text, not markdown). Absent for `quick` (no thinking) and pre-1 turns.
3. **Rider — live skill chips cleared once answer text arrives** (`!streaming.text && streaming.skills.length`), so the streaming bubble also reads clean the moment the reply starts.

## Why this can't regress the current reply
Everything is additive: a strengthened generation instruction (can only reduce or leave leakage unchanged — never increase it) + additive persistence/render of a channel that was previously discarded. No existing reply behavior, card, or proposal render is changed. Worst case if the model imperfectly obeys the new rule: the reply is no worse than today AND the reasoning is now relocated behind the disclosure.

## Scope / parallel-safety
- **NO migration** (frontier stays 0119). Stayed entirely in chat/render + response-assembly: `assistantChat.ts` (prompt + persistence + thread read), `UnifiedAssistantChat.tsx` (types + render + chip guard), `globals.css` (disclosure styles — additive classes only).
- **NOT touched:** builder authoring logic, intake-schema/field model, playbook, workflow/capability/runtime (`workflowAuthoring.ts`, `capabilityRuntime.ts`, etc.), the adapter retry path (#306), booking (#307).
- No EMAXCONNSESSION/pool errors encountered (no DB access performed).

## Gate
Full local gate green in the isolated worktree: `typecheck` (tsc --noEmit) + `lint` (eslint) + `format` (prettier) + `build` (tsc -b) + `test:unit` (90/90). The DB-gated `assistant-chat.test.ts` (which exercises `recordAssistantTurn`) is not in the local `test:unit` set (no Docker locally) and runs in CI; the `reasoning` field is additive-optional so its existing assertions are unaffected.

## Acceptance A–D
- **A (the load-bearing negative) — clean reply.** Enforced at generation by the `REPLY vs REASONING` rule (reply = prose + cards only; the named identifiers `capability_slug`/`token`/`availableTemplates` and all process/skill/router tags are directed to the thinking channel). Live "Using…" chips also cleared once text starts. **Live pasted-transcript proof requires a running app** (Anthropic key + DB) and was not captured in this non-interactive session — to be confirmed by driving a build-service conversation in the deployed app.
- **B — reasoning available behind the disclosure.** Collapsed "Thinking" toggle on every committed assistant turn that produced reasoning; expands to show the same process/reasoning that previously flashed as the ephemeral "Thinking…" indicator. Persisted to the turn payload, so it survives reopen — relocated, not destroyed.
- **C — cards/proposals unchanged.** No change to any proposal/document/card render path; the disclosure renders after the reply markdown and before the cards.
- **D — diagnosis (a vs b) documented with the payload/field evidence above.**
