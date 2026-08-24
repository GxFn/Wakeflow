---
name: wakeflow-governance
description: Use when working inside Wakeflow on workspace initialization / setup, AGENTS.md / skill layering, TODO / Backlog intake, Design handoff intake, idle-window scheduling, window coverage, task-package dispatch, producer/consumer sequencing, unified dispatch prompts, test handoffs, validation boundaries, or workspace script pipelines. This skill supplements AGENTS.md and must not override its hard boundaries.
---

# Wakeflow Governance

This skill holds detailed Wakeflow procedures that are too bulky to keep fully resident in `AGENTS.md`.

## Scope

For workspace initialization or setup requests, use the Wakeflow MCP capability
tool first:

- Call `wakeflow_maintain_workspace` with `action: "fresh-initialize"`,
  `mode: "preview"`, and one closed `request.selection` for a fresh workspace.
  The selection explicitly partitions `program`, `topology`, `storage`,
  `governance`, and `hosts`; repository, support-surface, and window entries use
  request-local `selectionKey` links. Wakeflow allocates the durable typed IDs.
- Preview is read-only. Review its blockers, exact `confirmedActionPlan`,
  returned `confirmedActionPlanDigest`, and `launchIntents`. Apply only after the
  user confirms the write boundary, by sending the same root and action with
  `mode: "apply"`, the exact confirmed plan, and that returned digest.
- Use `action: "reconfigure"` only for an intentional desired-model change and
  `action: "reconcile"` only to restore managed bytes/projections from current
  v3 authority. Both follow the same preview-before-apply rule. `recover`
  requires the exact plan, digest, and incomplete mutation `operationId`.
- Do not infer Design/Test from similar existing directory names such as
  `<WorkspaceName>Design`, `<ProductName>Design`, `<WorkspaceName>Test`, or
  `<ProductName>Test`. Unless the user explicitly names those as Design/Test,
  Wakeflow should create/use fresh `Design` and `Test` support surfaces.
- If a workspace contains legacy config/runtime/ledger/tool surfaces or unclear
  ownership, do not force fresh initialization or pass discovery/reset aliases.
  Report the stable blocker and use the explicit unregistered migration path
  only when the user has requested migration.
- During apply, Wakeflow synchronizes the workspace `.gitignore` so
  only `.wakeflow-active/` and `.wakeflow-local/` are ignored runtime
  directories. Do not add product repositories, Design/Test, ledgers,
  `.DS_Store`, or other user workspace noise as Wakeflow-generated gitignore
  entries.
- Window removal is a reconfigure decision expressed in the complete desired v3
  topology; there is no `excludeWindows` or semantic window-name mutation alias.
- Pass `language: "zh"` when the user is working in Chinese, `language: "en"`
  when the user asks for English, and leave `language: "auto"` only when there
  is no clear preference. The returned `displayTitle` is the canonical Codex
  thread title; it keeps the window/repository name first.
- After the confirmed apply succeeds, use the `launchIntents` retained from the
  matching preview and the Codex host
  `create_thread` tool to create real controller / Design / Test / product
  windows. Call `wakeflow_register_window` once for each returned real
  `create_thread.threadId`, then call `set_thread_title` with `displayTitle` as
  the final title reset. Registration records routing identity only; Wakeflow
  does not classify host-thread initialization replies as ready/pending/failed.
  The tool writes one typed host-local binding and refreshes the redacted
  window-runtime projection without exposing the raw handle.
- To rebuild selected windows, call `wakeflow_replace_windows` with
  `operation: "replace"` and its exact typed request. Create threads only for
  the returned replacement launch intents, then register each final real
  thread id and perform the final title reset. Do not rewrite unrelated
  bindings or store role, cwd, or title as identity authority.
- Do not use `wakeflow_maintain_workspace` fresh initialization as a refresh path for window
  context bloat. Replacement returns only the authorized host-neutral intent;
  create only that window and register its final real thread id through
  `wakeflow_register_window`.
- Do not replace that tool with a hand-written inspection checklist when the MCP
  server is available.
- If Wakeflow MCP tools are unavailable, say that the MCP server is unavailable
  and stop for plugin reload/reinstall instead of pretending initialization can
  proceed through docs alone.
- Wakeflow MCP initialization does not place real thread ids in tracked docs or
  prompts. The typed binding is the host-local identity authority;
  `window-runtime` is a redacted projection, not a second authority.

Use this skill after reading:

1. `AGENTS.md`
2. `.wakeflow-active/index.md`
3. `.wakeflow-active/current/workspace-current-status.md`
4. the current controller state root and its developer progress document when
   the active demand has an execution surface

This skill may guide workspace documentation, TODO intake, dispatch planning, and validation. It must not authorize product implementation in Wakeflow, direct real-project testing, or bypass the current mainline.

