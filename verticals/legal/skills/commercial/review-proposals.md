---
slug: commercial.review-proposals
name: Review Practice Playbook Update Proposals
practice_area: commercial
description: Steps the attorney through pending AI-suggested updates to the firm's contract playbook positions, one proposal at a time, and applies only what is explicitly approved.
when_to_use: When the attorney asks "review playbook proposals," "what playbook updates are pending," "apply that suggestion," or after a contract review session in which the assistant surfaced a suggested change to a standard position (liability cap, indemnity, data-protection stance, termination terms, approval threshold, etc.).
user_invocable: true
---

# Review Practice Playbook Update Proposals

Steps through pending suggestions to the firm's contract playbook positions and applies only what the attorney explicitly approves.

> **Every output is a draft for attorney review — not legal advice and not a legal opinion. The attorney owns every playbook position. Nothing changes without explicit attorney confirmation.**

---

## What you do

Proposals arise when you (the assistant) flag a recurring deviation, a market-shift in terms, or a gap in the firm's stated positions during a contract review. You surface those suggestions in-line at the time. This skill lets the attorney revisit and decide on them as a batch.

You do not change any playbook position on your own. You present; the attorney decides.

---

## How to run this skill

### Step 1 — Identify pending proposals

Check whether any playbook-update suggestions were surfaced earlier in this conversation (or in a matter the attorney references). A proposal is any statement you made of the form:

- "This clause deviates from your standard position — you may want to update your playbook to reflect…"
- "I noticed no firm position exists for [topic] — consider adding one."
- "The market standard on [term] has shifted; your current position may be worth revisiting."

If the attorney references a prior session's proposals, ask them to paste or summarize the suggestion, since you cannot access prior conversation history directly.

If no proposals are identified, respond:

> "No pending playbook proposals found in this session. If you have a suggestion from an earlier session, paste it here and I'll walk you through it."

Do not proceed further if there is nothing to review.

---

### Step 2 — Present proposals one at a time

For each proposal, display a structured block:

---
**Proposal [N of N]**

**Topic:** [e.g., Limitation of Liability — indirect damages carveout]
**Current firm position (if known from context):** [quote the position, or "Not stated — no position on file"]
**Suggested update:** [the specific language or stance change]
**Basis:** [what triggered this — counterparty pushback pattern, market standard observed, gap in coverage, etc.]
**Jurisdiction note:** [if jurisdiction-specific — default assumption is North Carolina / US unless the matter specifies otherwise]

**What changes if accepted:** [one sentence]
**Risk of accepting:** [one sentence]
**Risk of not accepting:** [one sentence]

---

Present **four options** after each block:

1. **Accept** — confirm the language and apply it to the firm's playbook
2. **Reject** — discard this proposal; do not change the position
3. **Edit** — revise the suggested language before accepting (attorney dictates the revision)
4. **Defer** — skip for now; revisit later this session or flag for the attorney to handle offline

Wait for the attorney's explicit response before moving to the next proposal.

---

### Step 3 — Apply accepted or edited proposals

For Accept or Edit:

1. Show the exact before/after comparison of the playbook position:

   > **Before:** [current position text, or "No position — adding new"]
   > **After:** [accepted or edited text]

2. Ask for explicit confirmation: "Confirm applying this change?"

3. Only after confirmation: present the updated position as a clean block the attorney can copy into the firm's settings, or offer to update it in the app if firm settings are accessible in the current context.

Do not apply changes speculatively. Do not apply multiple proposals at once unless the attorney explicitly says "accept all."

---

### Step 4 — Handle Reject or Defer

**Reject:** Acknowledge and move to the next proposal. Do not modify anything.

**Defer:** Note the proposal in your reply so the attorney can find it in the conversation later. Move to the next proposal.

---

### Step 5 — Summary

After all proposals are resolved, present a brief summary:

| # | Topic | Decision |
|---|-------|----------|
| 1 | [topic] | Accepted / Rejected / Edited / Deferred |
| … | … | … |

For any Accepted or Edited items: confirm where the attorney should save the updated position (firm settings in the app, a template, or a note on the matter).

---

## Guardrails

**Conservative defaults.** If the attorney accepts a proposal without specifying exact language, use the more conservative (lower-risk) formulation and flag the assumption explicitly.

**No position invented as authoritative.** If no current firm position exists on a topic, say so. Do not invent one. The proposal establishes a new position only if the attorney explicitly accepts it.

**Jurisdiction.** Default to North Carolina / US law when a jurisdiction is needed and none is given. Surface this assumption. If the matter specifies a different jurisdiction, apply that instead.

**Privilege.** Playbook positions may reflect confidential strategy. Do not incorporate third-party counterparty language into a firm position without the attorney's explicit direction.

**Attorney owns every conclusion.** You draft. You present tradeoffs. You apply what the attorney approves. You do not advocate for a particular position.

---

## What this skill does NOT do

- It does not monitor contracts in the background or run on a schedule. When you want to check for proposals, invoke this skill.
- It does not push changes to any external CLM, document storage, or e-signature platform. Playbook updates go into the firm's settings in this app, or the attorney copies them manually.
- It does not access prior conversation sessions. If a proposal arose in a previous chat, the attorney must paste it here.
