# Decision record — NC Single-Member LLC Formation go-live

The firm's first real service. Standalone foundational task (not part of the Beta
Pilot Hardening batch). Applied to tenant zero (Pacheco Law) on the live substrate,
attributed to the firm owner (Juan Carlos). Every claim below is backed by a SQL
receipt run against prod (see the PR description).

## Architecture

1. **A "service" is a `workflow_definition` row, not an entity.** Its questionnaire
   (`transitions.intake_schema`), its document template
   (`transitions.document_templates.templates.<kind>`), route, generation mode and
   fee (`transitions.cost`) all live as config-as-data inside that one row. The
   document generator reads ONLY that config. This is the authoritative
   binding/generation mechanism the existing 113 drafts used — replicated for NC,
   not reinvented.

2. **A matter is an instance of a service via the `service_key` attribute** (the
   workflow_definition.kind_name). Generation merges the service's template ⨉ the
   matter's questionnaire answers (deterministic `renderTemplate`). The workflow
   *execution* engine (workflow_instance / trigger_definition) stays dormant — 106
   live matters run with 0 instances; nothing in core requires one. Left off.

3. **The NC service is bookable and self-contained:** route=`auto`,
   generation_mode=`template_merge` (no AI; the 24 template variables fill
   deterministically from intake — confirmed render: 24 filled / 0 missing). The
   activation completeness gate requires an auto-route document to carry a drafting
   prompt with the required slots even under template_merge, so a slot-valid prompt
   is authored (present for the gate / future AI opt-in; unused by the merge path).

4. **Questionnaire + template exist in two complementary forms.** The functional
   copy lives in the service config (what generation reads). One standalone
   `questionnaire_template` entity and one standalone `template` entity are also
   created as the firm's canonical library records (the clean-slate count). All
   three share the identical 24 field ids (symmetric difference = 0).

## Billing

5. **Fixed fee reuses the existing mechanism.** A service's fixed fee already lives
   in `transitions.cost {type:'fixed'}` (migrations 0071/0080); the NC service is
   marked `transitions.billing_mode = 'fixed'`. The fee AMOUNT is intentionally left
   unset for the firm to enter — no fabricated price.

6. **`service_billing_mode` (enum fixed|hourly|hybrid) registered as groundwork**
   (migration 0085), unscoped (a service is not an entity). Read by nothing yet.
   Rate-resolution functions (Contract K: getServiceRate/getClientRate/
   getFirmDefaultRate) are out of scope — owned by S4. Existing client-level billing
   attributes (`client_billing_type`, `client_billable_rate`,
   `firm_default_hourly_rate`) are reused, not re-created.

## Task primitive — deferred to the parallel session (collision resolved)

7. **This PR ships NO task primitive.** A parallel session (commit `78e7b80`,
   "feat(tasks): migration 0084") independently registered a `task` primitive in
   tenant zero ~2 minutes before this work, under a different id-block (`0900` vs
   our `0800`) but the same `kind_name`s — a genuine collision. Their model is the
   stronger, billing-aware one (`task_billing_mode` none|hours|fixed, `task_hours`,
   `task_fee_amount`, `task_invoice_id` that locks on invoicing, `task_assignee_actor_id`
   as a real actor link, plus `task_title`/`task_due_date`/`task_status`), and it
   subsumes everything our draft had (`task_billable`/`task_rate`/`task_assignee`-text/
   `legal.task.complete`). So per the founder's call, the duplicate was removed:
   our `0800` task kinds were deleted from prod (zero dependents — no task entities
   existed), our `0084` ledger row was deleted to free the version number for their
   canonical migration, and `0084_task_primitive.sql` was dropped from this PR. The
   other session's task primitive stands as the single canonical one. (This PR's
   migrations therefore start at 0085; the 0084 slot belongs to the tasks PR.)

## Engagement status (groundwork)

8. **`engagement_status` (enum prospective|non_retained|retained|former)** registered
   (migration 0086), mirroring `company_engagement_status`, unscoped so it serves
   both `client` and `matter` (attribute writes resolve by name; on_entity_kind_id is
   descriptive). Absence = non-retained. Effective-dated via valid_from/valid_to.
   Read by nothing — pure groundwork. Trust/IOLTA/retainer accounting is deferred.

## Platform limitations honored (not contract violations)

9. The intake field vocabulary (`KNOWN_FIELD_TYPES`) has **no `email` type and no
   show-if conditional support.** So `notice_email` is a `text` field, and the two
   "conditional" fields (`member_entity_state`, `manager_name`) are optional fields
   with guiding labels (matching the questionnaire's own "leave blank if…"
   instruction). Dates → `date`, addresses → `address_autocomplete`, selects →
   `select`. The 24-variable contract itself is unaffected (24/24 bidirectional,
   verified). A real email type and show-if logic are future platform enhancements.

## Migration numbering

10. This PR's migrations are **0085 (`service_billing_mode`) and 0086
    (`engagement_status`)** — not 0082. The prod ledger frontier was 0081, but
    origin/main already carried a merged-but-unapplied `0082_document_upload` (0700
    id-block) and a held `0083_skill_library`; the parallel tasks PR owns `0084`.
    Numbers were taken above the origin/main filesystem max AND the prod ledger max
    to avoid the parallel-session collision class, applied surgically (with the
    runner's exact LF-checksum) so the pending 0082/0083/0084 stay untouched and a
    later `pnpm migrate:vertical` remains idempotent. (0085/0086 leave a 0084 gap;
    the runner has no contiguity requirement, and the tasks PR fills it.)
