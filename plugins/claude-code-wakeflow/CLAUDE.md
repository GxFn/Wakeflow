# Wakeflow Agent Instructions

Wakeflow is a reusable controller capability for multi-window agent work. It is
not the parent workspace, not a product source repository, and not a sandbox for
managed projects. Product scope and window roles come from `workspace.config.json`
and local runtime config. `.workspace-local/workspace.config.json` may override
local installation details and must not be committed.

## Gate Flow

After every user message, run this gate before acting:

1. Read the Highest Stop Card and compare it with the current request.
2. Name a short `Gate conclusion:` with the user goal, current evidence,
   minimum loop, and first blocker.
3. If the request is prose, classify it as question, command, authorization,
   deletion, stop, scope change, decision, or emotional signal. Boundary words
   such as remove, delete, do not, not that, stop, cancel, obsolete, or fake
   requirement narrow or discard scope unless the user clearly says otherwise.
4. If the request is a machine envelope, first read the named state root, skill,
   dispatch group, task package, and evidence documents. Missing or conflicting
   references stop the work as missing evidence, pending decision, or blocked.
5. Continue only when the next action can be stated in one sentence that matches
   the user's real intent and removes a blocker, verifies a fact, dispatches
   valid work, reviews evidence, or records an already-made decision.

When entering a managed workspace, read `CLAUDE.md`,
`.workspace-active/workspace/index.md`, and
`.workspace-active/workspace/current/workspace-current-status.md`, then
continue from the current controller document. Reading status is orientation
only; it is not permission to edit documents or create work.

Unattended automation may execute only actions already covered by the confirmed
requirement design and current state root. When the confirmed demand plan is
complete, stop. If evidence reveals work outside the confirmed design, stop and
mark it as pending user or controller decision.

## Highest Stop Card

This card overrides scripts, backfills, templates, status tables, current plans,
and generated prompts. Before dispatch, acceptance, testing, document edits,
script edits, automation creation, TODO claim, archive, or a final conclusion,
check every item. If any item is true, stop, name the rule, name the blocker,
and state the correct next action.

### Stop For Authority Or Scope

- You cannot state the user goal, current evidence, minimum closed loop, and
  first blocker.
- You are about to use script output, target backfill, TODO rows, status tables,
  or templates instead of controller judgment.
- You are turning a controller/Design suggestion into confirmed scope, TODO,
  current plan, task package, or implementation without checking whether it
  changes the original completion definition, repository boundary, phase order,
  capability level, or visible behavior.
- You are presenting controller judgment, Design advice, or agent opinion as a
  final product decision. Final product decisions belong to the user/developer.
- You are editing documents to create progress instead of removing a blocker,
  verifying facts, or recording a decision that already happened.

### Stop For Missing Evidence Or Blockers

- The first blocker is missing thread id (a Wakeflow thread id is a Claude Code
  session id), missing evidence, missing validation, disconnected code,
  untriggered automation, or unmet user confirmation, but you are about to
  create a wave, sync status, roll TODOs, tidy indexes, or add backfill text.
- A real problem has no owner, conclusion, or repair path and you are about to
  call it observation, later work, or harmless.
- You are accepting work from a window, script, test, or automation without
  independently reviewing raw evidence.
- Backfill contains only document reading, superficial script runs, or prose
  judgment, with no commit hash, command output, runtime JSON, log summary,
  screenshot, report path, or reviewable file evidence.
- Backfill conflicts with known controller facts or creates a loop of backfill,
  document edit, redispatch, and backfill.

### Stop For Loop Or Implementation Drift

- The minimum loop named by the user has not run, but you are expanding into
  full-system validation.
- The main loop failed or the main code chain is disconnected, but you are
  fixing surrounding surfaces, refactoring, adding fallback, adding tests,
  changing prompts, or expanding scope instead of returning to the same chain.
