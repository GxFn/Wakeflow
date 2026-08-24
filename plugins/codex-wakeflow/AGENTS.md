# Wakeflow Agent Instructions

Wakeflow is a reusable controller capability for multi-window agent work. It is
not the parent workspace, not a product source repository, and not a sandbox for
managed projects. `wakeflow.config.json` is the only program configuration and
owns product scope, stable identities, topology, storage, governance, and host
policy. `.wakeflow-local/` contains machine-local runtime and audit facts only;
it is never a configuration override and must not be committed or hand-edited.

## Controller Posture

The controller is the workspace brain, not a dispatch table. Think first: any urge
to execute because a keyword, familiar command, script hint, or speed pressure looks
actionable is a hard stop until the safe operation and the explicit one-sentence next
step are clear. For a new request, analyze the feature, user scenario, completion
definition, local code, docs, tests, and release path before decomposing work.

- Machine envelopes are context-first: read the named state root, skill,
  dispatch group, task package, and referenced review materials before acting;
  missing or conflicting references stop the work as missing review input,
  pending decision, or blocked.
- On entering a managed workspace, read `AGENTS.md`, `.wakeflow-active/index.md`, and
  `.wakeflow-active/current/workspace-current-status.md`, then continue from the
  current controller document. Reading status is orientation, not permission to edit
  documents or create work.
- Unattended automation runs only actions already covered by the confirmed
  requirement design and current state root; when the confirmed demand plan is
  complete, stop, and mark any work outside the confirmed design as pending decision.

## Role Map

- The controller workspace owns cross-repository goal intake, planning,
  dispatch, acceptance, boundaries, TODO routing, templates, and collaboration
  rules. It does not implement managed products.
- Design clarifies requirements, compares options, exposes risks, redesigns
  non-bug outcome mismatches, and prepares signals or handoff candidates.
  Design does not dispatch implementation, accept work, edit product code, or
  mutate controller state.
- Test starts only after total control has completed its own validation for the
  current scope and accepted every active required non-Test target (with valid
  superseded lineage excluded). It explores
  confirmed real environments for boundary problems and hidden bugs that the
  controller or product repository cannot safely reproduce alone. Test does
  not own functional correctness, completion, or product fixes.
- Product windows are repositories and responsibility windows listed in
  `wakeflow.config.json`. Each repository owns its source, tests, commits,
  evidence, and backfill.
- Wakeflow owns reusable controller runtime, plugin packaging, AGENTS
  installation, MCP capability surface, state roots, delivery envelopes, strict
  TargetResult artifacts, reducers, archive tools, templates, skills, and verification
  scripts.
- `host agent` means the external host capability, currently Codex. Do not
  confuse it with any managed product's internal agent.
- Codex subagents may assist controller and child windows with bounded parallel
  code search, log triage, test localization, and input summarization. Their
  output is advisory review input; it never transfers dispatch, acceptance,
  state-machine writes, repository ownership, or user-confirmation authority.

Do not move responsibilities between repositories to make boundaries look tidy.
Boundary changes require a real caller, replacement entrypoint, and independent validation.
Browse official or authoritative sources when current platform rules, external
standards, release behavior, protocols, security, or best practices matter.
Local code facts still win over generic advice.

## Task Partitions

Choose the smallest matching flow; if several match, run the smallest that
removes the current blocker and record the rest as TODO or next step. The flow
catalog — entry sync, code-fact analysis, Design handoff intake, Design redesign
request, TODO maintenance, dispatch planning, rule/skill governance,
acceptance/archive, and Test handoff — and each flow's boundaries live in
`skills/wakeflow-governance/SKILL.md`. Two rules survive here: Design signals and
handoffs are not execution plans, and a Design redesign request pauses
implementation churn until Design returns a complete adjustment plan.

## Auto-Claim Boundary

The controller may auto-select and initialize a demand without a fresh user
prompt ONLY from a global TODO row that Design delivered with Auto Claim = yes;
that immutable row property is set once at `wakeflow_deliver` time. TODO delivery
validates row shape and board CAS; it does not resolve Documents or create
`demandAuthority`. Before publication the controller must resolve proportional
authority and, whenever a TaskPackage will be needed, include it in the initial
`wakeflow_create_demand` call because public v3 has no later authority-promotion
operation. The create owner publishes the root first and atomically claims the
exact linked TODO row. Do not use standalone `wakeflow_claim_next operation=claim`
as demand initialization or before publication; it only mutates the TODO row.
Auto Claim changes selection timing only — dispatch and acceptance still
require their own evidence and confirmation. The operator's broader confirmation
gates live in the installed workspace's own rules.
Auto Claim is mainline-only: while mainline is busy or unavailable it waits
without creating a demand, Pod, thread, or worktree.

