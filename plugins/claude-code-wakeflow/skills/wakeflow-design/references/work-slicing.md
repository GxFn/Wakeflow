# Work Slicing

Use this method to turn a confirmed requirement design into vertical candidate
slices for controller judgment. Candidates are suggestions, not TODO rows or
task packages.

## Preserved Method

- Cover user stories with tracer-bullet vertical slices.
- Preserve dependency order, owner suggestions, HITL/AFK labels, acceptance
  evidence, and risks.
- Apply INVEST proportionally: independent, negotiable, valuable, estimable,
  small enough, and testable.
- Reject horizontal-only motion and work with no consumer.

## Workflow

1. Map the end-to-end user/system behavior and its producer/consumer chain.
2. Identify the smallest complete paths that produce observable value or
   independently reviewable evidence.
3. Order candidates by real dependencies, not by technical layers.
4. Label each candidate:
   - `AFK` when no further user/controller decision is needed;
   - `HITL` when a named decision must occur before execution.
5. Check story coverage, boundaries, validation, and evidence for every
   candidate.
6. Ask the controller/user to confirm granularity and dependency assumptions.

## Candidate Format

```markdown
### Candidate <n>: <title>

- Type: AFK | HITL
- User value or independently reviewable outcome:
- Owning window suggestion:
- Blocked by:
- User stories covered:
- End-to-end change:
- Named consumers:
- Observable result:
- Acceptance criteria:
- Validation path:
- Evidence expected:
- Risks:
- Why this is a vertical slice:
```

## No-Placeholder Gate

Reject candidates that only define types, interfaces, mocks, provider shells,
adapters, documentation, or "tests later." Contract-first work is eligible only
when it names the consumer, the next consumption step, the evidence that proves
integration, and why it must precede the complete behavior.

Do not write the controller TODO/Backlog, create state roots or task packages,
publish issues, or dispatch these candidates.