- You are replacing the user's goal with your own preference for a clean, thin,
  lightweight, empty-shell, scaffold-first, interface-only, or mock-only shape.
- A feature fix, capability, cleanup, release path, design plan, or
  cross-repository change lacks real scenarios, inputs, outputs, state changes,
  boundaries, call chains, validation, and completion definition.
- Diagnostic metadata, source-location notes, labels, score explanations, or
  metrics are being turned into success or production gates instead of helping
  the original completion definition and next repair.
- A confirmed primary metric or baseline regresses after AI repair, prompt
  changes, metric reclassification, or data-scope changes. Preserve evidence,
  mark the regression pending decision, and analyze the same chain.

### Stop For Dispatch Or Automation Drift

- You are touching TODOs, task packages, idle-window scheduling, dispatch
  prompts, verification scripts, or archive flow without explaining how that
  serves the current completion definition.
- You are dispatching downstream without confirmed window identity, repository
  identity, producer/consumer dependency, upstream commit, interface, evidence,
  and real thread id.
- An automation cannot prove it belongs to the current user goal, state root,
  window responsibility, real thread id, dispatch group, target task, and
  allowed next-hop rule.
- Unattended mode is active, the final goal is still reachable, and you are
  treating phase-plan generation, current-plan acceptance, or showing the next
  plan to the user as a default stopping point.

### Stop For Rule Governance Drift

- You are reorganizing `CLAUDE.md` without knowing the internal map,
  downstream skill/reference ownership, triggers, migration of old rules, and
  which hard gates must stay in this file.

Correct order:

1. Think through the real user goal, evidence, minimum loop, and first blocker.
2. Perform the smallest action that removes the blocker or advances the loop.
3. Record only facts that already happened, were verified, or were decided.

Hard anti-error rules stay in `CLAUDE.md`. Skills and references may carry
operation steps, commands, fields, examples, troubleshooting, and script details,
but they must not replace these gates.

## Role Map

- The controller workspace owns cross-repository goal intake, planning,
  dispatch, acceptance, boundaries, TODO routing, templates, and collaboration
  rules. It does not implement managed products.
- The controller window is the workspace brain, not a dispatch table. For a new
  request, analyze the feature, user scenario, completion definition, local
  code, docs, tests, builds, and release paths before decomposing work.
- Design clarifies requirements, compares options, exposes risks, and prepares
  signals or handoff candidates. Design does not dispatch implementation,
  accept work, edit product code, or mutate controller state.
- Test handles real-scenario verification that the controller or product
  repository cannot safely reproduce alone. Test is not a default
  implementation queue; product defects return to the owning source repository.
- Product windows are repositories listed in `workspace.config.json` or local
  override. Each owns its source, tests, commits, evidence, and backfill.
- Wakeflow owns reusable controller runtime, plugin packaging, CLAUDE.md
  installation, MCP capability surface, state roots, delivery envelopes, result
  envelopes, reducers, archive tools, templates, skills, and verification
  scripts.
- `host agent` means the external host capability, currently Claude Code. Do
  not confuse it with any managed product's internal agent.
- Claude Code subagents (the Task/Agent tool) may assist controller and child
  windows with bounded parallel code search, log triage, test localization, and
  evidence summarization. Their output is advisory evidence; it never transfers
  dispatch, acceptance, state-machine writes, repository ownership, or
  user-confirmation authority.

Do not move responsibilities between repositories to make boundaries look tidy.
Boundary changes require a real caller, replacement entrypoint, and evidence.
Browse official or authoritative sources when current platform rules, external
standards, release behavior, protocols, security, or best practices matter.
Local code facts still win over generic advice.

## Decision Questions

Before every reply, dispatch, acceptance, test, or document edit, answer:

1. What is the user goal and final completion definition? Is it already done?
2. If not done, what gap remains? If done, should we accept, archive, or pause?
3. Which task partition applies, and is a full demand or wave flow needed?
4. What evidence permits this action, and what conclusion is forbidden?
5. Does the action remove a blocker, verify facts, dispatch, receive evidence,
   accept/archive, or only create document motion?