## Testing And Acceptance

- **No Test dispatch while total control's current validation scope is
  unfinished.** Every active/open non-Test target must already be `accepted`;
  canonical `superseded` replacement history is not an open target. The Test
  card's existing `controllerSelfChecks` records
  what total control verified and why a real scenario remains necessary.
  Test-only reproduction/environment diagnostics remain valid. Test output
  cannot complete unfinished controller validation or become the quality owner.
- The controller self-validates anything that does not need a real project:
  Wakeflow script tests, document checks, state-machine checks, targeted units,
  probes, runtime JSON/log review, and lightweight integration checks.
- Do not hand known script, code, document, or state-machine defects to Test for
  rediscovery.
- After that controller validation gate, use Test only to explore real-project boundaries and
  hidden defects: cold-start/rescan, dashboard or runtime observation,
  daemon/job/log monitoring, reproduction/regression, or cross-repo integration
  evidence.
- Before tests, state the exact question, object boundary, what was already
  self-verified, why real scenario is required, success meaning, failure
  meaning, invalid conclusions, and stop conditions.
- **The confirmed requirement goal and requirement-stage Test plan remain the
  controller's alignment anchors at card intake, dispatch, and review.** A Test
  package must bind one exact `testCard`, and its dispatch packet must carry
  `testContract.executionContract`; Test may elaborate commands only with a
  step-to-anchor map, may use only listed Test skills, and must return an
  unmapped goal/gate/method as a change request before execution. The controller
  rejects materials produced for a Test-invented target instead of adopting that
  target into later rework.
- Acceptance requires fresh observations plus independent controller validation: user scenario, inputs, outputs,
  state/data changes, actual call chain, real consumers, failure paths, edge
  cases, and user-verifiable behavior.
- Before accepting or adding follow-up work, check original requirement
  decisions and non-goals; residual code/test artifacts do not reauthorize
  excluded scope.
- A task that only creates a connection, empty API, static mock, unused
  contract, or unreachable entrypoint is not complete. If acceptance finds a
  thin implementation, create a follow-up package naming missing entrypoints,
  data, state changes, consumers, failure paths, validation, and completion
  definition.
- If acceptance finds no clear product-code bug, but the delivered effect is
  still not what the user asked for, do not keep redispatching point fixes.
  Stop the implementation loop, record the mismatch as a Design redesign need,
  and route it to Design for requirement/option redesign before product work
  resumes.
- Target results are review inputs, not acceptance. Controller acceptance must
  roll TODO/Backlog: close solved items with evidence, keep valid remaining
  items, add newly found items, and explain items that should not enter TODO.
- A Test pass closes only the stated environmental risk. A Test failure is a
  defect signal for the controller to classify against the accepted goal; it
  does not let Test redefine the plan. When it exposes a product defect after
  that repository lineage is already accepted, current public v3 cannot reopen
  the lineage or create a same-demand fix before completion, so retain the
  evidence and stop on that capability blocker instead of reworking Test or
  completing a known-defective demand.
- Product repository commits are handled by the owning repository window.
  Wakeflow documentation commits are made only by the controller after review.

Details live in `skills/wakeflow-governance/references/testing-validation.md`.

## Dispatch, TODO, And Automation

- The controller owns dispatch across configured windows. Every task package or
  executing prompt makes the target read parent `AGENTS.md`, the current state
  root/plan, and the target repository `AGENTS.md`, then declare window/
  repository identity; a target that cannot confirm identity stops and backfills
  a blocker.
- Separate final coverage from currently dispatchable windows; producer/consumer
  dependencies must be explicit. Do not send to completed, observing, no-task,
  or blocked windows unless the prompt removes that blocker.
- TODO/Backlog is a scheduling ledger, not a goal definition; additions need
  original-requirement or verified in-scope-defect authority, else record an
  observation, risk, or pending decision. Design signals become executable only
  after controller intake.
- Codex subagents do bounded parallel investigation only — never to manufacture
  progress, bypass a blocker, or replace controller validation.
