# Pattern: Adding a Reference App Surface

## When to use this pattern

When you want a new UI screen, panel, or interactive element in the reference app (`apps/reference`) that exercises substrate capabilities. Examples:

- A list view for a new entity kind
- A detail page that shows attributes, judgments, and the action history for an entity
- A dashboard tile rendering aggregated data
- A workflow advancement panel showing pending approvals
- A chat surface that lets users feed back on AI responses

The reference app is how the substrate gets exercised in real use. Every substrate capability that matters has a surface here, even when no customer is engaged yet. This is the dogfood.

## The shape

A reference app surface is:

1. A page or panel in `apps/reference/app/` (Next.js app router) or `apps/reference/components/`
2. A client-side caller that hits MCP tools through the reference app's MCP client wrapper
3. A presentation layer that respects substrate metadata (provenance, confidence, knowability, polarity)

The reference app does NOT call substrate functions directly. It does NOT bypass MCP. Every substrate operation goes through an MCP tool (ADR 0024).

## Working example: an investment thesis list page

### Step 1: Confirm the MCP tools exist

For listing theses, the existing tools work:

- `entity.list_by_kind` for the list
- `entity.get` for a detail page

If a bespoke tool is wanted (e.g., `thesis.search` with sector filters), see `mcp-tool.md`.

### Step 2: Build the page

```typescript
// apps/reference/app/theses/page.tsx

import { mcpClient } from '@/lib/mcp-client';
import { ThesisList } from '@/components/thesis-list';

export default async function ThesesPage() {
  const result = await mcpClient.callTool('entity.list_by_kind', {
    entityKindName: 'investment_thesis',
    limit: 50,
  });

  return (
    <div>
      <h1>Investment Theses</h1>
      <ThesisList theses={result.entities} />
    </div>
  );
}
```

### Step 3: Render with substrate metadata

```typescript
// apps/reference/components/thesis-list.tsx

import { ConfidenceBadge, ProvenanceTag, KnowabilityIcon } from '@/components/substrate';

export function ThesisList({ theses }) {
  return (
    <ul>
      {theses.map(thesis => (
        <li key={thesis.id}>
          <h3>{thesis.attributes.title.value}</h3>
          <div className="meta">
            <ProvenanceTag source={thesis.attributes.title.source} />
            <ConfidenceBadge value={thesis.attributes.title.confidence} />
            {thesis.attributes.sector && (
              <KnowabilityIcon state={thesis.attributes.sector.knowability_state} />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
```

The substrate metadata is rendered, not hidden. A title sourced from an AI agent looks different from a title typed by a human. A sector marked `never_observed` looks different from one marked `observed_null`.

### Step 4: Add an action surface (if write-capable)

```typescript
// apps/reference/components/thesis-edit.tsx

import { mcpClient } from '@/lib/mcp-client';

export function ThesisEditField({ thesisId, attributeName, currentValue }) {
  async function save(newValue: string) {
    await mcpClient.callTool('attribute.set', {
      entityId: thesisId,
      attributeKindName: attributeName,
      value: newValue,
      confidence: 1.0,            // human edit, full confidence
      knowabilityState: 'observed',
      timePrecision: 'second',
      intentKind: 'adjustment',   // user is making a real change
    });
    // refresh or revalidate
  }

  return (
    <input
      defaultValue={currentValue}
      onBlur={(e) => save(e.target.value)}
    />
  );
}
```

The edit goes through `attribute.set` (an MCP tool), which calls the action handler, which records the action in the audit log. There is no shortcut.

### Step 5: AI feedback flow on chat surfaces

For surfaces where Claude responds and the user can react ("good," "wrong," "wrong because"), the feedback uses standard primitives:

```typescript
// apps/reference/components/chat-feedback.tsx

import { mcpClient } from '@/lib/mcp-client';

export function ChatFeedback({ entityId, assistantActionId }) {
  async function markGood() {
    // A judgment that the assistant's answer was good (about the entity in question).
    // 'response_quality' is an illustrative judgment kind the app would define (see exsto-add-kind).
    await mcpClient.callTool('judgment.record', {
      subjectEntityId: entityId,
      judgmentKindName: 'response_quality',
      value: 'good',
      confidence: 1.0,
    });
  }

  async function markWrong(reason: string) {
    // A contestation against the assistant's action, via the generic action surface.
    await mcpClient.callTool('substrate.action.submit', {
      actionKindName: 'contestation.open',
      intentKind: 'reflection',
      payload: { contested_action_id: assistantActionId, basis: reason },
    });
  }

  return (
    <div className="feedback-row">
      <button onClick={markGood}>Good</button>
      <button onClick={() => markWrong(prompt('What was wrong?'))}>Wrong</button>
    </div>
  );
}
```

Good marks become judgment rows. "Wrong" marks become contestation rows. Both feed the AI effectiveness queries (ADR 0028). No new primitives required.

## Customization points

When adding a new surface:

1. **Identify the read tools.** Existing or new MCP tools for the data you need.
2. **Identify the write tools.** Existing or new MCP tools for any actions the surface enables.
3. **Build the page or component.** Following Next.js conventions in `apps/reference/`.
4. **Render substrate metadata.** Provenance, confidence, knowability are first-class display elements, not hidden.
5. **Wire the action paths.** Every write goes through MCP, never around it.

## Common mistakes

**Direct substrate calls.** Importing `setAttribute` from `@exsto/primitives` and calling it from a React component bypasses MCP. The substrate functions are not exposed to the reference app; the only path is through MCP tools.

**Hiding metadata.** Rendering a value as plain text without showing where it came from defeats the substrate's value. Even simple displays should have a "source" affordance somewhere.

**Custom REST endpoints.** Adding a Next.js API route that does substrate work is a tempting shortcut. Don't. The MCP server is the canonical interface; the reference app calls it.

**Skipping the AI feedback flow on chat surfaces.** If a surface includes AI responses, it includes a feedback mechanism. The feedback is just judgments and contestations through MCP tools.

**Treating the reference app as throwaway.** The reference app is the dogfood. It exercises the substrate under real use, surfaces bugs, and demonstrates patterns. Treat its quality seriously.

## Related ADRs and patterns

- ADR 0024: MCP as primary interface
- ADR 0028: AI effectiveness as a derived property
- Pattern: `mcp-tool.md` (the tools the reference app calls)
- Pattern: `action-handler.md` (the writes underneath the MCP tools)
- Pattern: `ai-action-handler.md` (when the surface generates AI actions)
