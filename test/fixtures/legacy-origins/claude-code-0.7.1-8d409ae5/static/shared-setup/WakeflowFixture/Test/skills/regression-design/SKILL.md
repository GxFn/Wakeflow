---
name: regression-design
description: Use in a Wakeflow Test window to design behavior-focused regression coverage from a confirmed bug, requirement, test card, or target result without coupling to private implementation details.
---

# Regression Design

Turn a behavior or bug into durable regression coverage guidance. This skill
designs tests and evidence; it does not implement product fixes unless a test
card explicitly authorizes Test to do so.

## Source Skills Used

- `mattpocock/skills/engineering/tdd`: public interfaces, behavior over
  implementation, vertical red-green cycles, no horizontal test dumps, and no
  refactor while red.
- `diagnose`: correct regression seam comes after a real feedback loop and
  reproduction.
- Industry basis: test pyramid and behavior-focused testing.

## Wakeflow Role

Use this skill when:

- a bug has been reproduced and needs a regression plan;
- a requirement needs behavior-first coverage before implementation;
- a target result claims coverage and Test must judge whether the seam is right;
- a controller wants to know what evidence would prevent recurrence.

## Core Principle

Test observable behavior through a public seam. A good regression survives
internal refactors. A bad regression tests private methods, mocks internal
collaborators unnecessarily, or verifies implementation shape instead of user or
system behavior.

## Workflow

1. Name the behavior.
   - What capability must remain true?
   - Which actor or integration observes it?
2. Choose the public seam.
   - API endpoint, CLI command, UI flow, public function, daemon job,
     integration boundary, or documented output.
   - Prefer the highest seam that proves the behavior.
3. Check the bug pattern.
   - Does the seam exercise the real call chain?
   - Does it cover the failure as observed?
   - If not, state that the architecture lacks a correct seam.
4. Specify fail-before/pass-after evidence.
   - Expected failing signal before fix or before intended behavior exists.
   - Expected passing signal after implementation.
5. Design one tracer bullet first.
   - One behavior.
   - One test or observation.
   - Minimal fixture.
   - Clear assertion.
6. Add further behaviors incrementally.
   - Do not write all tests first.
   - Each new test should reflect learning from the previous cycle.
7. Return guidance to the controller or owning product window.

## Regression Plan Format

```markdown
## Regression Design

- Behavior to protect:
- Public seam:
- Why this seam is correct:
- Fail-before signal:
- Pass-after signal:
- First tracer bullet:
- Additional cases:
- Fixtures/data:
- Risks:
- Owner:
```

## Anti-Patterns

- Testing private methods.
- Mocking internal collaborators when a public seam exists.
- Querying internal storage when the public result is what matters.
- Bulk-generating tests before the implementation is understood.
- Testing only type shape or adapter existence.
- Declaring coverage without proving the original bug pattern.

## Allowed Outputs

- Regression test design.
- Recommended seam and fixture.
- Evidence requirements for product windows.
- Note that no correct seam exists.

## Forbidden Outputs

- No product implementation by default.
- No final acceptance.
- No horizontal test backlog masquerading as completion.
- No private implementation-coupled coverage as the only evidence.

## Quality Bar

The design is complete when it names a behavior, public seam, fail-before signal,
pass-after signal, first tracer bullet, and owner. It fails when it only says
"add tests" or verifies an implementation shape that could pass while the user
behavior is broken.