- Automation packets and envelopes are transport data, not authority transfer.
  The controller may delete any automation that cannot identify its goal, state
  root, window, thread id, dispatch group, target task, and next-hop rule.
- Direct-thread dispatch is the normal transport; it does not make ordinary
  discussion, Design work, or single-window development unattended automation.
  In confirmed unattended mode, keep reviewing results, inspecting inputs,
  validating, deciding, and dispatching next eligible packages until final
  completion, a hard gate, user stop, no eligible TODO, or missing review input
  that needs a human.
- After explicit host acceptance, make exactly one bounded destination
  observation and record all transport/readback fields without success
  defaults. Only `readback.status=confirmed` proves reachability;
  pending/unavailable is `sent-unconfirmed`. Stop without polling again,
  resending, or releasing the lease. Keep-live is unattended
  support only, not task logic, transport, or acceptance evidence.
- Real thread ids live only in `.wakeflow-local/`; never write them to tracked
  docs, GitHub, prompts, or backfill, and never register placeholders.
- Target windows execute only their assigned packet and return a strict
  `wakeflow-target-result` TargetResult; they do not claim another target/controller role or
  create target-to-target next-hop delivery (a controller return needs
  `returnRoute=controller` plus a permitting dispatch-group policy). Test
  delivery is controller-started unless the plan and envelope authorize an
  exception. Old claim/finish/chain-next/start-plan/resume-plan routes are
  retired.
- Every newly authored full-context implementation task package must carry at
  least one controller-authored `acceptanceAnchor` derived from confirmed
  requirement authority. Research/documentation packages still carry the
  required `acceptanceAnchors` field as an empty array; legacy packages remain
  read-only compatibility input. Before
  coding, the target maps every `{anchorId,claim,probe,expected}` anchor to a RED
  test/probe; an untestable or conflicting anchor returns `needs-review`.
  Neither the controller nor target invents missing requirement scope through
  an anchor.
- Within one demand each repository has one active task lineage at a time and
  each target task owns one immutable TaskPackage. A package objective may
  contain coherent ordered steps, but there is no separate package `items`
  collection and a repository is never dispatched concurrent target tasks in
  the same demand. Host-created Pod
  product windows (`<repo>__<pod>`) exist only for explicitly authorized
  cross-demand isolation. Their integration disposition is human-reviewed; no
  controller merges or removes their worktrees.
- The mainline fleet is the default execution surface. A busy mainline waits;
  missing/unhealthy required identity returns `mainline-unavailable` before
  demand/TODO mutation and is repaired. It never silently creates an isolated
  demand.
- A demand pod exists only after an explicit user-authority anchor selects it.
  Wakeflow sets no numeric pod admission limit. Each pod owns independent
  `Controller__<pod>`, `Design__<pod>`, `Test__<pod>`, and product sessions.
  Wakeflow plans, binds, and verifies them. For a materialized Codex member,
  archive/handoff remains `manual-host-gate` and cannot by itself authorize
  logical close. The current
  public Pod lifecycle never creates, removes, or adopts a Git worktree or
  branch; those actions belong to the Codex host.
- Codex creates every pod product thread from the exact saved repository
  project with `environment.type=worktree`; Controller/Design/Test are distinct
  local control-project threads. Journal each create by launch correlation; a
  temporary `clientThreadId` is pending search/recovery evidence only and can
  never enter the registry. Freeze Pod Design with
  `wakeflow_pod_plan operation=design-request`. The current implementation freezes exactly one Pod
  Design request/handoff generation; that sole request may be `initial-design`,
  `supplement`, or `redesign`. A different second generation must stop as an
  unsupported capability rather than overwrite it or fall back to mainline Design. A pod reaches `control-ready` only
  after all three control receipts bind, and `execution-ready` only after its
  matching Design handoff and every required product receipt bind. Pod Test
  dispatch additionally requires validated `direct-multi-root` access to every
  active product binding; unsupported access stays blocked without fallback.
  A future authorized logical-close proof and Codex physical worktree cleanup
  remain separate facts.

Delivery-envelope fields, host-thread send mechanics, keep-live, and review flow
live in `skills/wakeflow-governance/references/wakeflow-delivery.md`,
`skills/wakeflow-controller/`, and `skills/wakeflow-target/`.

## Workspace Governance And Ledgers

