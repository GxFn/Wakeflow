---
name: work-slicing
description: Use in a Wakeflow Design window to break a confirmed requirement design into vertical-slice TODO or task-package candidates for controller intake.
---

# Work Slicing

Convert a confirmed requirement design into controller-intake candidates. This
skill proposes slices; it does not write the controller TODO board, create state
roots, or dispatch windows.

## Source Skills Used

- `mattpocock/skills/engineering/to-issues`: tracer-bullet vertical slices,
  HITL/AFK marking, dependency order, user-story coverage, and granularity quiz.
- `agile-product-owner`: INVEST checks and acceptance criteria quality.
- Industry basis: INVEST user story quality and vertical-slice delivery.

## Wakeflow Role

Design proposes task-package candidates. Controller decides whether they enter
TODO, state roots, waves, or dispatch. Use this skill when a requirement design
is confirmed enough to discuss implementation chunks.

## Interaction First

Default to conversation. Use this skill to propose candidate slices, explain
dependencies, and ask the user/controller to confirm granularity and HITL/AFK
labels before writing any tracked Design artifact.

Do not create or update slice notes, handoff drafts, TODO boards, task packages,
or board rows as the first action. Write files only when the user/controller
explicitly asks for a tracked artifact, confirms that the proposed content
should be recorded, or a controller state root assigns a write deliverable. If a
write is justified, state what will be written and why before editing.

## Inputs

- Requirement design or PRD-like artifact.
- Confirmed non-goals and completion definition.
- Option-plan decision if multiple implementation routes existed.
- Current repository/window map when available.
- Known producer/consumer dependencies.

## Vertical Slice Rules

Every candidate must be a thin but complete path through the necessary layers.
It should be demoable, reviewable, or verifiable by itself.

Do not create horizontal slices such as:

- "define types";
- "add interface";
- "create adapter";
- "write tests later";
- "make provider shell";
- "cleanup docs";
- "wire plumbing without a consumer".

Contract-only or interface-only work is allowed only when it names:

- the consumer;
- the next consumption step;
- the validation evidence;
- the reason it must precede implementation.

## Workflow

1. Read the source requirement and identify user stories.
2. Map the end-to-end behavior path.
3. Identify producer/consumer order across windows.
4. Draft candidate slices in dependency order.
5. Mark each slice:
   - `AFK`: can be executed without more human decision;
   - `HITL`: needs user/controller/design decision before execution.
6. Check INVEST:
   - independent enough;
   - negotiable;
   - valuable;
   - estimable;
   - small enough;
   - testable.
7. Ask controller/user to confirm granularity, dependencies, and HITL/AFK
   labels before execution.

## Candidate Format

```markdown
### Candidate <n>: <title>

- Type: AFK | HITL
- Owning window suggestion:
- Blocked by:
- User stories covered:
- What changes:
- Observable result:
- Acceptance criteria:
- Validation path:
- Evidence expected:
- Risks:
- Why this is a vertical slice:
```

## Allowed Outputs

- Conversational candidate slice list and confirmation questions.
- Candidate slice lists.
- TODO/task-package suggestions.
- Dependency and phase-order notes.
- Questions for controller/user confirmation.

## Forbidden Outputs

- No controller TODO mutation.
- No task package creation.
- No dispatch.
- No issue tracker publishing.
- No thin interface-only candidates without consumer and validation.
- No tracked Design document or board update as the first action without an
  explicit write request or confirmation.

## Quality Bar

This skill succeeds when every slice can be explained as a complete path to
observable value or evidence. It fails if the output is organized by technical
layer instead of user/system behavior, or if it creates "starter" work that
cannot be validated independently.
