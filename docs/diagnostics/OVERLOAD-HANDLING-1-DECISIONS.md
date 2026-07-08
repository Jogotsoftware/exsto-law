# OVERLOAD-HANDLING-1 — graceful transient-error handling for model calls

Session 2026-07-08 · branch `fix/overload-handling` (off `main` @ `fda1d8f`) · no migration (request-layer only) · PR open, CI green.

Anthropic API overload (`overloaded_error` / HTTP 529) was being dumped raw to the
attorney as JSON in a red box — `{"type":"error","error":{...},"request_id":"…"}` —
instead of being retried. 529 is transient and retryable (momentary API saturation),
so two things were wrong: (1) a self-resolving blip surfaced instead of retrying, and
(2) raw API-error machinery rendered in the transcript. This session fixes both at the
one place that talks to Anthropic (the Claude adapter, "Contract A"): auto-retry
transient errors with bounded backoff, and — only if retries exhaust — surface a plain
human sentence, never JSON, never a request_id. No lifecycle/catalog/capabilityRuntime
changes (owned by the concurrent WORKFLOW-AUTHORING-1 session).

## Preflight

- **Request-layer only, no migration.** Frontier ledger reads 0118; 0119 is applied-and-
  taken by booking (#305, unstamped). This session claims nothing — it is code-only.
- Delivered from an isolated worktree (`exsto-law__overload`) per the repo's parallel-
  session hygiene, not the shared checkout.

## Decisions (non-obvious rationale)

1. **Retry lives in the adapter, scoped to a single `messages.create`/`.stream` round —
   not the outer turn, not the route.** The assistant/drafter/capability paths all funnel
   through `verticals/legal/src/adapters/claude.ts`, so wrapping each individual model
   round-trip there fixes every caller at once (streaming chat, non-streaming/MCP chat,
   document drafting, and — via `callClaudeDrafter` — capability AI-review) with one
   change and without touching the forbidden files.

2. **Single-round grain IS the side-effect-safety guarantee.** Client tools
   (`log_feedback`, `request_capability` — real substrate writes) run only AFTER a round
   succeeds with `stop_reason === 'tool_use'`. A round whose `create()`/`stream()` call
   throws executed no tool, so retrying just re-sends the identical request body — it
   cannot double-fire a write. Retrying at a coarser grain (the whole turn) could, which
   is exactly why we don't. This directly answers the brief's item-5 scenario ("a call
   that both triggers a tool AND 529s on response"): in this architecture that call never
   both fires a tool and fails — the 529 means we never got the tool_use to run.

3. **We own retry; the SDK's built-in retry is disabled (`maxRetries: 0`).** The pinned
   SDK silently retries 429/5xx twice by default. Leaving it on would compound with ours
   (2 × N) into confusing latency and give no app-level signal. Disabling it makes the
   policy deterministic, logged (`console.warn` per retry), testable, and identical across
   streaming and non-streaming.

4. **Retry policy.** Retryable = `overloaded_error`/529, 429, any 5xx, and
   `APIConnectionError` (network/timeout). NON-retryable = 400/401/403/404/422 and a user
   abort (`APIUserAbortError`) — retrying can't fix them, so they surface immediately.
   Backoff before each retry is **1s / 2s / 4s** (3 retries, 4 attempts total); a
   `Retry-After` header is honored when present, capped at 8s so a synchronous request
   can't hang. The schedule is short on purpose — these calls are synchronous-in-request
   and must stay under the route's `maxDuration` (durable-worker offload is a separate
   Phase-1 item, explicitly out of scope here).

5. **Streaming retries only before the first delta.** In `streamChatWithAssistant` a
   round is retried only while nothing has streamed to the consumer (`roundEmitted`);
   once any text/thinking/drafting chunk is out, re-streaming would duplicate it, so a
   mid-stream failure surfaces. A 529/overload happens at connection setup (before any
   delta), so the exact bug we're fixing is retried invisibly; a mid-stream network drop
   correctly surfaces rather than double-writing the transcript.

6. **Graceful surface: one humanizer, never JSON.** `toUserFacingError` (was
   `assistantAuthError`) keeps the existing "rejected key → mark connection + point at
   Settings" behavior for 401/403, and for everything else returns
   `humanizeAnthropicError(err)`: transient → "The assistant is briefly overloaded —
   please try again in a moment."; connection → "temporarily unavailable"; other API
   errors → the model's own `message` field extracted from the body (never the envelope,
   never the request_id); anything JSON-looking → a generic sentence. The raw detail is
   still `console.error`'d (redacted) for diagnosis.

