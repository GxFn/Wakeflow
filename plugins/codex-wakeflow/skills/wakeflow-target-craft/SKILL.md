---
name: wakeflow-target-craft
description: Use when a Wakeflow development/product window is implementing its assigned task package and needs execution craft — plan-first, clean baseline, test-first, systematic debugging, two-stage self-review, scope discipline, and verify-before-done. It shapes HOW the code is written so the window naturally produces the evidence the controller's acceptance gate requires, and how to receive a rework verdict without blind re-patching. It never changes the delivery/return protocol (that stays with wakeflow-target) and grants no claim, accept, dispatch, cross-window, or state-machine-write authority.
---

# Wakeflow Target Craft

Load this alongside `wakeflow-target`. `wakeflow-target` governs the delivery
envelope, window boundaries, and the `TargetResultEnvelope` return protocol —
the "how do I interact with the state machine". THIS skill governs the "how do I
write the code well" so acceptance passes on the first pass instead of looping
through rework.

## Core stance

The controller accepts on machine-checkable EVIDENCE, not on "looks done". Every
craft practice below exists to leave a specific piece of that evidence on disk.
Do the practice and the evidence is a by-product; skip it and you will be asked
for evidence you never produced. Craft is how you earn the gate, not extra
ceremony on top of it.

## The seven practices (each earns a piece of evidence)

### 1. Plan before you code (self-sequence the combined package)

Your window receives ONE combined task package and self-sequences its items.
Before touching code, write a short ordered plan: item order, the files each
item touches, and how each item will be verified. Then execute ONE item at a
time — verify it before starting the next; do not interleave half-done items.

- Earns: an execution-plan note (kind `execution-plan`, optional but welcome).
- The plan also protects you across session compaction: re-read it and the
  state root instead of reconstructing intent from memory.

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
- Earns: a test that covers the change, exists, and passes; a git history where
  the failing-test commit precedes the implementation commit.
- Why the order matters: a test written after the code tends to assert what the
  code already does, not what the requirement needs. Test-first pins the
  requirement.
- One behavior → one test → one implementation. Do not dump many horizontal RED
  tests then a single big GREEN.

### 4. Systematic debugging (defects / when something fails)

Do not guess-and-patch. Build a feedback loop first:

1. Reproduce the exact reported behavior as a check you can run on demand.
2. Form ranked, falsifiable hypotheses.
3. Probe ONE variable at a time until the root cause is proven, not assumed.
4. Fix the cause, then add a regression test that fails before and passes after.

- Earns: a reproduction plus a regression test tied to the real cause.
- Separate symptom from cause: black-box evidence proves user-visible behavior;
  white-box evidence explains the internal cause. Report which one you have.

### 5. Self-review before return (two stages)

Before writing the `TargetResultEnvelope`, review your own diff in TWO passes:

- **Stage 1 — spec compliance**: does the diff do what the task package,
  `designIntent`, and evidence contract ask — nothing missing, nothing extra?
  Compare against the ORIGINAL wording, not your memory of it.
- **Stage 2 — code quality**: as a skeptical reviewer — correctness, safety,
  maintainability, tests. List findings by severity; fix blockers before
  returning, record the rest.

- Earns: a self-review note (kind `self-review`: stage-1 verdict + stage-2
  issues by severity).
- This is not the controller's acceptance review; it is your first pass so the
  controller's review finds fewer blockers.

### 6. Scope discipline (YAGNI)

Implement only what the task package and `designIntent` ask for. No speculative
abstraction, no adjacent "while I'm here" edits, no widening the diff beyond the
declared scope.

- Earns: a git diff confined to the files/scope `designIntent` declared
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
3. Only then re-enter the practices above (a rework is a defect until proven
   otherwise: reproduce first, practice 4).

- Earns: the next result's self-review note carries the point-by-point response.

## When you have been reworked twice (recurring-problem stop)

Your task's `reworkCount` lives on your entry in the state root's
`targetTasks[]` — check it when a task comes back. At 2+ (`recurringProblem`),
STOP point-fixing. Repeated small patches on the same task signal that the root
cause or the requirement is wrong, not that one more tweak will land it.

- Re-derive from the root cause: reproduce, re-read the requirement design and
  `designIntent`, and state what you now believe the real gap is.
- If the delivered effect keeps missing the goal but you find no product-code
  bug, this is a non-bug outcome mismatch: return `needs-review` and recommend a
  Design redesign — do NOT keep redispatching point fixes.
- Attach a root-cause note (kind `root-cause-note`) to your result so the
  controller sees the shift in hypothesis.

## Craft evidence kinds (canonical vocabulary)

The reduce gate matches `kind` strings EXACTLY — use these spellings:

| kind | What it records |
| --- | --- |
| `tests` | The test(s) covering the change: path(s) + run outcome |
| `repro` | Reproduction of a reported defect (command/steps + observed) |
| `regression` | The fail-before/pass-after regression test for a defect |
| `baseline` | Pre-change suite/typecheck/lint outcome (practice 2) |
| `execution-plan` | The ordered self-sequencing plan (practice 1) |
| `self-review` | Two-stage self-review note; carries rework responses |
| `test-first` | Pointer showing the failing-test commit precedes impl |
| `change-scope` | Statement/diff-stat that changes stay inside designIntent |
| `root-cause-note` | Re-derived hypothesis after recurringProblem |
| `typecheck` / `lint` / `verification` | Tool outputs from practice 7 |

Entry shape: `{ kind, ref | value | commit, verify? }` — `ref` is a repo/state
relative path the controller can resolve; prefer `ref` over prose `value`.

## Branch hygiene at the end

Leave the branch the merge reviewer wants to receive: no WIP/debug commits, no
commented-out residue, messages that say why. Merge-back stays human-reviewed
and decentralized (pending-merges) — never merge your own branch to the main
line.

## Boundaries (this skill adds craft, not authority)

- It changes nothing in `wakeflow-target`: the delivery envelope, window
  boundaries, `TargetResultEnvelope`, and controller-return protocol are
  unchanged and remain higher authority.
- It grants no claim, accept, dispatch, cross-window, or state-machine-write
  authority.
- It does not decide acceptance — it produces the evidence; the controller
  decides.
- Product code and commits stay inside this window's own repository boundary.
- This is a development/product-window skill. It is not the Design or Test
  window's craft — do not invoke Design skills (requirement-clarification,
  option-planning, requirement-design, work-slicing, design-handoff) or Test
  skills (test-strategy, debugging-and-triage, regression-design,
  evidence-review, progressive-chain-validation) from here.

## Quality bar

A task done with craft returns a `TargetResultEnvelope` whose evidence a
controller can accept without a round-trip: a plan that was followed, a pinned
baseline, tests that exist and pass, a diff within declared scope, verification
output, and — for defects — a reproduction and regression. If any of these is
missing, say so honestly (`blocked` / `needs-review`) rather than reporting
`completed`.

## Source methods

Adapted from mature practice, kept as method not name-drop: plan writing and
plan-driven execution (bite-sized items, one at a time, each verified),
clean-test-baseline before starting, test-driven development
(RED-GREEN-REFACTOR), systematic debugging (reproduce → falsifiable hypotheses →
one-variable probes → regression), two-stage code review (spec compliance, then
quality by severity), receiving code review (point-by-point, non-defensive),
YAGNI / scope discipline, verification-before-completion, and
finishing-a-branch hygiene. Industry basis: the practical test pyramid,
scientific debugging, and evidence-first code review.
