---
name: wakeflow-target-craft
description: Use when a Wakeflow development/product window is implementing its assigned task package and needs execution craft — test-first, systematic debugging, self-review, scope discipline, and verify-before-done. It shapes HOW the code is written so the window naturally produces the evidence the controller's acceptance gate requires. It never changes the delivery/return protocol (that stays with wakeflow-target) and grants no claim, accept, dispatch, cross-window, or state-machine-write authority.
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

## The five practices (each earns a piece of evidence)

### 1. Test-first (RED → GREEN)

Before writing implementation for a behavior, write a test that expresses it and
watch it FAIL for the right reason. Then write the minimum code to make it pass
and watch it GREEN.

- Earns: a test that covers the change, exists, and passes; a git history where
  the failing-test commit precedes the implementation commit.
- Why the order matters: a test written after the code tends to assert what the
  code already does, not what the requirement needs. Test-first pins the
  requirement.
- One behavior → one test → one implementation. Do not dump many horizontal RED
  tests then a single big GREEN.

### 2. Systematic debugging (defects / when something fails)

Do not guess-and-patch. Build a feedback loop first:

1. Reproduce the exact reported behavior as a check you can run on demand.
2. Form ranked, falsifiable hypotheses.
3. Probe ONE variable at a time until the root cause is proven, not assumed.
4. Fix the cause, then add a regression test that fails before and passes after.

- Earns: a reproduction plus a regression test tied to the real cause.
- Separate symptom from cause: black-box evidence proves user-visible behavior;
  white-box evidence explains the internal cause. Report which one you have.

### 3. Self-review before return (by severity)

Before writing the `TargetResultEnvelope`, review your own diff as a skeptical
reviewer would — intent first, then correctness, safety, maintainability, tests.
List findings by severity, fix blockers before returning, record the rest.

- Earns: a self-review note (issues by severity) the controller can read.
- This is not the controller's acceptance review; it is your first pass so the
  controller's review finds fewer blockers.

### 4. Scope discipline (YAGNI)

Implement only what the task package and `designIntent` ask for. No speculative
abstraction, no adjacent "while I'm here" edits, no widening the diff beyond the
declared scope.

- Earns: a git diff confined to the files/scope `designIntent` declared.
- A change outside declared scope is either a new task (backfill it) or scope
  creep (drop it) — never a silent add.

### 5. Verify before done

Before returning `completed`, run the checks a reviewer would run: typecheck,
lint, and the tests covering your change. Capture their output.

- Earns: typecheck / lint / test output as verification evidence.
- "It should work" is not verification. Run it, capture it, attach it.

## When you have been reworked twice (recurring-problem stop)

If this task has come back as rework two or more times (`recurringProblem`),
STOP point-fixing. Repeated small patches on the same task signal that the root
cause or the requirement is wrong, not that one more tweak will land it.

- Re-derive from the root cause: reproduce, re-read the requirement design and
  `designIntent`, and state what you now believe the real gap is.
- If the delivered effect keeps missing the goal but you find no product-code
  bug, this is a non-bug outcome mismatch: return `needs-review` and recommend a
  Design redesign — do NOT keep redispatching point fixes.
- Attach a root-cause note to your result so the controller sees the shift in
  hypothesis.

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
controller can accept without a round-trip: tests that exist and pass, a diff
within declared scope, verification output, and — for defects — a reproduction
and regression. If any of these is missing, say so honestly (`blocked` /
`needs-review`) rather than reporting `completed`.

## Source methods

Adapted from mature practice, kept as method not name-drop: test-driven
development (RED-GREEN-REFACTOR), systematic debugging (reproduce → falsifiable
hypotheses → one-variable probes → regression), code review by severity
(intent-first), YAGNI / scope discipline, and verification-before-completion.
Industry basis: the practical test pyramid, scientific debugging, and
evidence-first code review.
