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
- Call `wakeflow_initialize_workspace` with `apply: true` only after the user
  confirms the preview and write boundary.
- If the user removes discovered windows during setup, pass them as
  `excludeWindows` so the config, AGENTS updates, launch plan, and local window
  runtime agree.
- Pass `language: "zh"` when the user is working in Chinese, `language: "en"`
  when the user asks for English, and leave `language: "auto"` only when there
  is no clear preference. Use the returned `displayTitle` as the Codex thread
  title; it keeps the window/repository name first.
- After apply, read the returned `windowLaunchPlan`, use the Codex host
  `create_thread` tool to create real controller / Design / Test / product
  windows, then record the real thread ids only in `.workspace-local` local
  runtime files.
- To rebuild selected windows, pass `replaceWindows`. Create threads only for
  the returned replacement launch entries, then replace those windows' local
  registry records with the new real thread ids. Do not rewrite unrelated window
  registrations.
- Do not replace that tool with a hand-written inspection checklist when the MCP
  server is available.
- If Wakeflow MCP tools are unavailable, say that the MCP server is unavailable
  and stop for plugin reload/reinstall instead of pretending initialization can
  proceed through docs alone.
- Wakeflow MCP initialization does not place real thread ids in tracked docs or
  prompts. Thread registration remains local runtime work outside tracked docs.

Use this skill after reading:

1. `AGENTS.md`
2. `.workspace-active/workspace/index.md`
3. `.workspace-active/workspace/current/workspace-current-status.md`
4. the current controller state root and its developer progress document when
   the active demand has an execution surface

This skill may guide workspace documentation, TODO intake, dispatch planning, and validation. It must not authorize product implementation in Wakeflow, direct real-project testing, or bypass the current mainline.

## References

- Read [references/todo-backlog.md](references/todo-backlog.md) when creating, adjusting, rolling, accepting, canceling, prioritizing, or dispatching TODO / Backlog items.
- Read [references/window-dispatch.md](references/window-dispatch.md) when preparing a wave, task package, window coverage table, producer / consumer sequence, unified dispatch prompt, or send/no-send decision.
- Read [references/testing-validation.md](references/testing-validation.md) when deciding whether total control should self-test, whether `Test` or another configured test window is justified, how to write a test handoff, how to interpret test evidence, or which validation command applies.
- Read [references/script-pipeline.md](references/script-pipeline.md) when auditing workspace scripts, choosing validation commands, refreshing Design handoff intake, or maintaining script tests / documentation.
- Read [references/wakeflow-ledgers.md](references/wakeflow-ledgers.md) when creating, moving, syncing, archiving, or validating Wakeflow workspace documents, status mirrors, indexes, templates, Design handoff ledgers, test exchange entries, workspace skill assets, or `AGENTS.md` map / skill-pointer layering.
- Read [references/wakeflow-architecture.md](references/wakeflow-architecture.md) when restructuring `AGENTS.md`, skills, references, templates, scripts, current plans, or automation surfaces as one consistent Wakeflow system.
- Read [references/wakeflow-delivery.md](references/wakeflow-delivery.md) when total control starts, stops, designs, debugs, or validates the new Wakeflow Delivery Loop packet / envelope / result workflow.
- Read [references/direct-thread-window-config.md](references/direct-thread-window-config.md) when designing or implementing child-window direct thread dispatch config, thread registry files, delivery-run evidence, keep-live state, or v1/v2 automation runtime migration.
- Read [references/phased-migration.md](references/phased-migration.md) when a task moves, extracts, deletes, or rehomes behavior across configured product repositories.

## Non-Negotiables

- `AGENTS.md` remains the hard boundary source. If this skill and `AGENTS.md` differ, follow the stricter rule.
- `Design` signal / handoff is input to total control, not an execution plan.
- Total control self-tests by default; `Test` or another configured test window is only for real project verification, cold-start, repro, smoke, regression, runtime / Dashboard observation, and cross-repo environment evidence.
- A TODO or task package must serve the user goal and current completion definition; it must not become a reason to create empty work.
- Dispatch prompts must stay lightweight: keep the `AGENTS.md` read requirement, current-window / target-repository positioning declaration, task identity, and evidence return pointer; detailed scope, exclusions, validation commands, sub-agent guidance, and automation command semantics belong in the controller state root, task package, developer progress document, test exchange, or Wakeflow Delivery Loop skills.
- Workspace owns the only control state machine. PCV node state, scorecard readiness, and observability gaps are recorded inside Workspace plans as canonical Workspace status plus PCV evidence labels, not as a second state authority.
- Hard anti-failure rules belong in `AGENTS.md`, not only in this skill. This skill may add command details and templates, but it must not hide or weaken those rules.
- Before changing `AGENTS.md` or moving content into references, prepare an old-rule migration check: keep / downshift / rewrite / discard, and state which `AGENTS.md` section or reference now owns each rule.

## Minimal Workflow

1. Classify whether the task is TODO intake, TODO rolling, wave dispatch, task-package planning, test / validation judgment, script pipeline work, or prompt generation.
2. Load only the matching reference file.
3. Update the controller state root, developer progress append-only sections, `global-todo-board`, state-root `test-cards/*.json`, `test-exchange` projection, or Design inbox only when that is the correct ledger.
4. Run the workspace validation commands required by `AGENTS.md` and the active state root / developer progress document.
