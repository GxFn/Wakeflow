# Wakeflow Source Repository Instructions For Claude Code

This checkout is the development repository for the Wakeflow Codex and Claude
Code plugin artifacts. Work here maintains Wakeflow itself; it is not an
installed controller workspace and it does not own the product repositories
used to test Wakeflow.

The generated plugin artifacts under `plugins/` carry the skills, commands and
READMEs shipped to installed controller workspaces. They describe an installed
workspace's rules, not this repository's. Do not mistake their controller-role
restrictions for a prohibition on authorized Wakeflow source maintenance here.

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

- `src/`, `tooling/` and `tests/` are the only hand-written code. `src/` is
  the runtime in six layers — `foundation` → `contracts` → `kernel` →
  `capabilities` / `governance` / `configuration` / `workspace` → `hosts` →
  `entrypoints` — and `npm run check:architecture` enforces the direction.
- `plugins/codex-wakeflow/` and `plugins/claude-code-wakeflow/` are generated
  by `tooling/artifacts/build-plugin-artifacts.ts`. Never edit them by hand:
  change the source, run `npm run build:artifacts:committed`, and let
  `npm run build:check` prove the committed bytes match a fresh build.
- `assets/agent-text/` is the single source of the skills, commands and READMEs
  in both artifacts. Host differences are the six placeholders filled by
  `src/hosts/<host>/<host>-agent-text-profile.ts`; the build fails on an
  unregistered placeholder or an unused value.
- Host-specific behavior lives only in `src/hosts/<host>/`: profiles, the hook
  fragment, the agent-text value table, maintenance execution, Claude's
  settings and status-line assets. Shared code consumes values a host profile
  supplies; it must not infer Codex-versus-Claude behavior through ad hoc host
  checks.
- `src/contracts/schemas/` holds the portable JSON Schemas;
  `src/contracts/generated/` is derived by `npm run schema:build` and checked
  for drift by `npm run schema:check`. Do not hand-edit generated files.
- `assets/release/version.json` is the only version input. The two plugin
  `package.json` files, the two plugin manifests and the Claude marketplace
  entry must agree with it.
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
- Runtime behavior belongs in code, schemas, tests, and the shipped skills that
  own it. Repository-maintenance rules belong in this file. The documentation
  system and its authority order are defined in `docs/README.md`;
  `docs/archive/` holds historical evidence, not current command authority.
- When changing a public MCP tool, state shape, task package, prompt, skill
  text, or installed rule, update every real producer and consumer plus focused
  regression coverage, then rebuild the artifacts. Do not make documentation
  claim an unimplemented capability.
- Keep prompts prioritized and lightweight: prompts state the immediate goal,
  bounded expectations, reading order, required skills, identity, and return
  pointer; task packages hold complete task context; requirement anchors hold
  original background; skills own execution procedure.

## Verification

- Run focused tests for the changed behavior while iterating:
  `npm run test:typescript:focused -- <test files>`.
- `npm test` is the gate: typecheck, architecture rules, lint and format
  checks (Biome), unused-code check (knip), the TypeScript tests including the
  twenty end-to-end scenarios, the Schema drift check, and `build:check`
  against the committed artifacts. Run it before declaring a change complete.
- After a change that reaches the artifacts (runtime, skills, commands,
  READMEs, hooks, metadata), run `npm run build:artifacts:committed` before
  `npm test`, and `npm run smoke:artifacts` before handoff.
- Run `git diff --check` before handoff and report any test that could not be
  run. Do not present an unavailable real-host session as a passing test.
- Claude Code account or login availability may limit a real session test, but
  it does not justify skipping static validation, unit tests, artifact checks,
  or the smoke.

## Version And Release Integrity

- The repository root package remains private at version `0.0.0`; it is not a
  release-version source.
- A release version must agree in `assets/release/version.json` and the five
  release sources: both plugin `package.json` files, both plugin manifests, and
  the Claude marketplace plugin entry. The Codex marketplace entry carries no
  version.
- A version bump, artifact rebuild, commit, push to `main`, tag, publication,
  and local cache refresh are separate operations. Perform only the operations
  the user asked for and preserve their order explicitly.
- `npm run release:check` is a strict post-commit release consistency gate. It
  expects `main`, a clean tree, the matching tag at `HEAD`, local
  `origin/main` at the same commit, release-eligible artifact manifests and a
  Node 24 runtime; do not weaken it to make an incomplete release appear valid.
- Never claim a release or cache refresh succeeded without verifying the exact
  artifact version and commit that the host will load.

## Claude Code Host Boundary

- Claude Code's session/tmux transport is a host adapter, not a second Wakeflow
  state authority. Keep session creation, delivery, readback, and activity
  observations separate from controller acceptance.
- Do not infer that a delivery landed merely because text was pasted into
  tmux. Landing is proven by the target session's hook observation record.
- Do not make repository correctness depend on a logged-in Claude Code account.
  Keep dependency-free and non-login checks runnable; label any omitted live
  host test as unverified.

## Handoff

- Summarize what changed, why the implementation matches current code, which
  validations ran, and any residual risk.
- Mention uncommitted changes and repository ahead/behind state when relevant.
- Do not claim acceptance merely because scripts, sessions, or child agents
  reported success; inspect the resulting diff and evidence directly.
