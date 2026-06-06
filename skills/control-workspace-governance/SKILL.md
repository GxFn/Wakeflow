---
name: control-workspace-governance
description: Use when working inside ControlWorkspace on AGENTS.md / skill layering, TODO / Backlog intake, Design handoff intake, idle-window scheduling, window coverage, task-package dispatch, producer/consumer sequencing, unified dispatch prompts, test handoffs, validation boundaries, or workspace script pipelines. This skill supplements AGENTS.md and must not override its hard boundaries.
---

# Control Workspace Governance

This skill holds detailed ControlWorkspace control-center procedures that are too bulky to keep fully resident in `AGENTS.md`.

## Scope

Use this skill after reading:

1. `AGENTS.md`
2. `.workspace-active/workspace/index.md`
3. `.workspace-active/workspace/current/workspace-current-status.md`
4. the current controller state root and its developer progress document when
   the active demand has an execution surface

This skill may guide workspace documentation, TODO intake, dispatch planning, and validation. It must not authorize product implementation in ControlWorkspace, direct real-project testing, or bypass the current mainline.

## References

- Read [references/todo-backlog.md](references/todo-backlog.md) when creating, adjusting, rolling, accepting, canceling, prioritizing, or dispatching TODO / Backlog items.
- Read [references/window-dispatch.md](references/window-dispatch.md) when preparing a wave, task package, window coverage table, producer / consumer sequence, unified dispatch prompt, or send/no-send decision.
- Read [references/testing-validation.md](references/testing-validation.md) when deciding whether total control should self-test, whether `TestWindow` is justified, how to write a test handoff, how to interpret test evidence, or which validation command applies.
- Read [references/script-pipeline.md](references/script-pipeline.md) when auditing workspace scripts, choosing validation commands, refreshing Design handoff intake, or maintaining script tests / documentation.
- Read [references/workspace-ledgers.md](references/workspace-ledgers.md) when creating, moving, syncing, archiving, or validating workspace control documents, status mirrors, indexes, templates, Design handoff ledgers, test exchange entries, workspace skill assets, or `AGENTS.md` map / skill-pointer layering.
- Read [references/control-architecture.md](references/control-architecture.md) when restructuring `AGENTS.md`, skills, references, templates, scripts, current plans, or automation surfaces as one consistent control system.
- Read [references/codex-automation-loop.md](references/codex-automation-loop.md) when total control starts, stops, designs, debugs, or validates the new Codex Automation Closed Loop packet / envelope / result workflow.
- Read [references/direct-thread-window-config.md](references/direct-thread-window-config.md) when designing or implementing child-window direct thread dispatch config, thread registry files, delivery-run evidence, keep-live state, or v1/v2 automation runtime migration.
- Read [references/phased-migration.md](references/phased-migration.md) when a task moves, extracts, deletes, or rehomes behavior across BaseWindow repositories.

## Non-Negotiables

- `AGENTS.md` remains the hard boundary source. If this skill and `AGENTS.md` differ, follow the stricter rule.
- `DesignWindow` signal / handoff is input to total control, not an execution plan.
- Total control self-tests by default; `TestWindow` is only for real project verification, cold-start, repro, smoke, regression, runtime / Dashboard observation, and cross-repo environment evidence.
- A TODO or task package must serve the user goal and current completion definition; it must not become a reason to create empty work.
- Dispatch prompts must stay lightweight: keep the `AGENTS.md` read requirement, current-window / target-repository positioning declaration, task identity, and evidence return pointer; detailed scope, exclusions, validation commands, sub-agent guidance, and automation command semantics belong in the controller state root, task package, developer progress document, test exchange, or Codex Automation Closed Loop skills.
- Workspace owns the only control state machine. PCV node state, scorecard readiness, and observability gaps are recorded inside Workspace plans as canonical Workspace status plus PCV evidence labels, not as a second state authority.
- Hard anti-failure rules belong in `AGENTS.md`, not only in this skill. This skill may add command details and templates, but it must not hide or weaken those rules.
- Before changing `AGENTS.md` or moving content into references, prepare an old-rule migration check: keep / downshift / rewrite / discard, and state which `AGENTS.md` section or reference now owns each rule.

## Minimal Workflow

1. Classify whether the task is TODO intake, TODO rolling, wave dispatch, task-package planning, test / validation judgment, script pipeline work, or prompt generation.
2. Load only the matching reference file.
3. Update the controller state root, developer progress append-only sections, `global-todo-board`, state-root `test-cards/*.json`, `test-exchange` projection, or Design inbox only when that is the correct ledger.
4. Run the workspace validation commands required by `AGENTS.md` and the active state root / developer progress document.