- Project-specific active plans, TODOs, test exchanges, archives, and backfills
  belong in ignored `.wakeflow-active/` or the configured `../wakeflow-ledger/`;
  `.wakeflow-active/index.md` is the single active controller entry (local
  runtime, usually uncommitted), and larger requirement designs live in
  `../wakeflow-ledger/`. Product source/tests/docs commit in their own repos.
- Long-term documents must not contain user absolute paths, API keys, tokens, or
  private information. Use lowercase kebab-case names and execution dates.
- `wakeflow_view` with `operation: "storage"` is the local-storage map — every tree with
  class/size/age plus legacy, unknown, and aging preserved entries. Generated
  runtime directories do not carry in-place README authority. The only
  sanctioned installed-workspace rescue move is
  `wakeflow_storage_preserve` (`preview` first, then exact `apply`); unknown
  trees route to the user and are never auto-deleted.
- First installation uses `wakeflow_maintain_workspace` with
  `action: "fresh-initialize"` and `mode: "preview"`, then waits for user
  confirmation of the exact selection and confirmed plan before `apply`.
  There is no discovery/reset alias. Placement, index, and archive detail live in
  `skills/wakeflow-governance/references/wakeflow-ledgers.md`.

## Requirement-To-Wave Flow

- Design prepares the original plan, requirement design, completion definition,
  phase candidates, and TODO suggestions; the controller intakes them to the
  state root and decides research, Test cards, packages, phase confirmation, or
  execution. When valid implementation still misses the target in a non-bug way,
  route a Design redesign (product windows do not guess the new solution).
- Design's exit gate closes BEFORE first implementation dispatch, at the
  demand's scale (full gate for a requirement; lighter for bug/supplement):
  requirement design reconciled against real code facts, a landing plan
  (per-window breakdown + designIntent), non-goals, every open user question
  answered and recorded, and the Test decision — including a user-confirmed
  Test Environment Spec whenever real-scenario Test will be needed. A goal
  without these is Design work, not execution work.
- Test only tests: the controller selects the confirmed environment for each
  test card (from the Design-stage spec) and sends it in the card; Test never
  chooses environments, invents config values, or fixes product code. A missing
  input at any stage is routed to its owner (Design / user / bounded
  investigation), never guessed — the full S0→S6 route and per-stage gates live
  in `skills/wakeflow-governance/references/stage-route-map.md`.
- Supplemental requirements must not reverse original decisions, non-goals, or
  forbidden shortcuts, and must not split into placeholder / empty-adapter /
  type-only stages without a named consumer and targeted validation.
- Task-level confirmation states the original goal, requirement design,
  controller interpretation, completion definition, non-goals, affected windows,
  producer/consumer chain, phase plan, current-phase judgment, validation,
  risks, and questions. Create or activate execution waves only after user
  confirmation. Wave/package detail:
  `skills/wakeflow-governance/references/window-dispatch.md`.

## Scripts And Verification

- In an installed workspace, use `wakeflow_verify operation=inspect` for the
  strict machine verdict. Writing operations remain separate and require their
  exact preview/apply authority; verification never grants mutation authority.
- `scripts/README.md` catalogs the packaged v3 entrypoints and the explicit
  normal-runtime/migration boundary. Internal modules are not an alternate
  command surface.
- When maintaining Wakeflow source, use the repository gates (`npm run
  validate`, `npm run smoke`, `npm run check:core`, focused tests, and `npm
  test`) rather than invoking removed workspace utilities. Pipeline and
  maintenance detail live in
  `skills/wakeflow-governance/references/script-pipeline.md`.

## Standard Dispatch Prompt

A dispatch prompt is a bounded, priority-ordered briefing: objective; at most
two completion focuses; one priority context; one critical boundary; up to
four acceptance-anchor ids/claims; ordered navigation to the task package,
original requirement entry, workspace/repository instructions, current state
root, and derived Skills; then identity, return, and trace fields. The task
package owns complete context and boundaries, requirement documents own
original background, and Skills own execution procedure. The copyable template lives in
`skills/wakeflow-governance/references/window-dispatch.md`. Do not put
wave-specific window lists, blocked/observing decisions, validation commands,
forbidden paths, or automation manuals in `AGENTS.md`.

## Skill And Rule Layers

- `AGENTS.md` keeps Wakeflow identity, role boundaries, the controller posture, the
  dispatch/wave/acceptance process, repository protection, and validation
  requirements. The operator's stop-card, confirmation-gate, and decision-checklist
  discipline lives in the installed workspace's own `AGENTS.md` (its preserved local
  rules), not in this reusable file.
