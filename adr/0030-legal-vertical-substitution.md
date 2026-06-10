# ADR 0030: Substituting the legal vertical for the upstream reference app

## Status
Accepted

## Context
The upstream Layer 0-2 definition of done specifies a reference app: a personal task and notes app used as dogfood to exercise the substrate. In this fork, the founder has explicitly requested the Layer 3 legal vertical wedge for Pacheco Law Firm instead.

The legal wedge is a real customer-facing vertical with a concrete workflow (operating agreement intake, transcript-driven drafting, attorney review). It exercises the substrate through a real business scenario, not just a generic reference app.

## Decision
For this fork, the legal vertical wedge substitutes for the upstream-specified reference app. The wedge is the dogfood surface used to validate the substrate and the MCP/worker/runtime integration.

## Consequences
### What this makes easier
- The fork builds a real customer vertical instead of a generic demo app.
- The legal wedge surfaces real operational data, document workflows, and AI drafting, which are stronger forcing functions for the substrate.
- Upstream can continue to use the reference app path if desired; this fork remains a customer-specific extension built on the same substrate.

### What this makes harder
- The fork deviates from the upstream exact definition of done, so the founder must review this substitution intentionally.
- The legal vertical introduces more domain-specific requirements early, which increases scope. This is mitigated by hardcoding the wedge and deferring configurability.

## Alternatives considered
- Build the reference task and notes app as specified upstream, then add the legal wedge later. Rejected because the founder explicitly wants the legal wedge and because it would delay customer-facing progress on the real firm.
- Build both the reference app and the legal wedge in parallel. Rejected as too much scope for one session.

## Accepted
Yes. The legal wedge substitutes for the upstream reference app in this fork.
