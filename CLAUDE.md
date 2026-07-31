# Wakeflow Source Repository Instructions For Claude Code

This checkout is the development repository for the Wakeflow Codex and Claude
Code plugin artifacts. Work here maintains Wakeflow itself; it is not an
installed controller workspace and it does not own the product repositories
used to test Wakeflow.

Nested `CLAUDE.md` files inside plugin artifacts describe the behavior shipped
to installed controller workspaces. They remain product inputs and test
surfaces. Do not mistake their controller-role restrictions for a prohibition
on authorized Wakeflow source maintenance in this repository.

## Scope And Safety

- Follow the user's requested scope. Do not expand a Wakeflow change into an
  Alembic product change or another external repository.
- Preserve pre-existing and unrelated working-tree changes. Inspect
  `git status --short --branch` and the relevant diff before editing.
- Do not use destructive Git operations such as `git reset --hard`, discard
  another contributor's changes, or rewrite history unless the user explicitly
  authorizes that exact operation.
- Do not commit, push, tag, publish, or refresh an installed plugin cache unless
  the user explicitly requests that action. Authorization for one of these
  actions does not imply authorization for the others.
- Use only explicitly designated disposable workspaces for destructive runtime
  tests. Never treat a real product repository as a Wakeflow fixture.
- Keep secrets, tokens, private session identifiers, local absolute paths, and
  machine-specific cache paths out of committed source, fixtures, and docs.

## Source Ownership

- `core/` is the canonical source for host-neutral runtime files shared by both
  plugin artifacts.
- Make shared changes in `core/`, then run `node tools/sync-core.mjs`. Do not
  directly maintain the generated copies under `plugins/codex-wakeflow/` or
  `plugins/claude-code-wakeflow/`.
- After synchronization, run `node tools/sync-core.mjs --check` and inspect the
  resulting diff in both artifacts.
- Host-specific files stay in their artifact. This includes host profiles,
  host artifact checks, host send adapters, manifests, host memory files,
  READMEs, skills, and template bundles. Claude Code commands and the tmux host
  helper also remain Claude-specific. Do not add a host branch to `core/` when
  the difference belongs at a host seam.
- Shared code may consume values supplied by a host profile; it must not infer
  Codex-versus-Claude behavior through ad hoc host checks.
- Treat plugin cache directories as installed outputs, never as source. Modify
  this checkout first and refresh a cache only from a validated plugin artifact
  when the user asks for it.

## Change Discipline

- Diagnose against the current implementation before changing behavior. Keep
  state authority, evidence authority, and agent judgment distinct.
- Prefer the smallest coherent fix. Do not add a new state machine, approval
  layer, compatibility branch, or policy field when an existing boundary can
  express the requirement.
- Preserve agent flexibility while keeping identity, state transitions,
  evidence, isolation, and append-only history deterministic.
- Runtime behavior belongs in code, schemas, tests, and the installed plugin
  instructions or skills that own it. Repository-maintenance rules belong in
  this file. Historical plans under `docs/` are evidence, not current command
  authority.
- When changing a public MCP tool, state shape, task package, prompt, template,
  or installed rule, update every real producer and consumer plus focused
  regression coverage. Do not make documentation claim an unimplemented
  capability.
- Keep prompts prioritized and lightweight: prompts state the immediate goal,
  bounded expectations, reading order, required skills, identity, and return
  pointer; task packages hold complete task context; requirement anchors hold
  original background; skills own execution procedure.

## Verification

- Run focused tests for the changed behavior while iterating.
- For any shared-core change, run `npm run sync:core` followed by
  `npm run check:core`.
- Run the affected host validators and smoke tests for host-specific changes:
  `npm run validate` / `npm run smoke` for Codex and
  `npm run validate:claude` / `npm run smoke:claude` for Claude Code.
- Run `npm test` before declaring a release-ready change complete. It is the
  repository-wide gate for shared-core parity, both artifact validators, both
  smoke suites, and the regression tests.
- Run `git diff --check` before handoff and report any test that could not be
  run. Do not present an unavailable real-host session as a passing test.
- Claude Code account or login availability may limit a real session test, but
  it does not justify skipping static validation, unit tests, artifact checks,
  or the Claude Code smoke surface.

## Version And Release Integrity

- The repository root package remains private at version `0.0.0`; it is not a
  release-version source.
- A release version must agree in exactly the five current release sources:
  both plugin `package.json` files, both plugin manifests, and the Claude
  marketplace plugin entry.
- A version bump, commit, push to `main`, tag, publication, and local cache
  refresh are separate operations. Perform only the operations the user asked
  for and preserve their order explicitly.
- `npm run release:check` is a strict post-commit release consistency gate. It
  expects `main`, a clean tree, the matching tag at `HEAD`, and local
  `origin/main` at the same commit; do not weaken it to make an incomplete
  release appear valid.
- Never claim a release or cache refresh succeeded without verifying the exact
  artifact version and commit that the host will load.

## Claude Code Host Boundary

- Claude Code's session/tmux transport is a host adapter, not a second Wakeflow
  state authority. Keep session creation, delivery, readback, and activity
  observations separate from controller acceptance.
- Do not infer that a shell send succeeded merely because text was pasted into
  tmux. Preserve the adapter's delivery and readback evidence semantics.
- Do not make repository correctness depend on a logged-in Claude Code account.
  Keep dependency-free and non-login checks runnable; label any omitted live
  host test as unverified.

## Handoff

- Summarize what changed, why the implementation matches current code, which
  validations ran, and any residual risk.
- Mention uncommitted changes and repository ahead/behind state when relevant.
- Do not claim acceptance merely because scripts, sessions, or child agents
  reported success; inspect the resulting diff and evidence directly.
