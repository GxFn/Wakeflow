# Design/Test Skill Realization Source Map

Date: 2026-08-24

> **Living baseline, aligned 2026-08-24.** Originally 2026-06-08; re-derived
> against the current architecture (the 31-tool MCP surface, strict TODO append
> for Design intake, the `redesign` review decision, immutable TaskPackages,
> dispatch-packet `reviewInputContract` and `testContract.executionContract`,
> strict `wakeflow-target-result` artifacts, and demand pods). M1B originally
> realized Design and basic Test as plugin-discovered shared Skills:
> canonical host-neutral source lives under `core/skills/`, and `sync-core`
> copies it byte-for-byte into both host artifacts. It also governs the
> development/target window's execution craft (`wakeflow-target-craft`). Where
> a live `SKILL.md` has been re-derived, that file wins on tool/intake
> vocabulary; this map governs capability, role boundaries, and acceptance intent.
> Wakeflow currently persists one Pod Design request/handoff generation; a different
> second generation remains a documented capability gap.
> Staged re-derivation: `docs/wakeflow-execution-craft-plan-2026-07-09.md`.

## Purpose

This document is the implementation source map for Wakeflow Design, Test, and
Controller skills. It is not a process essay and not a list of interesting
external skills. It defines which mature skill methods and industry practices
must be preserved, what Wakeflow may adapt, what must not be deleted, and how
the resulting skills are accepted.

Future implementation must compare each `SKILL.md` against this document. Do
not write from memory, do not create thin summary skills, and do not keep only
the source skill names.

## Standard

The standard is complete capability, not fewer files, shorter text, or fewer
entry points.

- Deleting logic requires a reason: role conflict, duplicated authority,
  unavailable tool dependency, local runtime leakage, no consumer, or full
  replacement by another skill.
- Modifying logic requires a reason: preserve the source method while changing
  only output destination, authority boundary, vocabulary, or Wakeflow state
  semantics.
- Merging logic requires proof that the merged skill still covers the source
  inputs, judgments, outputs, failure conditions, and quality bar.
- Do not delete reasonable logic merely because it looks long or untidy.
- Each skill must fully perform its role:
  - Design clarifies, helps confirm, proposes options, writes requirement
    designs, redesigns non-bug outcome mismatches, proposes candidate slices,
    and hands off.
  - Test plans real validation, reproduces, advises regression checks, and
    reviews only its own evidence without accepting implementation.
  - Controller independently validates, accepts, archives, routes TODOs, and
    decides final state.

## External Research And Practice Basis

External research is used to justify why Wakeflow keeps, adapts, or removes
skill logic. It is not used merely to confirm that downloaded skills exist.

### Requirement Clarification And Requirement Quality

Sources:

- ISO/IEC/IEEE 29148:2018
  - https://www.iso.org/standard/72089.html
  - https://standards.ieee.org/ieee/29148/6937/
- NASA Software Engineering Handbook, SWE-050 Software Requirements
  - https://swehb.nasa.gov/pages/viewpage.action?pageId=146540037
- Design Council Double Diamond
  - https://www.designcouncil.org.uk/resources/the-double-diamond/
- Asking Clarifying Questions in Open-Domain Information-Seeking Conversations
  - https://arxiv.org/abs/1907.06554

Wakeflow conclusions:

- Requirements are not transcripts of user wording. They need verifiable,
  traceable, feasible, necessary, bounded, and maintainable expression.
- Design must not only ask questions. It must separate assumptions from facts,
  define the problem, compare possible directions, and state validation and
  risk before execution.
- Clarifying questions have cost. Ask only when the answer changes goal, scope,
  route, evidence, or acceptance. If code, docs, state roots, or existing
  evidence can answer the question, inspect them first.
- A requirement design must include validation strategy, or the controller
  cannot accept or schedule Test.

Implications:

- `wakeflow-design/references/clarification.md` must output goal, evidence, scope, non-goals,
  stop condition, and unresolved decisions.
