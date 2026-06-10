---
name: starterprompt
description: Use to turn a rough product idea into a tight, substrate-aware Claude Code starter prompt for a new Exsto-based tool. ALWAYS use this when the user says "/starterprompt", "help me start a new project", "I have an idea for a tool", "let's structure this idea", or wants to plan what to build before handing it to Claude Code. The output is a finished prompt the user pastes into Claude Code (after /newplatform has stood up the foundation).
---

# /starterprompt — idea → Claude Code starter prompt

Walk the user (a non-coder founder) from a rough idea to ONE complete, tight Claude Code prompt that starts a new tool **on top of the Exsto substrate**. The foundation already exists; this prompt tells Claude Code what vertical to build on it — modeling concepts as kinds, operations as MCP tools, respecting the invariants, reusing the existing skills.

## How to run it

1. **Elicit, one focused question at a time.** The user is decisive and dislikes over-asking — recommend, don't interrogate. Cover, in order:
   - What is the tool, and who uses it? (the user = the tenant)
   - What are the core "things" it tracks? → these become **entity kinds**
   - What key facts about those things matter? → **attribute kinds**
   - What are the main operations users (or AI) perform? → **action kinds / MCP tools**
   - Any documents to generate, or AI drafting/reasoning the tool needs? → **AI operations**
   - What is the FIRST thin slice worth building end-to-end (the wedge)? And what is explicitly OUT of scope for v1?
2. **Translate to Exsto terms as you go.** Concepts become kinds (never new tables); operations become MCP tools over the primitives; reads are bitemporal; history is append-only. If the idea implies editing history, flag it and reframe to the substrate way. A REST/OpenAPI surface is fine — but only as an adapter over the operation core (exsto-rest-api), never a parallel CRUD layer and never an app that mutates history.
3. **Recommend the shape.** Propose the kind/tool breakdown and the thin first slice with tradeoffs; let the user adjust. Don't just collect answers — structure them.

## Output — the starter prompt

Produce ONE Claude Code prompt containing:

- A one-line description of the tool and its tenant.
- **Kinds to define** (entities/attributes/relationships) — instruct using the **exsto-add-kind** skill, as data not tables.
- **MCP tools to build** — instruct using **exsto-mcp-tool**, each mapping to an action kind.
- **AI operations** (if any) — instruct using **exsto-ai-operation**, recording reasoning traces.
- **The first thin slice** to implement end-to-end, and explicit **non-goals** for v1.
- **Standing constraints**: schema-as-data, one operation core (MCP/REST adapters, never direct substrate access), append-only, verify-on-DB, follow the `.claude/skills` and **exsto-new-vertical**.

Keep it tight — a lean prompt conserves tokens and keeps Claude Code focused.

## Style

Plain language with the user; the produced prompt is fully technical. One question per turn maximum; address ambiguity before asking. End by handing over the finished prompt, ready to paste into Claude Code in the new project.

## Verify

The handoff is a single, self-contained prompt that: names the tenant, lists concrete kinds → MCP tools → AI operations (each pointing at the right exsto-* skill), defines one end-to-end first slice with explicit non-goals, and restates the standing constraints. A reader who has never seen this conversation could paste it into Claude Code and build the wedge without further questions.
