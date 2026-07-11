# Wakeflow Agent Instructions

Wakeflow is a reusable controller capability for multi-window agent work. It is
not the parent workspace, not a product source repository, and not a sandbox for
managed projects. Product scope and window roles come from `wakeflow.config.json`
and local runtime config. `.wakeflow-local/wakeflow.config.json` may override
local installation details and must not be committed.

## Controller Posture

The controller is the workspace brain, not a dispatch table. Think first: any urge
to execute because a keyword, familiar command, script hint, or speed pressure looks
actionable is a hard stop until the safe operation and the explicit one-sentence next
step are clear. For a new request, analyze the feature, user scenario, completion
definition, local code, docs, tests, and release path before decomposing work.

- Machine envelopes are evidence-first: read the named state root, skill, dispatch
  group, task package, and evidence documents before acting; missing or conflicting
  references stop the work as missing evidence, pending decision, or blocked.
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
- Test handles real-scenario verification that the controller or product
  repository cannot safely reproduce alone. Test is not a default
  implementation queue; product defects return to the owning source repository.
- Product windows are repositories listed in `wakeflow.config.json` or local
  override. Each owns its source, tests, commits, evidence, and backfill.
- Wakeflow owns reusable controller runtime, plugin packaging, AGENTS
  installation, MCP capability surface, state roots, delivery envelopes, result
  envelopes, reducers, archive tools, templates, skills, and verification
  scripts.
- `host agent` means the external host capability, currently Codex. Do not
  confuse it with any managed product's internal agent.
- Codex subagents may assist controller and child windows with bounded parallel
  code search, log triage, test localization, and evidence summarization. Their
  output is advisory evidence; it never transfers dispatch, acceptance,
  state-machine writes, repository ownership, or user-confirmation authority.

Do not move responsibilities between repositories to make boundaries look tidy.
Boundary changes require a real caller, replacement entrypoint, and evidence.
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

The controller may auto-claim (init) a demand without a fresh user prompt ONLY from a
global TODO row that Design delivered with Auto Claim = yes, via `wakeflow_claim_next`:
that immutable delivery property is set once at `wakeflow_deliver` time and, for a
requirement, requires a linked Original Plan + Requirement Design, so it carries the
ready-row invariants plus design-key provenance. It is init-only — dispatch and
acceptance still require their own evidence and confirmation. The operator's broader
confirmation gates live in the installed workspace's own rules.

## Testing And Acceptance

- The controller self-validates anything that does not need a real project:
  Wakeflow script tests, document checks, state-machine checks, targeted units,
  probes, runtime JSON/log review, and lightweight integration checks.
- Do not hand known script, code, document, or state-machine defects to Test for
  rediscovery.
- Use Test only for real projects, cold-start/rescan, dashboard or runtime
  observation, daemon/job/log monitoring, reproduction/regression, or cross-repo
  integration evidence.
- Before tests, state the exact question, object boundary, what was already
  self-verified, why real scenario is required, success meaning, failure
  meaning, invalid conclusions, and stop conditions.
- **The confirmed requirement goal and requirement-stage Test plan remain the
  controller's alignment anchors at card intake, dispatch, and review.** A Test
  package must carry `testExecution`; Test may elaborate commands only with a
  step-to-anchor map, may use only listed Test skills, and must return an
  unmapped goal/gate/method as a change request before execution. The controller
  rejects evidence produced by a Test-invented target instead of adopting that
  target into later rework.
- Acceptance requires raw evidence review: user scenario, inputs, outputs,
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
  progress, bypass a blocker, or replace controller review.
- Automation packets and envelopes are transport data, not authority transfer.
  The controller may delete any automation that cannot prove its goal, state
  root, window, thread id, dispatch group, target task, and next-hop rule.
- Direct-thread dispatch is the normal transport; it does not make ordinary
  discussion, Design work, or single-window development unattended automation.
  In confirmed unattended mode, keep reviewing results, pulling evidence,
  deciding, and dispatching next eligible packages until final completion, a hard
  gate, user stop, no eligible TODO, or missing evidence that needs a human.
- After a real direct-thread send records `status=sent` with `readback.ok=true`,
  stop the send turn — do not sleep, poll, or wait. Keep-live is unattended
  support only, not task logic, transport, or acceptance evidence.
