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
  windows, immediately call the Codex host `set_thread_title` tool for every
  newly created thread using that entry's `displayTitle`, then call
  `wakeflow_register_window` once per returned `create_thread.threadId` using
  that entry's `localRegistration.callTemplate`. The tool writes the local
  registry and refreshes derived `window-config` without exposing the id. Do
  this title reset at the end of initialization instead of manually renaming ad
  hoc windows later.
- To rebuild selected windows, use `wakeflow_replace_windows` (single `window`
  arg for one heavy or stale responsibility window, `windows[]` for a selected
  group). Create threads only for the returned replacement launch entries, then
  call `wakeflow_register_window` with each new real thread id. Do not rewrite
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
- Dispatch prompts must stay lightweight: keep the `AGENTS.md` read requirement, current-window / target-repository positioning declaration, task identity, and evidence return pointer; detailed scope, exclusions, validation commands, sub-agent guidance, and automation command semantics belong in the controller state root, task package, developer progress document, test exchange, or Wakeflow Delivery Loop skills.
- Workspace owns the only control state machine. PCV node state, scorecard readiness, and observability gaps are recorded inside Workspace plans as canonical Workspace status plus PCV evidence labels, not as a second state authority.
- Hard anti-failure rules belong in `AGENTS.md`, not only in this skill. This skill may add command details and templates, but it must not hide or weaken those rules.
- Before changing `AGENTS.md` or moving content into references, prepare an old-rule migration check: keep / downshift / rewrite / discard, and state which `AGENTS.md` section or reference now owns each rule.
- `designIntent` is one optional sentence of implementation intent on a task package ("roughly how"), authored by Design at delivery/handoff when useful. It is advisory input for the controller's own alignment check at dispatch and review — never an acceptance standard, a score, or a gate.
- **Design exit gate before ANY implementation dispatch, at the demand's scale** (full five items for a requirement; lighter for bug/supplement; research never dispatches implementation): Original Plan; Requirement Design with code-fact reconciliation (real current behavior, verified against source), landing plan (per-window breakdown + designIntent), and non-goals; a user-confirmation ledger with every open product question ANSWERED; and the Test decision (needed or not — if yes, a Test Environment Spec confirmed with the user at Design time). A goal arriving without these is S1 work, not execution work: route it to Design instead of "reviewing code and just starting" (see [references/stage-route-map.md](references/stage-route-map.md)).
- **Test only tests**: the controller decides which confirmed environment a test card uses (from the Design-stage spec), the user confirms it at Design, Test only executes. A card with a missing/ambiguous environment block is a blocker back to the controller — Test never chooses environments, invents config values, or fixes product code. A missing input at any stage is never guessed: requirement gap → Design; product decision → user; fact gap → bounded read-only investigation.
- **Test does not define the target**: every Test card freezes the demand goal from `demand.json`, the requirement-stage approved Test plan, allowed Test skills, setup policy, and attempt bound. The controller re-checks those same anchors at dispatch and review. Test may elaborate mapped commands, but an unmapped goal/gate/method (including PCV when not explicitly listed) is a blocked change request, never an executable Test invention.
- **Multiple demands = demand pods**: up to `maxActiveDemands` (default 2) demands run side by side, each with its OWN controller (stamped into the state root at create so returns route home), OWN Test, and one isolation worktree window per repo — a per-demand thread set opened via `wakeflow_pod_open` (each thread's cwd IS its worktree) and closed after completion via `wakeflow_pod_close` (close order: complete-demand -> pod close -> archive). Pods are mutually unaware. Parallelism exists ONLY at the demand level — never inside a demand (each repo = one window = ONE combined task package), and the WHOLE pod shares its demand's ONE worktree set: every window, Test included, works and verifies inside those worktrees, never on a main checkout. Branch merge-back is human-reviewed and decentralized (pending-merges ledger); claiming past capacity fails closed.

## Minimal Workflow

1. Classify whether the task is TODO intake, TODO rolling, wave dispatch, task-package planning, test / validation judgment, script pipeline work, or prompt generation.
2. Load only the matching reference file.
3. Update the controller state root, developer progress append-only sections, `global-todo-board`, state-root `test-cards/*.json`, or `test-exchange` projection only when that is the correct ledger.
4. Run the workspace validation commands required by `AGENTS.md` and the active state root / developer progress document.
