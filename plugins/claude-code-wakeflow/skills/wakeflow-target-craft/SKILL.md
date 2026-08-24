---
name: wakeflow-target-craft
description: Use when a Wakeflow product target is about to implement or rework its assigned task package.
---

# Wakeflow Target Craft

Load this alongside `wakeflow-target`. `wakeflow-target` governs the immutable
dispatch packet, window boundaries, strict `TargetResult` recording, and return
transport — the "how do I interact with the state machine". THIS skill governs
the "how do I write the code well" so acceptance passes on the first pass
instead of looping through rework.

## Core stance

The target must leave structured, reproducible REVIEW INPUTS, not a "looks done"
claim. Wakeflow can check that required kinds and mappings exist and that exact
declared ref/digest tuples are linked; it cannot establish that the referenced
contents are true. Every craft
practice below exists to give the controller something concrete to inspect and
independently rerun before acceptance. Craft prepares an honest review; it does
not earn acceptance by itself.

**NO IMPLEMENTATION UNTIL EVERY AUTHORED `acceptanceAnchor` HAS A PLANNED RED TEST OR PROBE; NO COMPLETED RESULT UNTIL EVERY ANCHOR MAPS TO EXACT EVIDENCE REFS.**
Violating the letter of this rule is violating its spirit.

- Read the package's `objective`, `requirementRefs`, complete `boundaries`,
  `completionExpectations`, `acceptanceAnchors`, and advisory `designIntent`
  before planning code.
- For each anchor, record `id -> test/probe seam -> expected RED -> expected
  GREEN`. Use the exact confirmed claim; do not widen it.
- If an anchor is untestable, conflicts with another authority, or requires
  missing facts, return `needs-review`. Never invent a replacement goal.
- A newly authored implementation package without anchors is invalid and must
  return `needs-review`. Non-implementation packages (including research,
  documentation, and Test work) and read-only legacy compatibility packages
  may legitimately omit them; never create requirement authority yourself.
- A Test dispatch packet may list this Skill because it carries a
  `reviewInputContract`. In that case use only the evidence and result-shape
  guidance here; the packet's `testContract.executionContract` and the target
  Skill's Test Alignment Gate stay authoritative, and the product
  implementation practices below do not widen Test's assignment.

## The seven practices (each earns a piece of evidence)

### 1. Plan before you code (self-sequence one package)

Your window receives one immutable TaskPackage for one target task. Its
objective may require several implementation steps, but those steps are not
separate machine-owned package items. Before touching code, write a short
ordered plan: step order, the files each step touches, how each step will be
verified, and the acceptance-anchor plan when present. Then execute one step at
a time — verify it before starting the next; do not interleave half-done work.

- Earns: an execution-plan note (kind `execution-plan`, optional but welcome).
- The plan also protects you across session compaction: re-read it, the exact
  TaskPackage, and the immutable dispatch packet instead of reconstructing
  intent from memory.

### 2. Baseline before you start

Run the relevant test suite (and typecheck/lint if cheap) BEFORE your first
change, and record the outcome. If the baseline is already red, report it —
do not silently adopt pre-existing failures as yours, and never "fix" them
outside your declared scope without backfilling a blocker or observation.

- Earns: a baseline record (kind `baseline`: command + outcome).
- Why: many rework loops start as baseline confusion — a reviewer cannot tell
  your failures from inherited ones unless you pinned the starting state.

### 3. Test-first (RED → GREEN)

Before writing implementation for a behavior, write a test that expresses it and
watch it FAIL for the right reason. Then write the minimum code to make it pass
and watch it GREEN.

- For authored acceptance anchors, the RED must exercise the anchor's declared
  probe or a demonstrably equivalent public seam. Report the mapping by anchor
  id; a general green suite does not prove an unmapped anchor.
- **Bug-fix hard gate:** before editing production code, reproduce the defect
  through the real entrypoint named by the task package and capture the RED.
  Once implementation starts, do not weaken or change that test's entrypoint or
  behavioral meaning to fit the patch; make the same test GREEN. Do not mock the
  fact-producing boundary that the task package asks you to verify.
