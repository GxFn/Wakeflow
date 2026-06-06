# Wakeflow Symbol Unification Record

Date: 2026-06-06
Status: completed

## Goal

Wakeflow must present itself as a reusable unattended multi-window workflow
plugin and runtime. Public files, skills, scripts, MCP tools, configuration
fields, templates, tests, and documentation should use Wakeflow terms instead
of inherited source-workspace names.

Completion definition:

> A user can inspect the repository and see Wakeflow as the primary product
> surface. Protocol terms such as `controller`, `target`, `delivery envelope`,
> `target result envelope`, `dispatch group`, and `state root` remain only
> where they describe the workflow protocol.

## Confirmed Decisions

- Use a breaking rename. Do not keep public compatibility shims for old script
  names or old skill names.
- The original source repository remains available elsewhere, so Wakeflow does
  not need to preserve source-workspace entrypoints.
- Public configuration uses `controllerWindow` and `wakeflowRepoDir`.
- Do not add tests whose only purpose is locking old names. If obsolete wording
  appears again, delete the residue directly.

## Current Public Surface

### Scripts

- `wakeflow-setup.mjs`
- `wakeflow-cli.mjs`
- `wakeflow-runtime.mjs`
- `wakeflow-state.mjs`
- `wakeflow-intake.mjs`
- `wakeflow-delivery.mjs`
- `wakeflow-verify.mjs`
- `wakeflow-check-scripts.mjs`
- `wakeflow-check-boundary.mjs`
- `wakeflow-check-layout.mjs`
- `wakeflow-check-runtime.mjs`
- `wakeflow-check-repository-residue.mjs`
- `wakeflow-repo-status.mjs`
- `wakeflow-archive-docs.mjs`
- `wakeflow-archive-todo.mjs`
- `wakeflow-archive-summaries.mjs`
- `wakeflow-compact-index.mjs`
- `wakeflow-next-work.mjs`
- `wakeflow-render-progress.mjs`
- `wakeflow-progress-log.mjs`
- `wakeflow-demand-sequence.mjs`
- `wakeflow-import-design-handoffs.mjs`
- `wakeflow-smoke.mjs`
- `wakeflow-validate.mjs`

### Skills

- `wakeflow-governance`
- `wakeflow-controller`
- `wakeflow-target`
- `wakeflow-progressive-validation`

### Runtime Assets

- `lib/wakeflow-runtime.mjs`
- `scripts/lib/wakeflow-config.mjs`
- `scripts/lib/wakeflow-status-machine.mjs`
- `schemas/wakeflow-state-machine/`
- `templates/wakeflow-state-machine/`
- `scripts/fixtures/wakeflow-state-machine/`

## Verification

- `node scripts/wakeflow-check-scripts.mjs --json`
- `node scripts/wakeflow-validate.mjs`
- `node scripts/wakeflow-smoke.mjs`
- `npm test`
- `git diff --check`
- repository text scan for obsolete public naming residue

Latest verified result: all checks passed after the Wakeflow symbol pass.
