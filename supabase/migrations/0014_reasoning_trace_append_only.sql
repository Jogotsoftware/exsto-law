-- =============================================================================
-- Migration 0014: Make reasoning_trace append-only explicit
-- reasoning_trace (0004) had only SELECT/INSERT policies, so UPDATE/DELETE were
-- already default-denied under RLS for non-owner roles. Add explicit deny
-- policies so the append-only guarantee (invariant 14, CLAUDE.md hard rule 3) is
-- uniform and greppable across every append-only table.
-- =============================================================================

CREATE POLICY rt_no_update ON reasoning_trace FOR UPDATE USING (false);
CREATE POLICY rt_no_delete ON reasoning_trace FOR DELETE USING (false);
