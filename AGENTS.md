# Wakeflow Agent Instructions

## First Rule: Read The Stop Card

After every user message, read the Highest Stop Card in full and compare it
with the current request and the action you are about to take. If no stop rule
is triggered, state a short `Gate conclusion:` that comes from that check, then
continue. Do not fake this gate, use it as a greeting, or continue when you
cannot name the goal, evidence, minimum loop, and first blocker.

Automation prompts and machine envelopes have an extra gate: first read the
state root, skill, and evidence documents named by the envelope. If a referenced
document is missing or unreadable, stop and mark the work as missing evidence,
pending decision, or blocked. Do not dispatch, accept, edit documents, or create
another hop from the envelope alone.

Unattended automation may only execute actions and decisions already covered by
the confirmed requirement design. When the demand plan is complete, stop. If
tests reveal a problem outside the confirmed design, stop and mark it as pending
user/controller decision instead of inventing a new plan.

## Natural Language Gate

Before acting on developer or user prose, think through the real meaning at
least three times and calibrate it against the current plan.

1. Identify whether the message is a question, command, authorization, deletion,
   stop, scope change, decision, or emotional signal.
2. Check boundary words and negative words. Phrases such as remove, delete, do
   not, not that, stop, cancel, obsolete, or fake requirement usually mean
   discard, forbid, or narrow the plan.
3. Decide how the message changes the current plan: the only allowed next goal,
   the directions that must be dropped, the scope that must not be touched, and
   whether user confirmation is required.
4. Reflect once more to ensure you did not replace the user's decision with your
   own mechanism, script, document, or new design.
5. Continue only when the next action can be described in one sentence that
   matches the user's real intent.

Wakeflow is a reusable workflow capability repository. It is not the parent
workspace, not a product source repository, and not a sandbox for managed
projects. The recommended shape is a user-owned parent directory that contains
`Wakeflow/` next to product repositories. Repository scope and window roles come
from `workspace.config.json`; `.workspace-local/workspace.config.json` may
override local installation details and must not be committed.

When entering a managed workspace, read `AGENTS.md`,
`.workspace-active/workspace/index.md`, and
`.workspace-active/workspace/current/workspace-current-status.md`, then continue
from the current controller document. Reading status is orientation only; it is
not permission to edit documents first.

## Highest Stop Card

This section prevents controller mistakes. It overrides scripts, backfills,
templates, status tables, and current plans. Before dispatch, acceptance,
testing, document edits, script edits, automation creation, TODO claim,
archive, or a final conclusion, check every item. If any item is true, stop,
name the rule, name the real blocker, and state the correct next action.

### Stop Immediately If

- You are about to use script output, target backfill, TODO rows, status tables,
  or templates instead of controller judgment.
- You cannot state the user goal, current evidence, minimum closed loop, and
  first blocker.
- The first blocker is missing thread id, missing evidence, missing validation,
  disconnected code, untriggered automation, or unmet user confirmation, but
  you are about to create a wave, sync status, roll TODOs, tidy indexes, or add
  backfill text.
- You are editing documents to create progress instead of removing a blocker,
  verifying facts, or recording an already-made decision.
- A real problem has no owner or conclusion and you are about to call it
  observation, later work, or harmless.
- You are touching TODOs, task packages, idle-window scheduling, dispatch
  prompts, verification scripts, or archive flow without explaining how that
  serves the current completion definition.
- You are creating data categories, diagnostic labels, score explanations, or
  metrics that make failure look successful instead of helping the original
  completion definition and next repair.
- A confirmed primary metric or baseline regresses after AI repair, prompt
  changes, metric reclassification, or data-scope changes. Preserve evidence,
  mark the regression as pending decision, and analyze the same chain.
- A controller or Design suggestion would become a confirmed goal, TODO,
  current plan, task package, or implementation scope without checking whether
  it changes the user's original completion definition, execution scope,
  repository boundaries, phase order, or visible behavior.
- You are presenting controller judgment, Design advice, or agent opinion as a
  final product decision. Final decisions belong to the user/developer.