- `requirement-design` must be useful for controller intake, not just PRD
  prose.
- Removing clarification logic is allowed only when it does not reduce
  verifiability, scope control, or confirmation quality.

### User Stories, Slicing, And Planning Quality

Sources:

- INVEST user story principle
  - https://www.anagilemind.org/invest
- Scrum Manager Book of Knowledge: INVEST
  - https://www.scrummanager.com/bok/index.php/INVEST
- Design Council Double Diamond
  - https://www.designcouncil.org.uk/resources/the-double-diamond/

Wakeflow conclusions:

- Executable slices should be independent, negotiable, valuable, estimable,
  small enough, and testable.
- A slice must not be a horizontal layer, placeholder interface, type rename,
  empty provider, unused adapter, or "tests later" promise.
- Planning should preserve multiple options before selecting execution.

Implications:

- `work-slicing` must preserve vertical slices, HITL/AFK labels, dependencies,
  user value, acceptance evidence, and owner suggestions.
- Removing or merging slicing logic must still block horizontal-only,
  interface-only, mock-only, and no-consumer work from entering controller
  execution.

### Test Strategy, Risk, And Regression

Sources:

- ISTQB risk-based testing definition
  - https://istqb.missionwares.com/glossary/risk-based-testing.html
- Risk-based testing taxonomy research
  - https://arxiv.org/abs/1912.11519
- Martin Fowler / Thoughtworks: The Practical Test Pyramid
  - https://martinfowler.com/articles/practical-test-pyramid.html
- Google Testing Blog: Flaky Tests at Google and How We Mitigate Them
  - https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html
- Mozilla research: Understanding Flaky Tests: The Developer's Perspective
  - https://www.mozillafoundation.org/en/research/library/understanding-flaky-tests-the-developers-perspective/

Wakeflow conclusions:

- Test is not "run more tests". It chooses evidence by risk, confidence, and
  cost.
- Lower-level tests are preferred when they prove the behavior; higher-level or
  real-scenario checks are justified when user-visible or environment evidence
  is required.
- Flakiness weakens evidence. It must be classified and owned, not treated as
  passing.
- Regression design should protect observable behavior through public seams,
  not private implementation shape.

Implications:

- `wakeflow-test/references/risk-strategy.md` must state why Test is needed, what risk is tested, and what
  success, failure, and invalid conclusions mean.
- `wakeflow-test/references/debugging-triage.md` must build a feedback loop before root-cause claims.
- `wakeflow-test/references/regression-advisory.md` must state public seam and fail-before/pass-after
  evidence.
- `wakeflow-test/references/self-evidence-review.md` must inspect only Test's
  own mapped evidence; product diff, target-result, and acceptance review stay
  with the controller.
- Removing test logic must not reduce risk priority, evidence confidence, or
  failure classification.

### Evidence, Monitoring, And Acceptance

Sources:

- Google SRE Book: Monitoring Distributed Systems
  - https://sre.google/sre-book/monitoring-distributed-systems/
- Google Engineering Practices: What to look for in a code review
  - https://google.github.io/eng-practices/review/reviewer/looking-for.html
- Google Engineering Practices: Code Review introduction
  - https://google.github.io/eng-practices/review/

Wakeflow conclusions:

- Review inputs should distinguish symptom and cause. Black-box probes observe
  user-visible behavior; white-box material helps explain internal cause. They
  do not replace each other.
- Monitoring, debugging, load testing, log analysis, and review are related but
  should remain loosely coupled.
- Acceptance reviews design, functionality, complexity, tests, and risk. A
  target saying "done" is not acceptance.

Implications:

- Controller acceptance must inspect target-authored materials, run fresh
  independent checks, and judge user
  goal, scope, implementation reality, validation, and residual risk.
- Archive requires closed active work, rolled TODOs, and a traceable validation record.
- Removing controller review logic is allowed only if target results, Test
  self-evidence review, and script output still cannot be mistaken for final
  acceptance.

