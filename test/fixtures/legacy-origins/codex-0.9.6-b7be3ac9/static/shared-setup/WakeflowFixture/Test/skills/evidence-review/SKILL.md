---
name: evidence-review
description: Use in a Wakeflow Test window to inspect target-authored inputs, diffs, reports, runtime logs, or validation output and return blockers, missing inputs, residual risk, and a bounded interpretation for controller validation.
---

# Evidence Review

Review whether the available materials are useful enough for controller
validation. Test may assess inputs and risk; its assessment is another review
input, while the controller still owns independent validation, acceptance,
rework, archive, and next dispatch.

## Source Skills Used

- `code-reviewer`: intent first, then correctness, safety, maintainability,
  performance, tests, large-diff triage, and actionable must/nice-to-have
  findings.
- `senior-qa`: confidence per unit effort, risky journeys, test layer choices,
  and release evidence.
- Google code review practices and SRE evidence discipline: distinguish
  user-visible symptoms, internal causes, and verification artifacts.

## Wakeflow Role

Use this skill when the controller asks Test to inspect:

- target result envelope and referenced inputs;
- product diff or patch;
- test report, runtime JSON, log, screenshot, probe, or trace;
- release/smoke result;
- claimed validation coverage.

## Workflow

1. Understand intent.
   - What user/system behavior was supposed to change?
   - Which task package or test card defines the boundary?
   - Which conclusion is forbidden?
2. Inventory review inputs.
   - Commits or diff refs.
   - Commands and output.
   - Reports/logs/screenshots/runtime JSON.
   - Test names and pass/fail status.
   - Worktree cleanliness when relevant.
3. Review highest-risk surfaces first.
   - Entrypoints.
   - Data writes.
   - Auth/security/privacy.
   - Cross-repository contracts.
   - Runtime or daemon boundaries.
4. Assess the materials by category.
   - Correctness and edge cases.
   - Safety and data handling.
   - Maintainability and interface fit.
   - Performance or operational risk.
   - Test adequacy and flakiness.
5. Separate findings.
   - Blocker: Test recommends that the controller not accept.
   - Missing review input: cannot conclude.
   - Residual risk: acceptable only if controller/user agrees.
   - Follow-up: should be tracked but need not block.
6. Return a controller-ready interpretation.

## Review Format

```markdown
## Evidence Review

- Intent:
- Boundary:
- Inputs inspected:
- Major blockers:
- Missing review inputs:
- Minor issues:
- Residual risks:
- Test plan assessment:
- Invalid conclusions:
- Recommended controller decision:
```

Recommended controller decision must be one of:

- `inputs-ready-for-controller-validation`
- `needs-rework`
- `missing-review-inputs`
- `blocked`
- `needs-user-decision`
- `out-of-scope`

## Actionable Finding Standard

Each blocker must state:

- what is wrong;
- why it matters;
- where the evidence is;
- what kind of repair or additional evidence would resolve it;
- whether it blocks acceptance or is a follow-up.

## Forbidden Outputs

- No final acceptance.
- No product decision.
- No product code edit unless explicitly authorized.
- No TODO mutation.
- No dispatch or controller-return envelope creation.
- No "looks good" without inspected inputs and explicit limitations.

## Quality Bar

The review is useful when the controller can decide accept, rework, wait,
block, or ask the user without rereading every artifact. It fails if it merely
summarizes target prose, ignores referenced artifacts, or treats successful
command output as controller validation or acceptance.