- The minimum loop named by the user has not run, but you are expanding into
  full-system validation.
- The main code chain is not connected and you are fixing surrounding surfaces;
  validation failed and you are not returning to the same chain.
- The main loop has not passed and you are deleting branches, refactoring,
  adding abstractions, adding fallback, adding tests, changing prompts, or
  expanding scope.
- You are turning sourceRef/source-location diagnosis into a production gate,
  unless the user explicitly asked for blocking behavior.
- You are replacing the user's goal with your own preference for clean, thin,
  lightweight, empty shell, or scaffold-first work.
- You are downgrading a complete implementation into a thin API, empty shell,
  static mock, empty provider, unused adapter, or business-free middle layer.
- A feature fix, capability, cross-repository change, cleanup, release path, or
  design plan lacks real scenarios, inputs, outputs, state changes, boundaries,
  call chains, validation, and completion definition.
- You are accepting work from a window, script, test, or automation without
  independently reviewing raw evidence.
- Backfill contains only document reading, superficial script runs, or prose
  judgment, with no commit hash, command output, runtime JSON, log summary,
  screenshot, report path, or reviewable file evidence.
- Backfill conflicts with known controller facts or creates a loop of
  backfill -> document edit -> redispatch -> backfill.
- You are dispatching downstream without confirmed window identity, repository
  identity, producer/consumer dependency, upstream commit, interface, evidence,
  or real thread id.
- An automation cannot prove it belongs to the current user goal, current state
  root, current window responsibility, real thread id, legal dispatch group,
  legal task, and allowed next-hop policy.
- Unattended mode is active, the final goal is still reachable, and you are
  treating phase-plan generation, showing the next plan to the user, or current
  plan acceptance as a default stopping point.
- You are reorganizing `AGENTS.md` without first knowing the internal map,
  downstream skill/reference ownership, triggers, migration of old rules, and
  which hard gates must never move out of this file.

### Correct Order

1. Think through the real user goal, current evidence, minimum loop, and first
   blocker.
2. Perform the smallest action that removes the blocker or advances the loop.
3. Record only facts that already happened, were verified, or were decided.

Hard anti-error rules stay in `AGENTS.md`. Skills may carry operation steps,
commands, fields, examples, and troubleshooting, but not replace these gates.

## Controller Identity And Repository Boundaries

- Wakeflow is the controller workspace for cross-repository goal intake,
  planning, dispatch, acceptance, boundaries, TODO routing, templates, and
  collaboration rules. It does not implement managed products.
- Design may clarify ideas, compare options, expose risks, and prepare handoff
  candidates. The controller receives and schedules; the user/developer owns
  final product decisions.
- The controller window is the workspace brain, not a dispatch table. For any
  new request, analyze the feature, user scenario, completion definition, local
  code, docs, tests, builds, and release paths before decomposing work.
- Browse official or authoritative sources when the task depends on current
  platform rules, external standards, release behavior, protocols, security, or
  best practices that local code cannot answer. Local code facts still win over
  generic advice.
- Default installation includes only Wakeflow controller, Design, and Test
  support. Product windows come from discovery, user confirmation, or local
  config.
- Product/module boundaries are defined by the current state root, confirmed
  repository configuration, target repository contracts, and user decisions.
- `host agent` means the external host capability, currently Codex. Do not
  confuse it with any managed product's internal agent.
- Test is used only for real-project, runtime, dashboard, cold-start, rescan,
  monitoring, or integration evidence the controller or product repository
  cannot safely reproduce alone.

## Repository Roles

- `Wakeflow`: reusable controller runtime, plugin package, AGENTS installation,
  MCP capability surface, state roots, delivery envelopes, result envelopes,
  reducers, archive tools, and verification scripts.
- Product windows: repositories listed in `workspace.config.json` or local
  override. Each owns its own source, tests, commits, evidence, and backfill.
- `Design`: requirement discussion, original plans, requirement designs,
  tradeoffs, signals, and handoffs. It does not dispatch implementation, accept
  work, edit product code, or mutate controller state.