## External Skill Sources

### OpenAI Skills And Codex Skill Creator

Sources:

- `openai/skills/.curated/define-goal/SKILL.md`
  - https://github.com/openai/skills/blob/main/skills/.curated/define-goal/SKILL.md
- `openai/codex` skill-creator sample
  - https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/skill-creator/SKILL.md

Use:

- A skill is a capability package, not only a prompt.
- Frontmatter and `description` define trigger behavior.
- `SKILL.md` carries the core workflow; longer details can move to
  `references/`.
- Goal quality requires concrete outcome, evidence, scope, out-of-scope, and
  stop condition.

Adapt:

- Do not use OpenAI goal-tool calls as the default Design mechanism.
- Keep goal quality standards for requirement clarification.

### `mattpocock/skills`

Sources:

- Repo: https://github.com/mattpocock/skills
- `to-prd`: https://github.com/mattpocock/skills/blob/main/skills/engineering/to-prd/SKILL.md
- `grill-with-docs`: https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md
- `to-issues`: https://github.com/mattpocock/skills/blob/main/skills/engineering/to-issues/SKILL.md
- `diagnose`: https://github.com/mattpocock/skills/blob/main/skills/engineering/diagnose/SKILL.md
- `tdd`: https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/SKILL.md
- `handoff`: https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md

Use:

- `grill-me` / `grill-with-docs`: one dependency decision at a time, recommended
  answer per question, code/docs first when possible, terminology challenge,
  concrete scenarios, and code/doc contradiction checks.
- `to-prd`: conversation and codebase understanding become problem, solution,
  user stories, implementation decisions, testing decisions, out-of-scope, and
  notes.
- `to-issues`: tracer-bullet vertical slices, HITL/AFK labels, dependencies,
  user-story coverage, and granularity confirmation.
- `diagnose`: feedback loop first, reproduction, ranked falsifiable hypotheses,
  targeted instrumentation, regression, cleanup, and post-mortem.
- `tdd`: public interface, observable behavior, one test to one
  implementation, and no horizontal RED/GREEN dump.
- `handoff`: compact handoff, suggested skills, source references, no
  duplication, and redaction.

Adapt:

- Do not publish to an external issue tracker by default.
- Do not write product `CONTEXT.md` or ADRs unless explicitly authorized.
- Design outputs controller-intake candidates; controller owns execution.
- Test outputs evidence and routing suggestions; product windows own fixes.

### `vadimcomanescu/codex-skills`

Sources:

- Repo: https://github.com/vadimcomanescu/codex-skills
- `feature-design-assistant`: https://github.com/vadimcomanescu/codex-skills/blob/main/skills/.experimental/product/feature-design-assistant/SKILL.md
- `senior-architect`: https://github.com/vadimcomanescu/codex-skills/blob/main/skills/.curated/platform/senior-architect/SKILL.md
- `senior-qa`: https://github.com/vadimcomanescu/codex-skills/blob/main/skills/.curated/quality/senior-qa/SKILL.md
- `code-reviewer`: https://github.com/vadimcomanescu/codex-skills/blob/main/skills/.curated/quality/code-reviewer/SKILL.md

Use:

- `feature-design-assistant`: context, discovery, design, spec, goals,
  non-goals, quality bar, alternatives, risks, rollout, and acceptance.
- `senior-architect`: constraints, primary journey, non-functional
  requirements, context, containers, interfaces, risks, and decisions.
- `senior-qa`: risky journeys, test layer selection, release test plan, and
  flakiness as a product bug.
- `code-reviewer`: intent first, then correctness, safety, maintainability,
  performance, tests, large-diff triage, and actionable findings.

Adapt:

- Do not require Python scripts by default.
- Do not expose role names as many independent Wakeflow entry points.
- Preserve method strength while changing output location and authority
  boundaries.

## Implementation Rules For Each Skill

Every implemented skill must include:

