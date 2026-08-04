---
name: wakeflow-governance
description: Use when working inside Wakeflow on workspace initialization / setup, AGENTS.md / skill layering, TODO / Backlog intake, Design handoff intake, idle-window scheduling, window coverage, task-package dispatch, producer/consumer sequencing, unified dispatch prompts, test handoffs, validation boundaries, or workspace script pipelines. This skill supplements AGENTS.md and must not override its hard boundaries.
---

# Wakeflow Governance

This skill holds detailed Wakeflow procedures that are too bulky to keep fully resident in `AGENTS.md`.

## Scope

For workspace initialization or setup requests, use the Wakeflow MCP capability
tool first:

- Call `wakeflow_initialize_workspace` with `apply: false` for preview/dry-run
  requests.
- Wakeflow MCP returns directory facts and an `agentSelectionProtocol`; it does
  not classify a workspace as clean or messy. Codex must judge from the visible
  directory facts and user context.
- If Codex judges the workspace is clean, call `wakeflow_initialize_workspace`
  again with explicit `repositories` mappings for the intended work windows,
  plus the selected Design/Test mode. Use `apply: true` only when the user has
  allowed writing.
- Do not infer Design/Test from similar existing directory names such as
  `<WorkspaceName>Design`, `<ProductName>Design`, `<WorkspaceName>Test`, or
  `<ProductName>Test`. Unless the user explicitly names those as Design/Test,
  Wakeflow should create/use fresh `Design` and `Test` support surfaces.
- If Codex judges the workspace is messy, contains history/runtime/ledger/tool
  directories, or has unclear window ownership, stop and ask the user which
  windows to manage. Do not call `useDiscovered` in that case.
- Call `wakeflow_initialize_workspace` with `apply: true` only after the user
  confirms the preview and write boundary. In an already initialized workspace,
  this is allowed only when the user explicitly asks for reset initialization;
  pass `resetInitialization: true`, explicit `repositories`, and the selected
  Design/Test mode, and do not pass `useDiscovered`.
- During apply, Wakeflow synchronizes the workspace `.gitignore` so
  only `.wakeflow-active/` and `.wakeflow-local/` are ignored runtime
  directories. Do not add product repositories, Design/Test, ledgers,
  `.DS_Store`, or other user workspace noise as Wakeflow-generated gitignore
  entries.
- If the user removes discovered windows during setup, pass them as
  `excludeWindows` so the config, AGENTS updates, launch plan, and local window
  runtime agree.
- Pass `language: "zh"` when the user is working in Chinese, `language: "en"`
  when the user asks for English, and leave `language: "auto"` only when there
  is no clear preference. The returned `displayTitle` is the canonical Codex
  thread title; it keeps the window/repository name first.
- After apply, read the returned `windowLaunchPlan`, use the Codex host
  `create_thread` tool to create real controller / Design / Test / product
  windows. For each returned thread, make exactly one bounded `wait_threads`
  observation and never resend automatically. Set
  `localRegistration.callTemplate.entrySyncStatus` to `ready` only when the
  expected entry-sync reply is visible, leave `pending` when no reply is
  visible, or use `failed` for an explicit host/identity error; then call
  `wakeflow_register_window`. A later manual recovery may observe once and
  re-register the same handle as `ready`. Finally call `set_thread_title` with
  `displayTitle`; this post-reply reset repairs Codex auto-title drift. Only
  `ready` windows are dispatchable. The tool writes the local registry and
  derived `window-config` without exposing the id.
- To rebuild selected windows, use `wakeflow_replace_windows` (single `window`
  arg for one heavy or stale responsibility window, `windows[]` for a selected
  group). Create threads only for the returned replacement launch entries, then
  apply the same one-observation/status-registration/final-title-reset sequence
  to each new real thread id. Do not rewrite
  unrelated window registrations or store window role / cwd / title metadata in
  the registry.
- Do not use `wakeflow_initialize_workspace` as a refresh path for window
  context bloat. Replacement tools return only replacement launch entries plus
  `localRegistration.callTemplate`; create only those host windows and register
  their real thread ids through `wakeflow_register_window`.