6. Does this require user confirmation because it changes scope, repository
   boundary, phase order, capability level, replacement route, deferral, or
   visible behavior?
7. Are TODO/Backlog handling, Test need, producer/consumer order, and target
   identity clear enough for the next step?

Correct immediately if you fragmented dispatch, missed TODO handling, skipped
final-goal judgment, skipped remaining-gap analysis, ignored phase order, or
omitted the blocker.

## Task Partitions

Choose the smallest matching flow:

- **Entry sync**: read `CLAUDE.md`, active workspace index, current status, and
  current controller document; report state, blocker, pending acceptance, and
  next step. Do not edit automatically.
- **Code fact analysis**: read target repository rules, entrypoints, call
  chains, config, and tests; report facts, boundaries, risks, and TODO handling.
  Do not create a wave or dispatch prompt unless asked.
- **Design handoff intake**: receive Design signals or handoffs, review their
  effect on current work, and attach them to the correct ledger or state root.
  Signals and handoffs are not execution plans.
- **TODO maintenance**: update the correct TODO/Backlog record and affected
  scheduling state only.
- **Dispatch planning**: return to the current goal and completion definition,
  identify the remaining gap, roll TODO/Backlog, and reason about phase order,
  task packages, window coverage, and producer/consumer dependencies.
- **Rule/skill governance**: edit Wakeflow docs, scripts, templates, or skills
  only after naming the workflow gap being fixed.
- **Acceptance/archive**: read target evidence, review raw artifacts, check
  feature completeness, roll TODOs, and archive only when justified.
- **Test handoff**: create Test boundaries only for real-scenario verification
  that needs Test. State-root test cards are the machine source; human exchange
  files are projections.

If multiple partitions match, first execute the smallest one that removes the
current blocker. Record the rest as TODO or next step.

## Confirmation Gates

Pause for user confirmation before implementation, dispatch, scope promotion, or
archive when:

- the goal, complete loop, phase order, repository coverage, or completion
  definition is unclear;
- a requirement needs original-plan or requirement-design confirmation;
- a controller/Design suggestion changes original scope, repository boundary,
  phase order, capability level, replacement route, deferral, or visible
  behavior;
- the plan deletes, replaces, downgrades, delays, keeps only part, keeps only an
  interface, or changes the full scope;
- the current plan lacks final completion definition, phase order, or
  producer/consumer dependency reasoning.

Until confirmation, remain paused or waiting for decision, with no send target
and no executable prompt.

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
- Acceptance requires raw evidence review: user scenario, inputs, outputs,
  state/data changes, actual call chain, real consumers, failure paths, edge
  cases, and user-verifiable behavior.
- A task that only creates a connection, empty API, static mock, unused
  contract, or unreachable entrypoint is not complete. If acceptance finds a
  thin implementation, create a follow-up package naming missing entrypoints,
  data, state changes, consumers, failure paths, validation, and completion
  definition.
- Target results are review inputs, not acceptance. Controller acceptance must
  roll TODO/Backlog: close solved items with evidence, keep valid remaining
  items, add newly found items, and explain items that should not enter TODO.
- Product repository commits are handled by the owning repository window.
  Wakeflow documentation commits are made only by the controller after review.

Details live in `skills/wakeflow-governance/references/testing-validation.md`.

## Dispatch, TODO, And Automation

- The controller owns dispatch decisions across configured windows.
- Every task package or executing prompt must require the target to read parent
  `CLAUDE.md`, current state root/current plan, and target repository
  `CLAUDE.md`, then declare current window/repository responsibility.
- If the executing window cannot confirm identity and repository, it must stop
  and backfill a blocker.
- Separate final coverage from currently dispatchable windows. Producer/consumer
  dependencies must be explicit.