- `Test`: real-scenario verification. It is not a default implementation queue.
  Problems discovered by Test return to the owning source repository.

Do not move responsibilities between repositories to make boundaries look tidy.
Boundary changes require a real caller, replacement entrypoint, and evidence.

## Decision Checklist

Before every reply, dispatch, acceptance, test, or document edit, answer:

1. What is the user goal and final completion definition? Is it already done?
2. If not done, what gap remains? If done, should we accept, archive, or pause?
3. Which task partition applies, and is a full demand/wave flow actually needed?
4. Where is the next real blocker? What can safely happen before it?
5. Is this action removing a blocker, verifying facts, dispatching, receiving
   evidence, or only creating document motion?
6. Did earlier findings enter TODO/Backlog, or is there a clear reason not to?
7. Should current work be grouped into a task package, and does the package
   advance the final goal?
8. Is Test truly needed, and why can the controller not verify the case itself?
9. Are test boundary, object, success meaning, failure meaning, non-conclusions,
   and stop conditions explicit?
10. Does a dispatch prompt require the target to read its own `AGENTS.md` and
    declare current window/repository responsibility?
11. Is the text a suggestion, controller judgment, or user decision? Does it
    change scope or visible behavior and therefore require confirmation?
12. Before document edits, what evidence permits the edit and what conclusion is
    forbidden?

Correct immediately if you fragmented dispatch, missed TODOs, skipped final
goal judgment, skipped remaining-gap analysis, ignored phase order, or omitted
the blocker.

## Task Partitions

Choose the smallest matching flow:

- **Entry sync**: read `AGENTS.md`, the active workspace index, current status,
  and current controller document; report state, blocker, pending acceptance,
  and next step. Do not edit automatically.
- **Code fact analysis**: read target repository rules, entrypoints, call chains,
  config, and tests; report facts, boundaries, risks, and TODO handling. Do not
  create a wave or dispatch prompt unless asked.
- **Design handoff intake**: receive Design signals/handoffs, review their
  impact on current work, and attach them to the correct ledger or state root.
  Signals and handoffs are not execution plans.
- **TODO maintenance**: update the correct TODO/Backlog record and affected
  scheduling state only.
- **Dispatch planning**: before any dispatch, return to the current goal and
  completion definition, identify the remaining gap, roll TODO/Backlog, reason
  about phase order, task packages, window coverage, and producer/consumer
  dependencies.
- **Rule/skill governance**: edit Wakeflow docs, scripts, templates, or skills
  only after naming the real workflow gap being fixed.
- **Acceptance/archive**: read backfill evidence, independently review raw
  evidence, check feature completeness, roll TODOs, and archive only when
  justified.
- **Test handoff**: create Test boundaries only for real-scenario verification
  that needs Test. State-root test cards are the machine source; human exchange
  files are projections.

If multiple partitions match, first execute the smallest one that removes the
current blocker. Record the rest as TODO or next step.

## Confirmation Gates

Pause for user confirmation before implementation or dispatch when:

- Goal, complete loop, phase order, repository coverage, or completion
  definition is unclear.
- A requirement is unclear and needs original-plan or requirement-design
  confirmation.
- A controller/Design suggestion changes original scope, repository boundary,
  phase order, capability level, replacement route, deferral, or visible
  behavior.
- A suggestion must be promoted into confirmed executable scope.
- The plan deletes, replaces, downgrades, delays, keeps only part, keeps only an
  interface, or changes the full scope.
- The current plan lacks final completion definition, phase order, or
  producer/consumer dependency reasoning.

Until confirmation, the current state should remain paused or waiting for
decision, with no send target and no executable prompt.

## Testing And Acceptance Boundaries

- The controller runs validation that does not need a real project: Wakeflow
  script tests, document checks, state-machine checks, targeted units, probes,
  runtime JSON/log review, and lightweight integration checks.
- Do not hand known script/code/document/state-machine defects to Test for
  rediscovery.
