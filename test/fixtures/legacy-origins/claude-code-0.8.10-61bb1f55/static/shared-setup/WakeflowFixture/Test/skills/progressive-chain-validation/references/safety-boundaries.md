# Safety Boundaries

Progressive chain validation often touches tests, generated artifacts, runtime data, and source code. Keep these boundaries explicit and re-check them before every node action.

## Allowed Without Extra Approval

- Read repository files and documentation.
- Search source code, tests, logs, and local artifacts.
- Edit files directly related to the requested current-node repair.
- Add focused tests or harnesses for changed behavior.
- Write run evidence under `scratch/chain-runs/<run-id>/`.
- Run non-mutating local checks such as typecheck, build, lint, and focused tests.

## Requires Explicit Approval

- Deleting user data or persistent runtime data.
- Rewriting large directories.
- Running commands against production, private, or externally shared projects.
- Starting long-running services, dashboards, watchers, or background workers when they are not already part of the approved node.
- Running user-facing workflow commands against a project path not provided for testing.
- Changing public path contracts, installed tool state, IDE integration files, or user-global configuration.
- Sending data to external model, network, or SaaS services when that is not already approved for the target project.

## Blocked Unless A Project Adapter Allows It

- Creating runtime data inside the source repository under validation.
- Treating a source repository as the user project for commands that are meant to mutate a separate target project.
- Injecting internal maintenance skills into user projects.
- Writing delivery output, generated docs, project skills, candidates, reports, or database rows outside the declared write boundary.

Project-specific adapters may add stricter rules. Adapter rules override the generic defaults when they are narrower.

## Repair Rule

Fix the current failing node only. Re-run that node before moving to the next. If a broader refactor becomes necessary, record the reason in the node report before expanding scope.

## Command Triage

Before running a command, classify it:

- `read-only`: source search, file reads, git diff/status/log, static inspection.
- `local-check`: typecheck, build, lint, focused tests.
- `runtime-write`: commands that create or mutate runtime data, databases, generated knowledge, project skills, delivery files, IDE integration files, or reports.
- `service`: long-running servers, dashboards, watchers, MCP servers, job workers, queues, or browser sessions.
- `external`: commands that use a network, external model provider, third-party API, production account, or shared environment.
- `destructive`: delete, reset, rewrite, migration, cleanup, or production data access.

Only `read-only` and `local-check` are allowed by default. Everything else needs a recorded path boundary and, when applicable, explicit approval.

## Terminal Stability Contract

Before running a terminal command as node evidence, record these facts in `report/plan.md`:

- Execution mode: `sync` only for short, bounded commands; `async` for servers, watchers, model-backed runs, wait-mode workflows, or commands with uncertain duration.
- Timeout budget: every command needs a hard budget or an explicit async finish/readiness signal. Do not use unbounded execution for tests, builds, broad workflow commands, or external-project validation.
- Non-interactive guarantee: commands must pass flags or environment variables that prevent prompts. If a prompt appears, stop and collect the required value explicitly instead of leaving the terminal waiting.
- Output policy: use concise reporters, filters, or an attachment file for bulky output; the plan stores the summary and the attachment path.
- Exit evidence: capture a test summary or explicit exit marker when the tool output may be ambiguous.
- Hang recovery: if output stalls past the budget, stop or kill the process, record partial output, mark the current node `blocked` or `fail`, and create a smaller harness or observability repair before rerunning.

Terminal commands are evidence transports, not proof by themselves. A command that times out or is cancelled cannot pass the node even if earlier lines look promising.

## Failure Handling

- Keep failed command output with the node round, not only in the final report.
- Do not advance a failed node by explaining it away; either repair, split, block, or skip with a recorded reason.
- If a repair changes code, add or update a focused test when the behavior is reusable.