## References

- Read [references/stage-route-map.md](references/stage-route-map.md) FIRST when unsure which window acts next, which stage owns a missing input, whether Design's exit gate is complete, or which capability belongs to which stage — the S0→S6 route, per-stage gates, capability classification, and the three escalation lanes live there.
- Read [references/todo-backlog.md](references/todo-backlog.md) when creating, adjusting, rolling, accepting, canceling, prioritizing, or dispatching TODO / Backlog items.
- Read [references/window-dispatch.md](references/window-dispatch.md) when preparing a wave, task package, window coverage table, producer / consumer sequence, unified dispatch prompt, or send/no-send decision.
- Read [references/testing-validation.md](references/testing-validation.md) when deciding whether total control should self-test, whether `Test` or another configured test window is justified, how to write a test handoff, how to interpret test evidence, or which validation command applies.
- Read [references/script-pipeline.md](references/script-pipeline.md) only when
  maintaining Wakeflow source/runtime scripts, auditing backend script
  contracts, or changing script tests / documentation. Installed workspace
  validation and next-work scans should use Wakeflow MCP tools directly.
- Read [references/wakeflow-ledgers.md](references/wakeflow-ledgers.md) when creating, moving, syncing, archiving, or validating Wakeflow workspace documents, status mirrors, indexes, templates, the global TODO board, test exchange entries, workspace skill assets, or `AGENTS.md` map / skill-pointer layering.
- Read [references/wakeflow-architecture.md](references/wakeflow-architecture.md) when restructuring `AGENTS.md`, skills, references, templates, scripts, current plans, or automation surfaces as one consistent Wakeflow system.
- Read [references/agents-rule-map.md](references/agents-rule-map.md) when auditing, merging, downshifting, or rewriting root `AGENTS.md` rules.
- Read [references/wakeflow-delivery.md](references/wakeflow-delivery.md) when total control starts, stops, designs, debugs, or validates the new Wakeflow Delivery Loop packet / envelope / result workflow.
- Read [references/direct-thread-window-config.md](references/direct-thread-window-config.md) when designing or implementing typed host-local bindings, redacted window-runtime projections, delivery-run evidence, coordination leases, or legacy registry migration.
- Read [references/phased-migration.md](references/phased-migration.md) when a task moves, extracts, deletes, or rehomes behavior across configured product repositories.
- Read [references/skill-writing-style.md](references/skill-writing-style.md) when authoring or editing any Wakeflow skill, reference, template, or standard-process doc — the writing-style conventions (Iron Law, rationalization tables, tables-over-prose, description=WHEN) and reusable clauses.
- Read [references/design-test-skill-realization-source-map.md](references/design-test-skill-realization-source-map.md) when authoring, reviewing, or migrating the shared Design/Test plugin Skills — the method-source mapping, role boundaries, and canonical source/sync acceptance contract live there.

## Non-Negotiables

- `AGENTS.md` remains the hard boundary source. If this skill and `AGENTS.md` differ, follow the stricter rule.
- `Design` signal / handoff is input to total control, not an execution plan.
- Total control self-tests by default; `Test` or another configured test window is only for real project verification, cold-start, repro, smoke, regression, runtime / Dashboard observation, and cross-repo environment evidence.
- A TODO or task package must serve the user goal and current completion definition; it must not become a reason to create empty work.
- Dispatch prompts must stay lightweight and layered: repeat the current objective, a bounded completion/boundary summary, required reading order, required Skills, current-window / target-repository identity, and result-return pointer. The existing JSON task package owns the complete task context; anchored requirement documents own background and original intent; Skills own execution procedure. Full validation commands, sub-agent guidance, and automation semantics stay out of the prompt.
- Workspace owns the only control state machine. PCV node state, scorecard readiness, and observability gaps are recorded inside Workspace plans as canonical Workspace status plus PCV evidence labels, not as a second state authority.
- Hard anti-failure rules belong in `AGENTS.md`, not only in this skill. This skill may add command details and templates, but it must not hide or weaken those rules.
- Before changing `AGENTS.md` or moving content into references, prepare an old-rule migration check: keep / downshift / rewrite / discard, and state which `AGENTS.md` section or reference now owns each rule.
- `designIntent` is one optional sentence of implementation intent on a task package ("roughly how"), authored by Design at delivery/handoff when useful. It is advisory input for the controller's own alignment check at dispatch and review — never an acceptance standard, a score, or a gate.
- **One proportional demand authority before any TaskPackage creation**:
  Design delivery is the default for substantial new product behavior, while
  total control may directly create bounded or already-documented work when it
  can cite the same inputs. If the demand will need a TaskPackage, both paths
  include one `demand-authority.json` in the initial
  `wakeflow_create_demand` publication; public v3 cannot add it later. A
  requirement needs Original Plan, Requirement Design, code facts, landing
  plan, non-goals, answered user decisions, and Test decision; a bug needs
  reproduction/scope/non-goals/Test decision; a supplement needs Requirement
  Design/delta/user confirmation/Test decision; research needs
  question/boundaries and never dispatches implementation. `Auto Claim`
  changes claim timing only. A missing input is S1 work — route the gap to
  Design/user instead of inventing an anchor (see
  [references/stage-route-map.md](references/stage-route-map.md)).