- Skills and references keep operation steps, command order, templates,
  examples, troubleshooting, and script details.

Reference map:

- `skills/wakeflow-governance/references/agents-rule-map.md`: old-rule
  migration, ownership, and optimization notes for this file.
- `skills/wakeflow-governance/references/wakeflow-architecture.md`: structure,
  AGENTS/skill/template/script organization.
- `skills/wakeflow-governance/references/todo-backlog.md`: TODO/Backlog intake,
  rolling, priority, and idle-window scheduling.
- `skills/wakeflow-governance/references/window-dispatch.md`: waves, task
  packages, window coverage, producer/consumer order, and copyable prompts.
- `skills/wakeflow-governance/references/testing-validation.md`: Test boundary,
  evidence interpretation, and validation choice.
- `skills/wakeflow-governance/references/script-pipeline.md`: script
  maintenance, Design intake, state-root/progress projections, and runtime
  checks.
- `skills/wakeflow-governance/references/wakeflow-ledgers.md`: document
  placement, indexes, archives, templates, and skill asset ledgers.
- `skills/wakeflow-governance/references/wakeflow-delivery.md`: dispatch
  packets, delivery envelopes, strict TargetResult records, controller review,
  and automation return.
- `skills/wakeflow-governance/references/phased-migration.md`: cross-repo
  migration, extraction, deletion, and release closure.
- `skills/wakeflow-target/`: target-window execution and strict TargetResult
  recording.
- `skills/wakeflow-controller/`: controller start, return, result review, and
  next-wave decisions.
- `templates/wakeflow-asset-bundle.json`: generated install carrier for the two
  localized demand-progress projection assets whose canonical sources live under
  `core/template-sources/`; the bundle is never an editable workspace scaffold.

The controller uses ONLY `wakeflow-controller` and `wakeflow-governance`; it does NOT use the
Design/Test window skills or the development window's `wakeflow-target-craft`. The controller is
the acceptance authority and does not write product code — code craft belongs to the windows it
dispatches.

Hard boundaries stay here. Operational details live in skills.

## Cross-Repository Integration, Deletion, And Compatibility Cleanup

- Shared capabilities should be fixed, verified, and committed in their source
  repositories first. Wakeflow uses configured local sources for development and
  acceptance when available.
- Check vendor/submodule/remote pointers only for release, plugin runtime, npm
  package, offline install, remote CI, or an explicit state-root requirement.
- Do not casually edit `vendor/*`. If a vendor source must change, treat it as
  an independent source-repository commit and sync it back.
- Cross-repository integration and deletion must be staged and recorded. Do not
  mix copy, integration, deletion, test repair, and release-script changes into
  one unrecoverable step.
- Delete only replaced duplicate implementations. Do not delete still-owned CLI,
  daemon, HTTP/API, dashboard, MCP, skill, channel, release, local enhancement,
  or platform capabilities.
- External deletion requires three facts: import scan is clean, replacement
  entrypoint is connected, and representative build/check/lint/smoke passed.
- Temporary compatibility code must record the consumer, reason, removal
  condition, cleanup trigger, and owner.
- Do not keep compatibility layers without a consumer and cleanup plan.

## Technical Stack And Verification

- Before changing a target repository, read that repository's own `AGENTS.md`.
  Follow the stricter rule when root and target rules both apply.
- Use the target repository's existing stack, scripts, imports, aliases, tests,
  formatting, package exports, and module boundaries.
- Comments follow the target repository's language and style rules. Add them
  where they clarify real business meaning, migration boundaries, state
  machines, branches, fallback reasons, compatibility paths, persistence
  impact, or verification; do not restate syntax.
- Runtime branches, fallback, downgrade, compatibility translation, skip,
  short-circuit, retry, cancellation, and error classification need clear logs
  or diagnostic events.
- Preserve data structures, sorting, budgets, state-machine meaning, error
  semantics, persistence behavior, and user-visible APIs.
- In an installed workspace, inspect the result with `wakeflow_verify`; do not
  infer validation from internal script output.
- When maintaining Wakeflow source, run the focused owner tests, `npm run
  sync:core`, `npm run check:core`, both artifact validators and smokes, and
  `npm test` before a release-ready handoff.
- If only long-term source documentation changed, run its focused contract test
  and `git diff --check` at minimum.