1. `name` and `description`.
2. `Source Skills Used`.
3. `Wakeflow Role`.
4. Workflow with preserved source methods.
5. Allowed outputs.
6. Forbidden outputs.
7. Handoff destination or controller relationship.
8. Quality bar.

Use `references/` only when it prevents an overloaded `SKILL.md`. Do not create
extra README files or shortcut tables unless they are needed by installation or
developer usage.

## Delete, Modify, Merge Matrix

| Action | Allowed when | Must preserve | Must record | Not allowed when |
| --- | --- | --- | --- | --- |
| Import mostly as-is | Source skill role matches Wakeflow role and has no unavailable tool assumption | Method, question structure, output quality | Source path, consumer window, destination | Only changing it for style |
| Adapt | Source method is valuable but destination, authority, tool, or vocabulary differs | Judgment steps, quality gate, failure conditions | What changed and why capability is preserved | Shrinking complex capability into principles |
| Merge | Multiple skills serve one Wakeflow responsibility and merged skill preserves all key inputs/outputs/failures | Irreplaceable methods from each source | Merged responsibility, covered source capability, uncovered items | Fewer entry points would lose professional judgment |
| Delete | No consumer, role conflict, unavailable tool, runtime leakage, duplicated authority, or complete replacement | Replacement path or explicit retirement reason | Reason, impact, replacement, validation | The skill is reasonable but not yet understood |
| Move to reference | The method is long but trigger is clear | Trigger, minimal workflow, quality bar in `SKILL.md` | Reference path and load condition | Hiding a key gate in a rarely read file |

## Role Completeness Matrix

| Role | Must cover | Must not do |
| --- | --- | --- |
| Design | Clarification, assisted confirmation, options, requirement design, candidate slicing, explicitly confirmed `wakeflow_deliver` handoff | Direct TODO/state mutation, dispatch, product implementation, acceptance, final product decision |
| Test | Risk strategy, reproduction, regression advice, self-evidence review, failure classification | Product-source mutation, product-target review, final acceptance, unbounded QA |
| Controller | Entry sync, state roots, task packages, dispatch, result review, independent validation, TODO rollup, archive | Accept target prose, skip independent checks, let scripts make product decisions |
| Product / Target craft | Test-first, systematic debugging, self-review by severity, scope discipline (YAGNI), verify-before-done; produce controller-reviewable inputs | Claim, accept, dispatch, cross-window or state-machine writes; invoke Design/Test skills; decide acceptance |

## Skill To Source Matrix

| Wakeflow skill | Source skill body | Industry basis | Required judgment |
| --- | --- | --- | --- |
| `wakeflow-design/references/clarification.md` | `define-goal`, `grill-me`, `grill-with-docs`, `feature-design-assistant` | ISO/IEC/IEEE 29148, NASA SWE-050, Double Diamond, clarifying-question research | Ask only scope/outcome-changing questions and output verifiable goals |
| `wakeflow-design/references/option-planning.md` | `feature-design-assistant`, `senior-architect`, `zoom-out` | Double Diamond, architecture decisions | Compare alternatives with boundaries, interfaces, risks, and validation |
| `wakeflow-design/references/requirement-design.md` | `to-prd`, `agile-product-owner`, `planning-with-files` | ISO/IEC/IEEE 29148, INVEST | Produce controller-intake design, not empty PRD prose |
| `wakeflow-design/references/work-slicing.md` | `to-issues`, `agile-product-owner` | INVEST, vertical slicing | Block horizontal slices, empty interfaces, and unused adapters |
| `wakeflow-design/references/design-handoff.md` | `handoff`, `planning-with-files` | Handoff and redaction practice | Submit only explicitly confirmed, complete Design input through `wakeflow_deliver` |
| `wakeflow-test/references/risk-strategy.md` | `senior-qa` | Risk-based testing, test pyramid | Elaborate the approved plan by risk and confidence without choosing a new target |
| `wakeflow-test/references/debugging-triage.md` | `diagnose`, `systematic-debugging`, `triage` | Scientific debugging, SRE symptom/cause separation | Build a feedback loop before claims and return ownership classification |
| `wakeflow-test/references/regression-advisory.md` | `tdd` | Test pyramid, behavior-focused testing | Advise public-seam fail-before/pass-after coverage without implementing product tests |
| `wakeflow-test/references/self-evidence-review.md` | evidence discipline retained from `code-reviewer` and `senior-qa` | SRE observation discipline, test confidence | Review only Test-authored mapped evidence; never review product completion or recommend acceptance |
| `wakeflow-controller` acceptance | `code-reviewer`, `senior-qa`, existing Wakeflow controller | Google code review, SRE validation model | Inspect target inputs, run independent checks, roll TODOs, and decide accept/rework/block/archive |
| `wakeflow-target-craft` | Superpowers `test-driven-development` / `systematic-debugging` / `verification-before-completion` / `requesting-code-review`, mattpocock `tdd` / `diagnose` | Test pyramid, scientific debugging, artifact-based code review | Produce structured review inputs with machine-checkable presence/mapping; stop point-fixing only when supplied history proves repeated rework; hold no claim/accept/dispatch authority |