- **Test only tests**: the controller decides which confirmed environment a test card uses (from the Design-stage spec), the user confirms it at Design, Test only executes. A card with a missing/ambiguous environment block is a blocker back to the controller — Test never chooses environments, invents config values, or fixes product code. A missing input at any stage is never guessed: requirement gap → Design; product decision → user; fact gap → bounded read-only investigation.
- **Test follows controller validation**: total control owns functional correctness and completion. Every active/open non-Test target must be accepted before the Test package is added or dispatched; canonical `superseded` replacement history is excluded from that open set. The card's existing `controllerSelfChecks` states what the controller verified. Test-only reproduction/environment diagnostics remain valid. Test explores only the approved real-environment boundary for hidden bugs; its pass cannot complete unfinished controller validation and its failure cannot redefine the requirement.
- **Test does not define the target**: every Test card freezes the demand goal from `demand.json`, the requirement-stage approved Test plan, allowed Test skills, setup policy, and attempt bound. The controller re-checks those same anchors at dispatch and review. Test may elaborate mapped commands, but an unmapped goal/gate/method (including PCV when not explicitly listed) is a blocked change request, never an executable Test invention.
- **Mainline first; Pod only by explicit user authority**: ordinary and Auto
  Claim work enters only an idle, healthy mainline. A busy mainline waits; an
  unavailable mainline fails before demand/TODO mutation with
  `mainline-unavailable` and is repaired. Only an auditable user authorization
  may select a Pod, and Wakeflow applies no numeric Pod limit.
- **A Pod is a complete independent host fleet**: independent
  `Controller__<pod>`, `Design__<pod>`, `Test__<pod>`, and one product session
  per repository. `wakeflow_pod_open operation=launch-preview/launch-apply`
  records host-neutral first-materialization intents under the strict
  clean-main/expected-HEAD gate. Existing materialization is inspected with
  `operation=inspect-materialization`; it reports current HEAD/dirty only as
  observations and never creates or rebinds a thread/worktree. Codex
  materialization is journaled by launch correlation with
  `wakeflow_pod_record operation=record-materialization`; a temporary `clientThreadId` is
  search/recovery evidence only, stored as a digest and never registered.
  Codex creates product threads with the exact saved project and
  `environment.type=worktree`; Wakeflow records the final handle locally and
  verifies cwd/Git receipts with `wakeflow_pod_bind`.
- **Pod Design and Test have machine gates**:
  `wakeflow_pod_plan operation=design-request` freezes the exact request before
  `wakeflow_pod_record operation=design-handoff`. The current implementation persists exactly one Pod
  Design request/handoff generation; its sole request may be `initial-design`,
  `supplement`, or `redesign`. A different second generation stops as an
  unsupported capability instead of overwriting that request or using mainline Design.
  Before Test dispatch,
  `wakeflow_pod_plan operation=test-access-plan` plus
  `wakeflow_pod_record operation=test-access-receipt` must prove validated
  `direct-multi-root` coverage of every active product binding. Unsupported
  access stays blocked; never fall back to a main checkout, product window, or
  unverified per-repository executor. `wakeflow_pod_plan operation=close-intent`
  creates the logical host-close intent. Feed the exact Codex archive/handoff
  result only to `wakeflow_pod_record operation=close-observe`; it remains
  `manual-host-gate` and cannot authorize `close-receipt`, logical binding
  close, archive, or prune. Codex owns physical worktree lifecycle, and task
  archival is not machine proof of irreversible revocation.

## Minimal Workflow

1. Classify whether the task is TODO intake, TODO rolling, wave dispatch, task-package planning, test / validation judgment, script pipeline work, or prompt generation.
2. Load only the matching reference file.
3. Use the owning Wakeflow tool for demand state/events/artifacts, TODO CAS,
   TestCard intake, evidence, and projections. Never hand-edit the state root,
   generated `developer-progress.md`, `global-todo-board.md`, or
   `test-cards/*.json`; `test-exchange.md` is legacy migration input, not a v3
   projection.
4. Run the workspace validation commands required by `AGENTS.md` and the active state root / developer progress document.