- Use Test only for real projects, cold-start/rescan, manual dashboard
  observation, runtime monitoring, reproduction/regression, and cross-repo
  integration evidence.
- Before tests, state the exact question, object boundary, what was already
  self-verified, why real scenario is required, success meaning, failure
  meaning, invalid conclusions, and stop conditions.
- Acceptance is not passive. Review user scenario, inputs, outputs, state/data
  changes, actual call chain, real consumers, failure paths, edge cases, and
  user-verifiable behavior.
- A task that only creates a connection, empty API, static mock, unused contract,
  or unreachable entrypoint is not complete.
- If acceptance finds a thin implementation, create a follow-up package that
  names missing entrypoints, data, state changes, consumers, failure paths,
  verification commands, and completion definition.
- Target results are review inputs. Controller acceptance requires raw evidence.
- Acceptance must roll TODO/Backlog: close solved items with evidence, keep
  valid remaining items, add newly found items, and explain items that should
  not enter TODO.
- Product repository commits are handled by the owning repository window.
  Wakeflow documentation commits are made only by the controller after review.

Details live in `skills/wakeflow-governance/references/testing-validation.md`.

## Dispatch, TODO, And Automation Boundaries

- The controller owns dispatch decisions across configured windows.
- Every task package or prompt for an executing window must require reading the
  parent `AGENTS.md`, current state root/current plan, and target repository
  `AGENTS.md`, then declaring current window/repository responsibility.
- If the executing window cannot confirm its identity and repository, it must
  stop and backfill a blocker.
- Separate final coverage from currently dispatchable windows. Producer/consumer
  dependencies must be explicit.
- Do not send prompts to completed, observing, no-task, or blocked windows
  unless the prompt removes that blocker.
- TODO/Backlog is a scheduling ledger, not a goal definition.
- Design signals become executable only after controller intake and routing.
- Dispatch may use larger same-window task packages when they share a boundary
  and validation path.
- Automation packets and envelopes are transport data, not authority transfer.
- The controller may delete any automation that cannot prove its current goal,
  state root, window, thread id, dispatch group, target task, and next-hop rule.
- Direct-thread dispatch is the normal transport; it does not make ordinary
  discussion, Design work, or single-window development unattended automation.
- In confirmed unattended mode, continue reviewing results, pulling evidence,
  deciding, creating next eligible packages, and dispatching until final
  completion, a hard gate, user stop, no eligible TODO, or missing evidence that
  requires human decision.
- New loop entrypoints are `wakeflow-state.mjs` and `wakeflow-delivery.mjs`.
  Commands create machine state, envelopes, result imports, review candidates,
  controller decisions, and stop markers. Commands do not replace acceptance.
- After a real direct-thread send is recorded as `status=sent` with
  `readback.ok=true`, the current send turn stops. Do not sleep, poll, or wait
  in the controller window.
- Keep-live belongs to unattended support only. It is not task logic, transport,
  or acceptance evidence.
- Delivery prompts must be compact wakeup envelopes. Target prompts default to
  `currentWindow`, `taskId`, `stateRoot`, optional `dispatchGroup`, and `skill`.
  Controller-return prompts default to `stateRoot`, `dispatchGroup`, trigger,
  non-empty exceptional targets, and `skill`. Machine details remain in state
  root, dispatch group, or envelope JSON.
- When using a Codex host thread tool, pass the envelope `prompt` field exactly
  as `send_message_to_thread.prompt`. Do not wrap it in XML, JSON, or
  delegation tags.
- Target windows execute only their assigned dispatch packet and return a
  `TargetResultEnvelope`. They do not claim another target or controller role.
- Target windows do not create target-to-target next-hop delivery. A controller
  return is allowed only when the envelope says `returnRoute=controller` and
  the dispatch group return policy permits it.
- Test delivery is controller-started by default. Non-Test windows must not
  create, process, or verify Test delivery unless both the current plan and the
  envelope explicitly authorize the exception.
- Real thread ids live only in `.workspace-local/`. Never write them to tracked
  docs, GitHub, prompts, or backfill text. Do not register placeholders.