## Design Shared Skill

Canonical router:

- `core/skills/wakeflow-design/SKILL.md`

The router owns the Design role boundary, progressive disclosure, draft-only
write gate, and explicitly confirmed `wakeflow_deliver` handoff. Focused methods
remain separate references so merging five discoverable entry points into one
plugin Skill does not lose their judgments or quality bars.

### `clarification.md`

Path:

- `core/skills/wakeflow-design/references/clarification.md`

Required behavior:

- Clarify fuzzy intent into controller-usable requirement input.
- Ask only necessary questions.
- Prefer code/docs/state facts over asking the user.
- Output goal, actor, evidence, scope, non-goals, stop condition, recommended
  interpretation, and open decisions.
- Forbid task packages, dispatch, controller state mutation, and final product
  decisions.

Acceptance:

- Shows `define-goal` evidence/scope/stop-condition strength.
- Shows `grill-with-docs` terminology, scenarios, and code/doc contradiction
  checks.
- Is not a generic questionnaire.

### `option-planning`

Path:

- `core/skills/wakeflow-design/references/option-planning.md`

Required behavior:

- Produce two to four real options.
- Compare user-visible result, affected windows, interfaces, data/state,
  validation, rollout, risk, reversibility, and open decisions.
- Recommend only as Design advice.
- Forbid execution, dispatch, product ADR writes without authorization, and
  empty interface-only options.

Acceptance:

- Every option has scenario, boundary, validation, and risk.
- The output does not present one path as a hidden final decision.

### `requirement-design`

Path:

- `core/skills/wakeflow-design/references/requirement-design.md`

Required behavior:

- Write controller-intake-ready requirement designs with problem, goal,
  non-goals, actors, user stories, proposed behavior, implementation decisions,
  testing decisions, acceptance criteria, risks, controller notes, and sources.
- Prefer existing public seams for testing.
- Mark confirmation status.

Acceptance:

- Controller can infer phase order, affected windows, dependencies, validation,
  and confirmation needs.
- Testing decisions are real, not "run tests".

### `work-slicing`

Path:

- `core/skills/wakeflow-design/references/work-slicing.md`

Required behavior:

- Convert confirmed requirement designs into vertical-slice candidates.
- Preserve AFK/HITL, owner suggestion, dependencies, user stories, acceptance,
  validation, evidence, and risks.
- Block horizontal layer tasks and no-consumer interface work.

Acceptance:

- Each candidate is independently demoable or verifiable.
- No slice is only type/interface/mock/doc motion without consumer and evidence.

### `design-handoff`

Path:

- `core/skills/wakeflow-design/references/design-handoff.md`

Required behavior:

- Handoff facts, confirmed decisions, Design recommendations, open questions,
  non-goals, risks, required controller judgment, suggested action, suggested
  skills, sources, redaction notes, and intake status.
- Reference existing artifacts instead of duplicating full content.
- Require explicit confirmation before one `wakeflow_deliver` append using an
  exact 13-column TODO row and current-board `expectedBoardDigest`.
- State that append validates intake-row syntax and CAS only; the controller
  must resolve submitted references and freeze proportional demand authority
  before task packaging.
- Forbid hand-edited TODO mutation, dispatch, acceptance, and final product
  decisions.

Acceptance:

- Controller can quickly decide intake, decision, or stop.
- The handoff separates fact, suggestion, and decision.

Design draft assets:

- `core/skills/wakeflow-design/assets/original-plan.md`
- `core/skills/wakeflow-design/assets/requirement-design.md`

They are instantiated only for an explicit persistent-draft request. Their
path, title, and status never become demand authority by themselves.

## Test Shared Skill

Canonical router:

- `core/skills/wakeflow-test/SKILL.md`

The router supports only controller-accepted implementation validation or a
controller-scoped Test-only reproduction/environment diagnostic. Product source
is unconditionally read-only. A card may authorize mutation only in its
confirmed environment and in Test-owned harness/fixture assets. Every result is
returned as a strict `TargetResult` with exact evidence locators and craft
mappings; Test self-review never replaces controller acceptance.

### `risk-strategy.md`

Path:

- `core/skills/wakeflow-test/references/risk-strategy.md`

Required behavior:

- Restate the controller question.
- Explain why Test is needed.
- Map risk and choose unit/integration/E2E/manual/runtime evidence by fit.
- State success, failure, invalid conclusions, stop conditions, and evidence
  paths.

Acceptance:

- Every test activity serves a specific controller question and risk.
- It does not expand into unbounded QA.

### `debugging-triage.md`

Path:

- `core/skills/wakeflow-test/references/debugging-triage.md`

Required behavior:

- Build a feedback loop before hypotheses.
- Reproduce the exact reported behavior.
- Produce ranked falsifiable hypotheses.
- Probe one variable at a time.
- Classify product defect, test defect, environment, flaky, missing review inputs,
  out of scope, or needs owner decision.

Acceptance:

- The report contains signal, observations, hypotheses, probes, classification,
  owner recommendation, and residual risk.
- It is not log-reading guesswork.

### `regression-advisory.md`

Path:

- `core/skills/wakeflow-test/references/regression-advisory.md`

Required behavior:

- Name behavior to protect.
- Choose public seam.
- State why the seam exercises the real bug or requirement.
- Define fail-before and pass-after evidence.
- Start with one tracer bullet.
- Keep product regression implementation with the owning product window;
  Test's output is advisory.

Acceptance:

- The design protects observable behavior.
- It does not bind to private implementation shape.

### `self-evidence-review.md`

Path:

- `core/skills/wakeflow-test/references/self-evidence-review.md`

Required behavior:

- Restate the frozen controller question and approved plan.
- Inventory only Test-authored commands, observations, mappings, portable refs,
  flake facts, limitations, and residual risks.
- Check exact `test-step` coverage plus evidence reproducibility and redaction.
- Return honest completed/blocked/needs-review readiness for the strict
  `TargetResult` without reviewing product completion.

Acceptance:

- Test can return complete, bounded evidence without asking the controller to
  reconstruct the run.
- It does not inspect product diffs/target results on the controller's behalf,
  recommend acceptance, or treat successful command output as full acceptance.

## Product / Target Craft Skill To Implement

### `wakeflow-target-craft`

Path (plugin skill, NOT a window-support template — development windows are external
product repositories and load it via the Wakeflow plugin, alongside `wakeflow-target`):

- `skills/wakeflow-target-craft/SKILL.md`

Required behavior:

- Shape HOW the development window writes code so it produces structured review inputs whose presence and mapping are machine-checkable, while truth remains a controller judgment:
  test-first (RED→GREEN), systematic debugging (reproduce → falsifiable hypotheses →
  one-variable probes → regression), self-review by severity, scope discipline (YAGNI),
  verify-before-done (typecheck/lint/test output).
- When supplied assignment history proves two prior controller rework decisions,
  stop point-fixing: re-derive from root cause, or return `needs-review`
  recommending a Design redesign for a non-bug outcome mismatch. Do not invent
  a machine rework counter that v3 target-task state does not expose.
- Forbid claim, accept, dispatch, cross-window, or state-machine writes; forbid invoking
  Design/Test skills; never decide acceptance (produce review inputs, controller decides).

Acceptance:

- Returns a strict `TargetResult` whose `{ kind, ref, digest }` evidence locators
  and acceptance/test-step mappings are concrete enough to inspect without
  asking the target to restate its claim; honestly returns
  `blocked`/`needs-review` when required inputs are missing. Acceptance still
  requires controller validation.
- Adds craft, not authority: `wakeflow-target` remains higher authority for the delivery and
  return protocol.

## Controller Skill Enhancement

Path:

- `skills/wakeflow-controller/SKILL.md`

Required behavior:

- Acceptance inputs include state root, task package, dispatch group, target
  result, target-authored materials, fresh controller checks, Test/Design
  artifacts, product rules, and TODO impact.
- Acceptance review checks user goal, scope, identity, implementation reality,
  independent validation results, risks, and TODO rollup.
- Decisions are explicit: accept result, request rework, mark blocked, wait,
  need user decision, complete demand, archive, or create next package.
- Stop when target inputs are prose only, superficial script output, missing
  referenced artifacts, empty interface/mock/adapter work, or inconsistent TODO/archive
  state.

Acceptance:

- Target self-report cannot become final acceptance.
- Every decision can be traced to inspected inputs and fresh controller checks.

## Installation Requirements

Canonical shared layout:

```text
core/skills/wakeflow-design/
  SKILL.md
  references/clarification.md
  references/option-planning.md
  references/requirement-design.md
  references/work-slicing.md
  references/design-handoff.md
  assets/original-plan.md
  assets/requirement-design.md

core/skills/wakeflow-test/
  SKILL.md
  references/risk-strategy.md
  references/debugging-triage.md
  references/regression-advisory.md
  references/self-evidence-review.md

core/skills/wakeflow-target-craft/
  SKILL.md
```

`core/skills/` is the only source for these host-neutral capabilities.
`sync-core` discovers the complete directories as shared copy members and
mirrors them byte-for-byte to both plugin artifacts under the same `skills/`
paths. They are plugin-discovered Skills, not template-bundle entries and not
files copied into Design/Test workspaces. Do not directly maintain either
artifact copy.

## Verification Checklist

After implementation:

- Each shared Skill names source skills and preserves every focused method.
- Each skill states Wakeflow role boundaries.
- Allowed and forbidden outputs are explicit.
- Design/Test do not gain controller authority.
- Controller acceptance is strengthened, not delegated.
- Design delivery requires explicit confirmation and uses only
  `wakeflow_deliver` with the current TODO-row/CAS contract; no local handoff
  transport or removed authority-promotion call is restored.
- Test self-evidence review covers only Test-authored mapped evidence; product
  diff/target-result review stays with the controller.
- Target craft names `reviewInputContract`, `testContract.executionContract`,
  strict `TargetResult`, `{ kind, ref, digest }` evidence locators, and current
  acceptance/test-step mappings; it does not teach legacy envelope fields.
- `sync-core` installs all three shared Skill directories into both artifacts,
  and parity checks compare every byte after synchronization.
- Node-only validation recursively checks local Markdown links, path
  containment, orphan files, frontmatter, and forbidden auxiliary surfaces.
- No project-specific names, local paths, thread ids, secrets, non-English text,
  or unsupported runtime dependencies remain in reusable Wakeflow package files.