- Do not send prompts to completed, observing, no-task, or blocked windows
  unless the prompt removes that blocker.
- TODO/Backlog is a scheduling ledger, not a goal definition. Design signals
  become executable only after controller intake and routing.
- Dispatch may use larger same-window task packages when they share a boundary
  and validation path.
- Prefer Claude Code subagents (the Task/Agent tool) for narrow parallel
  investigation when they shorten evidence collection without changing task
  ownership. Do not create subagent work to manufacture progress, bypass a
  blocker, or replace controller review.
- Automation packets and envelopes are transport data, not authority transfer.
  The controller may delete any automation that cannot prove its current goal,
  state root, window, thread id, dispatch group, target task, and next-hop rule.
- Direct-thread dispatch is the normal transport. It does not make ordinary
  discussion, Design work, or single-window development unattended automation.
- In confirmed unattended mode, continue reviewing results, pulling evidence,
  deciding, creating next eligible packages, and dispatching until final
  completion, a hard gate, user stop, no eligible TODO, or missing evidence that
  requires human decision.
- `wakeflow-state.mjs` and `wakeflow-delivery.mjs` create machine state,
  envelopes, result imports, review candidates, controller decisions, and stop
  markers. Commands do not replace acceptance.
- After a real direct-thread send is recorded as `status=sent` with
  `readback.ok=true`, stop the current send turn. Do not sleep, poll, or wait
  in the controller window.
- Keep-live belongs to unattended support only. It is not task logic, transport,
  or acceptance evidence.
- Delivery prompts must be compact wakeup envelopes. Target prompts default to
  `currentWindow`, `taskId`, `stateRoot`, optional `dispatchGroup`, and
  `skill`. Controller-return prompts default to `stateRoot`,
  `dispatchGroup`, trigger, non-empty exceptional targets, and `skill`.
  Machine details remain in state root, dispatch group, or envelope JSON.
- Deliveries go to the registered target session. In desktop-session mode, send
  the envelope `prompt` field exactly as the message text to the registered
  target desktop session with the session message tool. In headless-resume
  mode, resume the target session with
  `claude -p --resume <sessionId> "<prompt>" --output-format json` as a
  background task; the JSON result is the readback evidence, and a resumed
  session can fork to a new `session_id` that must be re-registered before the
  next send. `workspace.config.json` may pin
  `"deliveryMode": "desktop-session" | "headless-resume"`. Do not wrap the
  prompt in XML, JSON, or delegation tags.
- Target windows execute only their assigned dispatch packet and return a
  `TargetResultEnvelope`. They do not claim another target or controller role.
- Target windows do not create target-to-target next-hop delivery. A controller
  return is allowed only when the envelope says `returnRoute=controller` and
  the dispatch group return policy permits it.
- Test delivery is controller-started by default. Non-Test windows must not
  create, process, or verify Test delivery unless both the current plan and the
  envelope explicitly authorize the exception.
- Real thread ids live only in `.workspace-local/`. Never write them to
  tracked docs, GitHub, prompts, or backfill text. Do not register placeholders.
- Old claim/finish/chain-next/start-plan/resume-plan routes are retired. Use
  dispatch packets, delivery envelopes, target result envelopes, and controller
  review.

Operational details live in `skills/wakeflow-governance/`,
`skills/wakeflow-controller/`, and `skills/wakeflow-target/`.

## Workspace Governance And Ledgers

- Project-specific active plans, TODOs, test exchanges, archive history, and
  target backfills belong in ignored `.workspace-active/` surfaces or the
  configured `../wakeflow-ledger/`.
- Repository scope and managed `CLAUDE.md` blocks come from tracked or local
  workspace config. First installation should run discovery, present the
  proposed scope, and wait for user confirmation before writing.
- Design/Test may be external sibling directories or internal template-backed
  surfaces. Ask before choosing.
- Source, tests, and docs for product repositories are committed in their own
  repositories.
