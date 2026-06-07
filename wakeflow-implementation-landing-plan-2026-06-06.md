# Wakeflow Implementation Landing Record

Date: 2026-06-06
Status: implemented and still being hardened

## User Goal

Wakeflow is not a thin demo plugin, a scaffold, or a script launcher. It is the
plugin-ready form of a mature local workflow runtime for unattended Codex work
across multiple repositories and multiple Codex windows.

Completion definition:

> After installing Wakeflow, a user can initialize a parent workspace, select the
> managed repositories and windows, install controller, child, Design, and Test
> `AGENTS.md` surfaces, and run the same state-root, task-package, delivery,
> target-result, controller-review, archive, and verification loop through
> Wakeflow skills and MCP tools.

## Confirmed Product Direction

- Default installation should not invent product window names. Wakeflow ships
  with controller, Design, and Test support; product windows come from discovery
  and user confirmation.
- MCP tools should expose stable workflow capabilities, not a flat list of
  scripts as the primary product interface.
- The JavaScript scripts remain the local implementation backend. They create,
  validate, summarize, and record files; they do not replace controller
  judgment.
- MCP tools do not directly accept or write real thread ids. Host-thread
  delivery is handled by Codex host capabilities, while Wakeflow records the
  delivery envelope and send/readback evidence.

## Implemented Capabilities

- Plugin packaging through `.codex-plugin/plugin.json`.
- MCP server entrypoint at `bin/wakeflow-mcp.mjs`.
- Runtime backend whitelist through `lib/wakeflow-runtime.mjs`.
- Installation and workspace setup through `wakeflow-setup.mjs`.
- State-root, task-package, progress, result, reducer, and decision operations
  through `wakeflow-state.mjs`.
- Design/Test intake through `wakeflow-intake.mjs`.
- Dispatch packet, delivery envelope, direct-thread evidence, result review,
  controller return, and loop-stop operations through `wakeflow-delivery.mjs`.
- Archive, repository status, residue checks, script checks, layout checks, and
  full verification through the Wakeflow script family.
- Operational skills for controller, target, governance, and progressive
  validation workflows.
- Templates for starter workspace state, Design/Test support, state-machine
  progress, handoff, signal, requirement design, goal confirmation, and test
  handoff documents.

## Current Hardening Result

This landing pass verified the original source-workspace capabilities against
the current Wakeflow implementation and closed the most important connectivity
gaps:

- MCP keeps only stable outer workflow contracts public. `wakeflow_status` and
  `wakeflow_verify` accept and forward an explicit `root`; detailed backend,
  archive, result-import, and controller-return steps remain internal runtime
  script operations.
- CLI `--root` now targets the managed workspace while keeping script execution
  anchored in the Wakeflow runtime directory.
- Verification helpers support explicit roots and handle an uninitialized active
  workspace without failing reusable plugin checks.
- Runtime script naming now exposes `wakeflow-smoke` instead of a generic
  `smoke` key.
- Smoke tests cover MCP status, task creation, and target delivery preparation
  with an explicit root.
- CLI tests cover root-aware status, embedded runtime execution, and root-aware
  verification.

## Boundaries

- Wakeflow does not implement product code for managed repositories.
- Wakeflow does not turn MCP into the workflow brain; `AGENTS.md` and the
  controller window remain responsible for judgment, scope, acceptance, and user
  decisions.
- Wakeflow does not fake host-thread send behavior. It prepares envelopes and
  records evidence for real Codex host sends.
- Wakeflow keeps project-specific active state in ignored runtime surfaces and
  long-term project records outside the reusable repository.

## Verification Contract

Use this set before accepting implementation or symbol changes:

- `node scripts/wakeflow-verify.mjs`
- `node scripts/wakeflow-check-scripts.mjs --json`
- `node scripts/wakeflow-smoke.mjs`
- `npm test`
- `git diff --check`

Latest verified result before this cleanup: all checks passed with 96 tests.