7. **Defensive client sanitizer as the last line of defense.** `UnifiedAssistantChat`
   now passes `error` through `humanizeClientError` before rendering: if any raw-JSON-
   looking string ever reaches the alert from any path (now or future), it's replaced
   with a plain sentence. The server already guarantees clean messages; this makes
   acceptance B hold regardless of source. The pre-existing one-shot client auto-retry
   is left in place — it composes with the server retry as an extra resilience layer.

## Acceptance — receipts

Unit suite `tests/vertical/overload-handling.test.ts` (13 tests, registered in
`test:unit`), all green; full `pnpm test:unit` = 67 passed.

- **A — self-resolving 529 is invisible.** `withTransientRetry` throws 529 on attempt 1,
  succeeds on attempt 2, returns `'ok'`; caller sees no error (`calls === 2`).
- **B — persistent 529 → plain message, no JSON.** After 4 attempts it throws;
  `humanizeAnthropicError` returns the "briefly overloaded" sentence; asserted `not.match`
  on `{`/`[`, `request_id|req_`, `overloaded_error`.
- **C — non-retryable 400 surfaces immediately.** `calls === 1` (no retry);
  `extractApiErrorMessage` returns the model's `message`; humanized message contains it,
  contains no JSON/request_id.
- **D — context preserved, side effect once.** Retried call is re-invoked with the
  identical prompt each attempt (`[PROMPT, PROMPT, PROMPT]`); the post-success "tool" runs
  exactly once (`sideEffects === 1`).
- **E — backoff + Retry-After.** `retryDelayMs` = 1000/2000/4000 then null;
  `Retry-After: 2` → 2000; `Retry-After: 99` → capped 8000; injected clock records
  `[1000, 2000]` waited before the winning third attempt.

Gate: `typecheck` ✓ · `lint` ✓ · `format:check` ✓ · `build` (tsc -b) ✓ · `test:unit` 67 ✓.

## Files

`verticals/legal/src/adapters/claude.ts` (retry/classify/humanize helpers + 4 call sites +
`maxRetries: 0`) · `verticals/legal/src/index.ts` (barrel exports for the tested helpers) ·
`apps/legal-demo/components/UnifiedAssistantChat.tsx` (defensive `humanizeClientError`) ·
`tests/vertical/overload-handling.test.ts` (new) · `package.json` (register test; add
`@anthropic-ai/sdk` as a root devDep so the test can fabricate real SDK errors) ·
`pnpm-lock.yaml`.

## Notes / follow-ups (not this session)

- **Durable worker / `maxDuration` for heavy synchronous model calls** is the long-term
  fix for the underlying timeout pressure — explicitly a separate Phase-1 item, not this
  retry+graceful-surface pass.
- **Coarse (whole-turn) retry after a mid-turn side-effecting tool** (e.g. round 0 ran
  `request_capability`, round 1 failed) is not auto-retried by the server (single-round
  grain) and the client's one-shot retry would replay the turn. Realistic exposure is low
  (both mid-turn write tools are rare and the failure must land in a later round); if it
  ever bites, make those two tools idempotent-per-request rather than widening retry
  grain. Documented here rather than fixed to keep the change small and request-layer-only.
- `verticals/legal/demo/preflight.ts` calls the SDK directly (not through the adapter), so
  it does not get this retry. It's a standalone CLI diagnostic, not a request path — left
  as-is.