- Fix the first point where the correct fact is lost or changed. Downstream
  code may validate or forward that fact, but must not invent it through a
  fallback, silently drop unknown fields, or parse human-readable messages into
  structured truth. If the real RED or root cause cannot be established, return
  `needs-review` instead of editing by guess.
- Produces: a test that covers the change plus ordered, reviewable inputs showing
  the same behavior failed before the implementation and passed afterward.
  When the package says `commitExpectation=commit` and repository policy
  permits, separate commits may prove that order. For
  `leave-uncommitted`, preserve it through test output, logs, or evidence
  files instead of creating commits against the package policy.
- Why the order matters: a test written after the code tends to assert what the
  code already does, not what the requirement needs. Test-first pins the
  requirement.
- One behavior → one test → one implementation. Do not dump many horizontal RED
  tests then a single big GREEN.

### 4. Systematic debugging (defects / when something fails)

Do not guess-and-patch. Build a feedback loop first:

1. Reproduce the exact reported behavior as a check you can run on demand.
2. Form ranked, falsifiable hypotheses.
3. Probe ONE variable at a time until the root cause is established, not assumed.
4. Fix the cause, then add a regression test that fails before and passes after.

- Earns: a reproduction plus a regression test tied to the real cause.
- Separate symptom from cause: black-box probes observe user-visible behavior;
  white-box material helps explain the internal cause. Report which one you have.

### 5. Self-review before return (two stages)

Before writing the strict `TargetResult`, review your own diff in TWO passes:

- **Stage 1 — spec compliance**: does the diff do what the task package's
  objective, requirement references, boundaries, completion expectations,
  acceptance anchors, and `reviewInputContract` ask — nothing missing, nothing
  extra? Treat `designIntent` as an implementation sketch, never as scope
  authority. Compare against the ORIGINAL wording, not your memory of it.
- **Stage 2 — code quality**: as a skeptical reviewer — correctness, safety,
  maintainability, tests. List findings by severity; fix blockers before
  returning, record the rest.

- Earns: a self-review note (kind `self-review`: stage-1 verdict + stage-2
  issues by severity).
- This is not the controller's acceptance review; it is your first pass so the
  controller's review finds fewer blockers.

### 6. Scope discipline (YAGNI)

Implement only what the task package objective, requirement references,
boundaries, completion expectations, and acceptance anchors authorize.
`designIntent` may guide the approach, but evidence may justify another
implementation without expanding or shrinking scope. No speculative
abstraction, no adjacent "while I'm here" edits.

- Earns: a git diff confined to the task package's authorized files/scope
  (kind `change-scope`).
- A change outside declared scope is either a new task (backfill it) or scope
  creep (drop it) — never a silent add.

### 7. Verify before done

Before returning `completed`, run the checks a reviewer would run: typecheck,
lint, and the tests covering your change. Capture their output.

- Earns: typecheck / lint / test output as verification evidence.
- "It should work" is not verification. Run it, capture it, attach it.

## Receiving a rework verdict (when a task comes back)

A rework is review input, not an insult and not noise. Before re-touching code:

1. Read the controller's rework REASON and the review pack verbatim — against
   your diff, not against your memory of it.
2. Respond point by point in your next self-review note: agree → fix it;
   disagree → say why WITH evidence. Never silently ignore a point, and never
   blind-patch to "make the message go away".
3. Only then re-enter the practices above (treat a rework as a defect until the
   investigation establishes otherwise: reproduce first, practice 4).

- Earns: the next result's self-review note carries the point-by-point response.

## When supplied history proves repeated rework

Current v3 target-task state does not expose a `reworkCount` or
`recurringProblem` field. Never invent one. Apply this stop only when the
assigned context contains two prior controller rework decisions for the same
target task, or the controller explicitly identifies the assignment as
repeated rework. Then STOP point-fixing: repeated small patches signal that the
root cause or requirement may be wrong, not that one more tweak will land it.

- Re-derive from the root cause: reproduce, re-read the requirement design and
  `designIntent`, and state what you now believe the real gap is.
- If the delivered effect keeps missing the goal but you find no product-code
  bug, this is a non-bug outcome mismatch: return `needs-review` and recommend a
  Design redesign — do NOT keep redispatching point fixes.
- Attach a root-cause note (kind `root-cause-note`) to your result so the
  controller sees the shift in hypothesis.