- Do not replace that tool with a hand-written inspection checklist when the MCP
  server is available.
- If Wakeflow MCP tools are unavailable, say that the MCP server is unavailable
  and stop for plugin reload/reinstall instead of pretending initialization can
  proceed through docs alone.
- Wakeflow MCP initialization does not place real thread ids in tracked docs or
  prompts. Thread registration remains local runtime work outside tracked docs;
  `window-config` is a derived runtime view, not a second storage location.

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
- Read [references/direct-thread-window-config.md](references/direct-thread-window-config.md) when designing or implementing child-window direct thread dispatch config, thread registry files, delivery-run evidence, keep-live state, or v1/v2 automation runtime migration.
- Read [references/phased-migration.md](references/phased-migration.md) when a task moves, extracts, deletes, or rehomes behavior across configured product repositories.
- Read [references/skill-writing-style.md](references/skill-writing-style.md) when authoring or editing any Wakeflow skill, reference, template, or standard-process doc — the writing-style conventions (Iron Law, rationalization tables, tables-over-prose, description=WHEN) and reusable clauses.

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
- **One proportional demand authority before ANY implementation dispatch**: Design delivery is the default for substantial new product behavior, while total control may directly create bounded or already-documented work when it can cite the same inputs. Both paths freeze one `demand-authority.json`: a requirement needs Original Plan, Requirement Design, code facts, landing plan, non-goals, answered user decisions, and Test decision; a bug needs reproduction/scope/non-goals/Test decision; a supplement needs Requirement Design/delta/user confirmation/Test decision; research needs question/boundaries and never dispatches implementation. `Auto Claim` changes claim timing only. A missing input is S1 work — route the gap to Design/user instead of inventing an anchor (see [references/stage-route-map.md](references/stage-route-map.md)).
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
  per repository. `wakeflow_pod_open mode=create` plans host-neutral first
  materialization under the strict clean-main/expected-HEAD gate.
  `wakeflow_pod_open mode=resume` is read-only recovery for already-bound
  windows: it verifies the immutable registry/binding/cwd/common-dir chain,
  reports current HEAD/dirty only as observations, and never creates or rebinds
  a thread/worktree. Codex materialization is journaled by launch correlation with
  `wakeflow_pod_record event=materialization`; a temporary `clientThreadId` is
  search/recovery evidence only, stored as a digest and never registered.
  Codex creates product threads with the exact saved project and
  `environment.type=worktree`; Wakeflow records the final handle locally and
  verifies cwd/Git receipts with `wakeflow_pod_bind`.
- **Pod Design and Test have machine gates**:
  `wakeflow_pod_plan action=design-request` freezes the exact request before
  `wakeflow_pod_record event=design-handoff`. The current implementation persists exactly one Pod
  Design request/handoff generation; its sole request may be `initial-design`,
  `supplement`, or `redesign`. A different second generation stops as an
  unsupported capability instead of overwriting that request or using mainline Design.
  Before Test dispatch,
  `wakeflow_pod_plan action=test-access` plus
  `wakeflow_pod_record event=test-access` must prove validated
  `direct-multi-root` coverage of every active product binding. Unsupported
  access stays blocked; never fall back to a main checkout, product window, or
  unverified per-repository executor. `wakeflow_pod_plan action=close` creates a
  logical host-close plan; record each confirmed host outcome with
  `wakeflow_pod_record event=close-receipt`. Codex owns physical worktree lifecycle.

## Minimal Workflow

1. Classify whether the task is TODO intake, TODO rolling, wave dispatch, task-package planning, test / validation judgment, script pipeline work, or prompt generation.
2. Load only the matching reference file.
3. Update the controller state root, developer progress append-only sections, `global-todo-board`, state-root `test-cards/*.json`, or `test-exchange` projection only when that is the correct ledger.
4. Run the workspace validation commands required by `AGENTS.md` and the active state root / developer progress document.
