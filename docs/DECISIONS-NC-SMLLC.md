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

## Task primitive (groundwork)

7. **`task` is a first-class entity** (migration 0084): attributes `task_status`
   (todo|in_progress|blocked|done), `task_assignee`, `task_billable`, `task_rate`
   (money); the existing `due_date` is reused, not duplicated; relationship `task_of`
   (task→matter); actions `legal.task.create/update/complete`. Definitions only — no
   UI, no lifecycle engine. Per-task rate override is data shape only (resolution
   deferred to Contract K / S4).

   **⚠ Cross-session collision (for the manager to reconcile):** a parallel session
   registered an overlapping subset of task kinds (`task`, `task_status`, `task_of`,
   `legal.task.create/update`) in tenant zero ~2 minutes earlier, using the `0900`
   id-block (ours uses `0800`). Both are additive and active; no task *entities*
   exist yet, so nothing is functionally broken. Before tasks ship, the two
   definitions must converge to one canonical set (retire the redundant rows through
   the proper versioning path — never a raw delete).

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

10. Numbered **0084–0086**, not 0082. The prod ledger frontier was 0081, but
    origin/main already carried a merged-but-unapplied `0082_document_upload` (0700
    id-block) and a held `0083_skill_library`. Numbers were taken above the
    origin/main filesystem max AND the prod ledger max to avoid the parallel-session
    collision class. Applied surgically (only 0084–0086, with the runner's exact
    LF-checksum) so the pending 0082 and held 0083 stay untouched and a later
    `pnpm migrate:vertical` remains idempotent.