## Review-input vocabulary and exact result shape

There is no global machine-owned evidence-kind taxonomy. For a completed
result, each string in the packet's `reviewInputContract.requiredKinds` must
appear exactly as an `evidenceLocators[].kind`; the package decides those
spellings. The following are recommended names only when the package requires
or permits them:

| kind | What it records |
| --- | --- |
| `tests` | The test(s) covering the change: path(s) + run outcome |
| `repro` | Reproduction of a reported defect (command/steps + observed) |
| `regression` | The fail-before/pass-after regression test for a defect |
| `baseline` | Pre-change suite/typecheck/lint outcome (practice 2) |
| `execution-plan` | The ordered self-sequencing plan (practice 1) |
| `self-review` | Two-stage self-review note; carries rework responses |
| `test-first` | Pointer to ordered fail-before/pass-after evidence; commits are optional and package-dependent |
| `change-scope` | Statement/diff-stat that changes stay inside task-package boundaries |
| `root-cause-note` | Re-derived hypothesis after proven repeated rework |
| `typecheck` / `lint` / `verification` | Tool outputs from practice 7 |

Every review input is an exact locator:
`{ kind, ref, digest }`. `ref` is a portable relative reference and `digest` is
its `sha256:` digest; prose values and commit-only entries are not locator
shapes. References must be unique.

`craftMapping` is separate from `evidenceLocators`:

- A non-Test result uses
  `{ kind: "acceptance-anchor", anchorId, evidenceRefs: [{ ref, digest }] }`.
  Every tuple must exactly match a declared evidence locator. A completed
  result maps every authored acceptance anchor exactly once, in canonical
  anchor order.
- A Test result uses
  `{ kind: "test-step", planIndex, step, ref }`. `step` must equal the
  approved-plan entry at that zero-based index, and `ref` must identify exactly
  one declared evidence locator. A completed Test result maps every approved
  plan step exactly once and in order.
- `blocked` and `needs-review` may return partial evidence and mappings, but
  they must remain truthful and structurally valid.

## Branch hygiene at the end

Leave the branch the merge reviewer wants to receive: no WIP/debug commits, no
commented-out residue, messages that say why. Follow the TaskPackage's
`commitExpectation` and repository instructions. Never merge your own branch
to the main line unless that exact action is explicitly authorized.

## Boundaries (this skill adds craft, not authority)

- It changes nothing in `wakeflow-target`: the delivery envelope, window
  boundaries, strict `TargetResult`, and controller-return protocol are
  unchanged and remain higher authority.
- It grants no claim, accept, dispatch, cross-window, or state-machine-write
  authority.
- It does not decide acceptance — it produces target-side review inputs; the
  controller independently validates the result and decides.
- Product code and commits stay inside this window's own repository boundary.
- This is primarily development/product-window craft. It is not Design craft.
  When readiness lists it for a Test package solely because an
  `reviewInputContract` exists, apply only the evidence/result-contract
  guidance described above; do not import product implementation scope into
  Test or replace `testContract.executionContract` and the Test Skills.

## Quality bar

A task done with craft returns a strict `TargetResult`
(`artifactKind: "wakeflow-target-result"`) whose review inputs are concrete
enough for the controller to inspect without asking the target to restate its
claim: a plan that was followed, a pinned baseline, every authored acceptance
anchor mapped to exact evidence tuples, tests that exist and pass, a diff
within declared scope, verification output, and — for defects — a reproduction
and regression. If required evidence or mapping is missing, say so honestly
(`blocked` / `needs-review`) rather than reporting `completed`. The controller
still independently validates truth and decides acceptance.

## Source methods

Adapted from mature practice, kept as method not name-drop: plan writing and
plan-driven execution (bite-sized items, one at a time, each verified),
clean-test-baseline before starting, test-driven development
(RED-GREEN-REFACTOR), systematic debugging (reproduce → falsifiable hypotheses →
one-variable probes → regression), two-stage code review (spec compliance, then
quality by severity), receiving code review (point-by-point, non-defensive),
YAGNI / scope discipline, verification-before-completion, and
finishing-a-branch hygiene. Industry basis: the practical test pyramid,
scientific debugging, and artifact-based code review.
