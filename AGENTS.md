# Wakeflow Source Repository Instructions

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
- Keep secrets, tokens, private session or thread identifiers, local absolute
  paths, and machine-specific cache paths out of committed source, fixtures,
  and docs.

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
  in both artifacts. Host differences are the twelve placeholders filled by
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
- `tooling/cli.ts` is the maintainer CLI (`npm run wf -- verify|doctor|lab|
  fault|live|capture|ci|timings`), documented in
  `docs/references/maintainer-tools.md`. It is development support only: it
  never enters the artifacts, owns no Demand state, and its lab, live and
  capture receipts under `.build/` carry local paths and stay uncommitted.
- `.github/workflows/verify.yml` runs the same `wf verify gate|artifact`
  profiles on Ubuntu and macOS and uploads only the bounded `ci export`
  report. A green local gate is not a remote run; say which one ran.
- `wakeflow-architecture-atlas/` is a separate read-only map subproject with
  its own `npm run check` in that directory; `maps/` is its canon. It is not
  part of the root gate and must not be cited as runtime authority.

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
- Managed text is admitted by exact body: the workspace `CLAUDE.md`/`AGENTS.md`
  block, the external instruction blocks, the repository and support
  `.gitignore` blocks and the support memories. When you change one of their
  renderers, register the replaced render in
  `src/workspace/managed-integration/wakeflow-managed-text-history.ts` (its
  retiring version and a function that recomputes the old body from the same
  inputs) and update the pinned digests in
  `tests/workspace/managed-integration/wakeflow-managed-text-history.test.ts`.
  Changing the digests without registering the old render locks every existing
  workspace behind `unknown-managed-body`.
- Keep prompts prioritized and lightweight: prompts state the immediate goal,
  bounded expectations, reading order, required skills, identity, and return
  pointer; task packages hold complete task context; requirement anchors hold
  original background; skills own execution procedure.

## Verification

- Verification is tiered; `npm run wf -- impact report` names the tier the
  current change set needs and the commands to run (gate-log §13.181).
  - Tier 0, after every edit (1–3 min): `npm run wf -- verify quick --changed`
    (or `--files <tests>`): typecheck, Biome on the changed files and the tests
    reached by the change set, with a receipt under `.build/verification/`.
  - Tier 1, before every commit (5–12 min): tier 0 plus what the impact report
    names - `schema:build` and `schema:check` for schema changes; the artifact
    rebuild, `tests/artifacts` and `smoke:artifacts` for anything that reaches
    the artifacts (the smoke also runs the lab dual-product and worktree
    experiments on both built artifacts; an `assets/agent-text/` change selects
    those tests through a declared resource edge and is tier 1, not a full
    gate); the owning
    slice's tests and one host's scenario chain for capability or governance
    changes - then `npm run wf -- handoff`.
  - Tier 2, the full gate `npm test` (about 18 min on 8 CPUs): before a
    push or a tag, after any change under `src/foundation`, `src/kernel`,
    `src/contracts`, `tests/scenarios` or `tooling/testing`, after a Biome,
    knip or tsconfig change, and once per day of work. Only tier 2 receipts
    feed `wf timings apply`. A push runs the same gate remotely
    (`verify.yml`), so the push itself needs no second local run.
  - The runner schedules lanes on its own (gate-log §13.204): the two scenario
    chains and the `loadSensitive`-tagged files start at once with two workers
    each, the rest follow at the remaining budget once the tagged files finish.
    Run the gate at the default budget; `WAKEFLOW_TEST_CONCURRENCY=2` is CI's
    single-lane setting, not a local requirement. A test that times out only
    under eight workers gets the tag, not a longer timeout.
- Each gate-log section states which tier ran and why.
- A tier 2 receipt counts as the stage gate whoever launched it, when `wf verify`
  recorded it as `gate`, `passed` and `inputsUnchanged` and its input digest
  equals the tree's current digest: the receipt pins the bytes, not the
  author. Say in the gate-log whose run it was. `wf timings apply` compares
  that digest too, so it may run before or after the gated tree is committed.
