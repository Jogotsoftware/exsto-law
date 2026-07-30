# SB-FIX-1 — reproduction: the service builder loses its place

Date: 2026-07-30. Repo state: `main` @ `3cda8463`. Tenant: **Pacheco Law**
(`ae5530a1-05c7-4241-a38e-79bd186c1bbb`, slug `pacheco`) — prod, not sandbox.
Prod flags at the time of the run: `LEGAL_BUILD_WIZARD=1`, `LEGAL_WORKFLOW_ENGINE=1`.

Two independent reproductions: a **live scripted build** run for this ticket, and the
**recorded prod build** the founder reported on 2026-07-24. They fail the same way.

---

## A. Live reproduction (harness, 2026-07-30)

`verticals/legal/demo/sb-fix-1-repro.ts` drives the builder through `assistantChat()`
— the exact function the app's SSE route wraps — with the real Opus build-mode model,
the seeded `firm-admin.build-service` skill, the real closed tool contracts and
validators. Approvals call the same server functions the app's approve routes call
(`createServiceAI` / `createTemplateAI` / `createQuestionnaireAI` / `createCostAI` /
`setServiceLifecycleAI`) and fire the app's exact hidden continuation. It also mirrors
the client's own progress-strip derivation, so what the attorney is *shown* is recorded
next to what the model actually *did*.

Scripted sequence — the reported repro verbatim: walkthrough → approve shell → approve
template → approve questionnaire → **approve billing** → "go back and change the intake
form" → approve the revised questionnaire → observe where the flow resumes.

Service built: `commercial_lease_review` (a real disabled draft in Pacheco; archived at
the end of this ticket).

| step | strip shows the attorney | model actually proposed |
|---|---|---|
| 1 walkthrough | Step 1 of 6 · Define service | SERVICE |
| 2 shell approved | Step 2 of 6 · Client intake | TEMPLATE |
| 3 template approved | Step 2 of 6 · Client intake | QUESTIONNAIRE |
| 4 questionnaire approved | **Step 4 of 6 · Workflow** | **COST** |
| 5 **billing approved** | **Step 4 of 6 · Workflow** | WORKFLOW |
| 6 "go back to the intake form" | Step 4 of 6 · Workflow | QUESTIONNAIRE |
| 7 **revised intake approved** | **Step 4 of 6 · Workflow** | **TEMPLATE** ← the defect |