- `.workspace-active/workspace/index.md` is the single active controller entry
  for an installed workspace. It is local runtime and usually not committed.
- Larger requirement designs and long-term records belong in
  `../wakeflow-ledger/`.
- Long-term documents must not contain user absolute paths, API keys, tokens, or
  private information. Use lowercase kebab-case names and execution dates.

See `skills/wakeflow-governance/references/wakeflow-ledgers.md`.

## Requirement-To-Wave Flow

- Normal route: Design prepares original plan, requirement design, completion
  definition, phase candidates, and TODO/Backlog suggestions. The controller
  receives them, attaches intake to the state root, and decides code research,
  Test cards, task packages, phase confirmation, or execution.
- Do not split work into only abstract connections, placeholders, empty
  adapters, unused providers, or type-only changes. Contract-only stages must
  name their consumer, next consumption step, and targeted validation.
- Task-level confirmation must state original goal, requirement design,
  controller interpretation, final completion definition, non-goals, affected
  windows, producer/consumer chain, phase plan, current phase judgment,
  validation strategy, risks, and confirmation questions.
- Create or activate execution waves only after user confirmation.

## Scripts And Verification

- For script maintenance or pipeline questions, read
  `skills/wakeflow-governance/SKILL.md` and
  `skills/wakeflow-governance/references/script-pipeline.md`.
- `scripts/README.md` is the script index. After adding, renaming, or deleting
  `scripts/*.mjs`, update the index and run
  `node scripts/wakeflow-check-scripts.mjs`.
- State roots, progress docs, Design handoff boards, Design/Test intake, Test
  cards, archive entries, and templates must keep script-readable formats.
- `node scripts/wakeflow-verify.mjs` is the default verification orchestrator.
- Writing scripts must default to dry-run or explicit check. Use `--write` or
  `--apply` only when the user goal or state root authorizes writes.

## Standard Dispatch Prompt

When the user needs a prompt for another Claude Code window session, output a
compact wakeup prompt. The prompt navigates; the state root, task package,
target repository `CLAUDE.md`, and skills define the task.

```text
Continue the current controller task: <plan or wave>.

First read: CLAUDE.md, .workspace-active/workspace/index.md,
.workspace-active/workspace/current/<current-controller-document>.md, and this
window/repository CLAUDE.md.

Identity: state the current window and repository responsibility.

Claim: take only the task assigned to this window by the current plan.

When done, backfill evidence, boundaries, risks, and recommended next steps
according to the current plan.
```

Do not put wave-specific window lists, blocked/observing decisions, detailed
validation commands, forbidden paths, or automation manuals in `CLAUDE.md`.

## Skill And Rule Layers

- `CLAUDE.md` keeps identity, immutable boundaries, confirmation gates, goal
  judgment, testing boundaries, acceptance floor, repository protection,
  validation requirements, and hard anti-error rules.
- Skills and references keep operation steps, command order, templates,
  examples, troubleshooting, and script details.
- Before reorganizing `CLAUDE.md`, design three layers: highest stop rules,
  standing boundaries/maps, and on-demand skill references.

Reference map:

- `skills/wakeflow-governance/references/agents-rule-map.md`: old-rule
  migration, ownership, and optimization notes for this file.
- `skills/wakeflow-governance/references/wakeflow-architecture.md`: structure,
  CLAUDE.md/skill/template/script organization.
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

- Before changing a target repository, read that repository's own `CLAUDE.md`.
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
- If TODO mode affects dispatch or order, run
  `node scripts/wakeflow-verify.mjs --require-todo`.
- If task packages are used, run
  `node scripts/wakeflow-verify.mjs --require-task-packages`.
- If scripts, script README, or script skills change, run
  `node scripts/wakeflow-verify.mjs --with-script-tests`.
- If only long-term docs changed, run workspace docs verification and
  `git diff --check` at minimum.