- Real thread ids live only in `.wakeflow-local/`; never write them to tracked
  docs, GitHub, prompts, or backfill, and never register placeholders.
- Target windows execute only their assigned packet and return a
  `TargetResultEnvelope`; they do not claim another target/controller role or
  create target-to-target next-hop delivery (a controller return needs
  `returnRoute=controller` plus a permitting dispatch-group policy). Test
  delivery is controller-started unless the plan and envelope authorize an
  exception. Old claim/finish/chain-next/start-plan/resume-plan routes are
  retired.
- Within one demand each repository runs exactly ONE window with ONE combined
  task package (the window self-sequences its items); a window is never
  dispatched two simultaneous tasks inside the same demand. Isolation worktree
  windows (`<repo>__<id>`, threads whose cwd is the worktree) exist for
  cross-demand isolation only; their surviving branches land on the
  pending-merges ledger, and merge-back is human-reviewed and decentralized —
  no controller merges them.
- Parallelism exists ONLY at the demand level, as demand pods: up to
  `maxActiveDemands` (default 2) demands run side by side, each in its own pod
  (own controller stamped into the state root, own isolation worktrees, own
  Test — a per-demand thread set opened via `wakeflow_pod_open`), mutually
  unaware. The WHOLE pod shares its demand's ONE worktree set: every window,
  Test included, works and verifies inside those worktrees, never on a main
  checkout. Branch merge-back is human-reviewed and decentralized; claiming
  past capacity fails closed.

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
- `wakeflow_view` (scope `storage`) is the local-storage map — every tree with
  class/size/age plus legacy, unknown, and aging preserved entries; in-place
  READMEs (seeded by `wakeflow-storage seed-readmes`) explain each tier next
  to the data. The only sanctioned manual-rescue move is `wakeflow-storage
  preserve`; unknown trees route to the user and are never auto-deleted.
- First installation runs discovery and waits for user confirmation before
  writing scope. Placement, index, and archive detail live in
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

- `node scripts/wakeflow-verify.mjs` is the default verification orchestrator.
- Writing scripts default to dry-run or explicit check; use `--write`/`--apply`
  only when the user goal or state root authorizes writes.
- `scripts/README.md` is the script index; after adding/renaming/deleting
  `scripts/*.mjs`, update it and run `node scripts/wakeflow-check-scripts.mjs`.
  State roots, boards, intake, cards, archives, and templates must keep
  script-readable formats. Pipeline and maintenance detail live in
  `skills/wakeflow-governance/references/script-pipeline.md`.

## Standard Dispatch Prompt

A dispatch prompt is a compact wakeup envelope: it navigates (read parent
`AGENTS.md`, the active index, the current controller doc, and the target
repository `AGENTS.md`; state window/repository identity; claim only the assigned
task; backfill evidence/boundaries/risks/next-steps when done) while the state
root, task package, and skills define the work. The copyable template lives in
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
  packets, delivery envelopes, target result envelopes, controller review, and
  automation return.
- `skills/wakeflow-governance/references/phased-migration.md`: cross-repo
  migration, extraction, deletion, and release closure.
- `skills/wakeflow-target/`: target-window execution and
  `TargetResultEnvelope` backfill.
- `skills/wakeflow-controller/`: controller start, return, result review, and
  next-wave decisions.
- `templates/wakeflow-template-bundle.json`: bundled starter workspace,
  Design/Test support surfaces, and Test-window progressive chain validation
  assets that Wakeflow expands during setup.

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
- Comments should be concise English comments that explain real business
  meaning, migration boundaries, state machines, branches, fallback reasons,
  compatibility paths, persistence impact, or verification.
- Runtime branches, fallback, downgrade, compatibility translation, skip,
  short-circuit, retry, cancellation, and error classification need clear logs
  or diagnostic events.
- Preserve data structures, sorting, budgets, state-machine meaning, error
  semantics, persistence behavior, and user-visible APIs.
- After creating or activating a phase confirmation or execution wave, run
  `node scripts/wakeflow-verify.mjs`.
- If scripts, script README, or script skills change, run
  `node scripts/wakeflow-verify.mjs --with-script-tests`.
- If only long-term docs changed, run workspace docs verification and
  `git diff --check` at minimum.