- Tests follow `docs/standards/testing-standard.md`: six levels (pure, component,
  capability, public-tool, tooling, artifact) with per-file budgets, placement
  mirroring `src/`, disposable roots with `durability: "none"` outside the
  crash-semantics tests, the `loadSensitive` tag for real-process or wall-clock
  work, and no skip/todo/only or retries inside the gate. A new or changed test
  names its level in the file header and stays inside that level's budget.
- When another session or agent may be compiling or testing in this tree,
  run every `.build/`- or `plugins/`-writing command under the repository
  build lock: `npm run locked -- npm test`. `wf verify` and `wf handoff`
  hold that lock themselves. Never start another build, scan or test run while
  a tier 2 gate is running: its load-sensitive tests fail under contention.
- `npm run wf -- handoff` runs the read-only handoff checklist (whitespace,
  private content, `build:check`, version-bytes, docs pointers, Git state); run
  it before reporting completion and fix what it names.
- `npm test` is the gate: typecheck, architecture rules, lint and format
  checks (Biome), unused-code check (knip), the TypeScript tests including the
  end-to-end scenario chain (26 scenarios, run once per host), the Schema
  drift check, and `build:check` against the committed artifacts.
- After a change that reaches the artifacts (runtime, skills, commands,
  READMEs, hooks, metadata), run `npm run build:artifacts:committed` before
  the tests of tier 1 or 2, and `npm run smoke:artifacts` before handoff. Any
  `src/` edit changes compiled bytes under `plugins/*/lib`, so it reaches the
  artifacts. The smoke is not part of `npm test` on purpose;
  `npm run smoke:candidate` runs it against a fresh candidate build without
  touching `plugins/`.
- Run `git diff --check` before handoff and report any test that could not be
  run. Do not present an unavailable real-host session as a passing test.
- Host account or login availability may limit a real session test, but it
  does not justify skipping static validation, unit tests, artifact checks, or
  the smoke.

## Version And Release Integrity

- The repository root package remains private at version `0.0.0`; it is not a
  release-version source.
- A release version must agree in `assets/release/version.json` and the five
  release sources: both plugin `package.json` files, both plugin manifests, and
  the Claude marketplace plugin entry. The Codex marketplace entry carries no
  version. The Claude marketplace's own `metadata.version` is the catalog
  version, not a release source; `release:check` only requires it to be a
  valid semver.
- A version bump, artifact rebuild, commit, push to `main`, tag, publication,
  and local cache refresh are separate operations. Perform only the operations
  the user asked for and preserve their order explicitly. `npm run wf --
  release bump --version X --apply` performs only the first of them.
- `npm run release:check` is a strict post-commit release consistency gate. It
  expects `main`, a clean tree, the matching tag at `HEAD`, local
  `origin/main` at the same commit, release-eligible artifact manifests and a
  Node 24 runtime; do not weaken it to make an incomplete release appear valid.
- Never claim a release or cache refresh succeeded without verifying the exact
  artifact version and commit that the host will load.

## Host Boundary

- A host's thread or session transport is a host adapter, not a second
  Wakeflow state authority. Keep session creation, delivery, readback, and
  activity observations separate from controller acceptance.
- Do not infer that a delivery landed merely because a send call returned or
  text was pasted. Landing is proven by the target session's hook observation
  record, or for Codex by the thread send's own successful return.
- Do not make repository correctness depend on a logged-in host account. Keep
  dependency-free and non-login checks runnable; label any omitted live host
  test as unverified.

## Handoff

- Summarize what changed, why the implementation matches current code, which
  validations ran, and any residual risk.
- Mention uncommitted changes and repository ahead/behind state when relevant.
- Do not claim acceptance merely because scripts, sessions, or child agents
  reported success; inspect the resulting diff and evidence directly.