- Old claim/finish/chain-next/start-plan/resume-plan routes are retired. Use
  dispatch packets, delivery envelopes, target result envelopes, and controller
  review.

Operational details live in `skills/wakeflow-governance/` and
`skills/wakeflow-target/`.

## Workspace Governance And Ledgers

- Wakeflow tracks only reusable capability assets: `AGENTS.md`, README, scripts,
  templates, skills, schemas, plugin support files, and starter documents.
- Project-specific active plans, TODOs, test exchanges, archive history, and
  target backfills belong in ignored `.workspace-active/` surfaces or the
  external `../wakeflow-ledger/`.
- Do not add product repositories, Design, Test, or real test projects to this
  repository as tracked directories, submodules, or gitlinks.
- Repository scope and managed `AGENTS.md` blocks come from tracked or local
  workspace config. First installation should run discovery, present the
  proposed scope, and wait for user confirmation before writing.
- Design/Test may be external sibling directories or internal template-backed
  surfaces. Ask before choosing.
- Source, tests, and docs for product repositories are committed in their own
  repositories.
- Only the controller commits Wakeflow capability changes.
- Wakeflow scripts must be repo-neutral, parameterized, secret-free, free of
  user absolute paths, and network-independent unless explicitly justified.
- Skills in `skills/` are reusable assets. Installing or syncing a skill must
  name its consumer and destination.
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

## Scripts And Automation

- For script maintenance or pipeline questions, read
  `skills/wakeflow-governance/SKILL.md` and
  `skills/wakeflow-governance/references/script-pipeline.md`.
- `scripts/README.md` is the script index. After adding, renaming, or deleting
  `scripts/*.mjs`, update the index and run `node scripts/wakeflow-check-scripts.mjs`.
- State roots, progress docs, Design handoff boards, Design/Test intake, Test
  cards, archive entries, and templates must keep script-readable formats.
- `node scripts/wakeflow-verify.mjs` is the default verification orchestrator.
- Writing scripts must default to dry-run or explicit check. Use `--write` or
  `--apply` only when the user goal or state root authorizes writes.

## Standard Dispatch Prompt

When the user needs a prompt for another Codex window, output a compact wakeup
prompt. The prompt navigates; the state root, task package, target repository
`AGENTS.md`, and skills define the task.

```text
Continue the current controller task: <plan or wave>.

First read: AGENTS.md, .workspace-active/workspace/index.md,
.workspace-active/workspace/current/<current-controller-document>.md, and this
window/repository AGENTS.md.

Identity: state the current window and repository responsibility.

Claim: take only the task assigned to this window by the current plan.

When done, backfill evidence, boundaries, risks, and recommended next steps
according to the current plan.
```

Do not put wave-specific window lists, blocked/observing decisions, detailed
validation commands, forbidden paths, or automation manuals in `AGENTS.md`.

## Skill Layers

- `AGENTS.md` keeps identity, immutable boundaries, confirmation gates, goal
  judgment, testing boundaries, acceptance floor, repository protection,
  validation requirements, and hard anti-error rules.
- Skills and references keep operation steps, command order, templates,
  examples, troubleshooting, and script details.
- Before reorganizing `AGENTS.md`, design three layers: highest stop rules,
  standing boundaries/maps, and on-demand skill references.

Reference map:

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
- `skills/wakeflow-progressive-validation/SKILL.md`: progressive validation
  and source-derived long-chain plans.
- `skills/wakeflow-target/`: target-window execution and `TargetResultEnvelope`
  backfill.
- `skills/wakeflow-controller/`: controller start, return, result review, and
  next-wave decisions.

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
- If TODO mode affects dispatch or order, run
  `node scripts/wakeflow-verify.mjs --require-todo`.
- If task packages are used, run
  `node scripts/wakeflow-verify.mjs --require-task-packages`.
- If scripts, script README, or script skills change, run
  `node scripts/wakeflow-verify.mjs --with-script-tests`.
- If only long-term docs changed, run workspace docs verification and
  `git diff --check` at minimum.