**What went wrong at step 7.** The attorney had a workflow card sitting unapproved from
step 5. After approving the revised intake, the builder did not resume it. It proposed a
**document template** — and the template it proposed was a re-proposal of the engagement
letter *already approved at step 3*, with identical tokens
(`letter_date, client_name, client_address, client_email`; prod `assistant.turn`
19:06:06, summary: "Re-proposes the existing engagement letter … body and tokens are
unchanged"). So the detour ended by restarting the build order two steps *earlier* than
where it left off, silently abandoning the pending workflow card.

**What the attorney saw the whole time.** The strip read "Step 4 of 6 · Workflow"
continuously from step 4 through step 7 — while the builder asked for billing, then the
workflow, then the intake, then a template. It never once moved, and it was wrong at
step 4 (Workflow while the model was asking for Billing).

---

## B. Recorded prod reproduction (founder's build, 2026-07-24)

Build session `0f4f7d3d-d5ae-48e5-af43-508509d22dac`, service
`multi_member_llc_operating_agreement`, 30 messages, 15 turns. Card sequence from the
`assistant.turn` events:

```
13:16 SERVICE   13:17 TEMPLATE   13:17 QUESTIONNAIRE   13:18 COST ①
13:21 QUESTIONNAIRE ②   13:22 QUESTIONNAIRE ③   13:25 QUESTIONNAIRE ④
13:26 COST ②   13:29 COST ③   13:30 WORKFLOW   13:37 WORKFLOW ②   13:38 ENABLE
```

The cost card was put in front of the attorney **three times** and the questionnaire
**four times** in a single build. Each time the conversation detoured (e-sign questions,
member-capture questions) and came back, the builder re-emitted a card the attorney
already had open rather than resuming.

---

## C. Root causes (all deterministic; none require the model to misbehave)

### C1. Three build orders exist, and two of them are wrong

| where | order |
|---|---|
| `verticals/legal/skills/firm-admin/build-service.md` §"The build order" (authoritative) | shell → **documents → questionnaire → billing → workflow** → enable |
| `verticals/legal/src/api/assistantChat.ts:876` (prompt pointer) | shell → **documents → questionnaire → billing → workflow** → enable |
| `apps/legal-demo/components/UnifiedAssistantChat.tsx:276` `BUILD_PHASES` (what the attorney sees) | service → **questionnaire → template → workflow → billing** → enable |

The client's strip has **questionnaire and template swapped, and workflow and billing
swapped** relative to the playbook the model follows. Nothing keeps the three in sync;
there is no shared constant. This alone makes the strip wrong for most of every build.

### C2. Progress is monotonic — it cannot represent a revision

`approvedPhases` is a `Set` that is only ever added to
(`UnifiedAssistantChat.tsx:2878`, `next.add(info.artifact)`) and only reset when the
whole build restarts. The strip is "the first not-yet-approved phase"
(`:3047`). So re-opening an already-approved artifact — the exact repro — can never
move the indicator back. Step 6 above re-proposed the questionnaire; the strip stayed
on Workflow.

### C3. The BUILD BRIEF records only APPROVED state, never what is pending

`formatBuildBrief` (`verticals/legal/src/api/buildBrief.ts:43`) is derived entirely
from persisted artifacts — the service row, its questionnaire, its templates, its
lifecycle, its cost. A proposed-but-unapproved card persists **nothing**. So the brief
cannot distinguish:

- "the workflow has not been proposed yet" from
- "the workflow was proposed one turn ago and is sitting on the attorney's screen".

Both render as `Workflow: none yet.` After any detour, the model re-derives its
position from approvals alone — and re-proposes. That is precisely the 3× cost card and
4× questionnaire card in §B, and the abandoned workflow card in §A.

The brief also never states *where the build is*; it lists artifacts and leaves the
model to re-derive position from prose every turn.

### C4. The build session never learns which service it is building

`setBuildSessionService` (`verticals/legal/src/api/buildSession.ts:121`) is exported and
**called from nowhere** (`grep -rn setBuildSessionService` → the definition only). The
key is written once at session start, and the client resets `buildServiceKeyRef` to
`null` when a build begins, so it is always written as null. Confirmed in prod — all
five build sessions in the Pacheco tenant:

```
service_key = NULL   for every service_build_session row
```

Consequences: `findOpenBuildSessionForActor` matches on that key and returns `null`
whenever the key is blank, so the anti-fragmentation fallback (HARDENING-RESIDUALS-1
WP-D5) is dead code in practice; and every build thread in the history picker titles
itself "Build: new service" (`listBuildSessions` falls back when the key is null).

---

### C5. Approving a REVISED artifact fires no continuation at all

Found while fixing the above, in the app rather than the harness. `handleApproved`
guards against one approval firing two continuations with a `continuedRef` keyed
`serviceKey:artifact` (`UnifiedAssistantChat.tsx:3004`), and that set is cleared only
when a whole new thread or conversation starts (`:1627, :1744, :1782`). A mid-build
revision is, by definition, a **second** approval of the same artifact for the same
service — so it hits the guard and returns early. No continuation is sent, and the
build simply stops until the attorney types something unprompted.

This is invisible to the harness in §A (which drives continuations itself), which is
why the live run showed the builder doing the *wrong* next thing while the real app
would have done *nothing*. Both are the same defect wearing different clothes.

## D. What a fix has to do

1. **One build order, owned in one place**, imported by the strip, the brief and the
   prompt — so C1 cannot recur.
2. **The brief must carry pending cards** and an explicit next step, so a detour ends by
   resuming rather than re-deriving (C3).
3. **The strip must be able to move backwards** to the artifact actually in play (C2).
4. **Stamp the build session's service key** on first shell approve (C4).
5. **A re-proposed artifact must be re-approvable** — the double-fire guard has to
   release when a new card for that artifact appears (C5).

Verification for the fix is a re-run of `sb-fix-1-repro.ts` against the same scripted
sequence: at step 7 the builder must resume the pending workflow card, and the strip
must name the phase the builder is actually on at every step.

---

## E. Two other defects this run confirmed live

On the same `commercial_lease_review` service, before any fix:

- **Template/questionnaire drift (SB-FIX-1 defect 2).** Final intake fields:
  `lease_file, lease_years_remaining, concerns, client_address`. The only document is the
  engagement letter, whose tokens are `letter_date, client_name, client_address,
  client_email`. `lease_years_remaining` — the field the attorney explicitly asked for at
  step 6 — reaches no document at all. Nothing warned anyone.
- **Missing jurisdiction (SB-FIX-1 defect 3).** The approved questionnaire has no
  `governing_jurisdiction` field, so every matter would fall back to the firm's home
  state. Same omission as the 2026-07-24 prod build, where the operating-agreement
  template used `{{governing_jurisdiction}}` eight times and the approved questionnaire
  never asked for it (`missingForTokens: []` — the coverage gate exempts system tokens
  by design, so nothing caught it).
