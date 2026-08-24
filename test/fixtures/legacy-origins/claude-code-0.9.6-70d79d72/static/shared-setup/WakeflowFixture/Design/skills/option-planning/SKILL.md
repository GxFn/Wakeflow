---
name: option-planning
description: Use in a Wakeflow Design window when a clarified requirement needs multiple implementation, architecture, sequencing, or rollout options before controller or user confirmation.
---

# Option Planning

Produce defensible alternatives for a clarified requirement. This skill helps
Design compare paths; it does not choose final product direction, create
execution waves, or dispatch product windows.

## Source Skills Used

- `feature-design-assistant`: context, discovery, design, spec, alternatives,
  risks, rollout, and acceptance criteria.
- `senior-architect`: constraints, context boundary, containers/interfaces,
  data ownership, failure modes, and ADR-worthy decisions.
- `mattpocock/skills/engineering/zoom-out`: step back from local
  implementation details and map modules, callers, and domain vocabulary.
- Industry basis: Double Diamond develop stage, architecture decision records,
  and option-based planning before irreversible implementation.

## Wakeflow Role

Design may recommend options and risks. Controller/user confirmation is required
before an option becomes executable scope. Use this skill when:

- there are multiple plausible repository boundaries;
- a design can be implemented in stages;
- interface ownership is unclear;
- a migration or deletion route has tradeoffs;
- quality attributes such as reliability, performance, security, or maintenance
  change the route.

## Interaction First

Default to conversation. Use this skill to compare options, explain tradeoffs,
recommend a route, and ask confirmation questions before writing any tracked
Design artifact.

Do not create or update option notes, requirement designs, handoff drafts, ADRs,
or board rows as the first action. Write files only when the user/controller
explicitly asks for a tracked artifact, confirms that the proposed content
should be recorded, or a controller state root assigns a write deliverable. If a
write is justified, state what will be written and why before editing.

## Inputs

Read only the context needed for the decision:

- clarified requirement or original plan;
- relevant product docs, ADRs, and current code seams;
- current Wakeflow state root when the controller provided one;
- Design notes and prior handoffs;
- explicit user constraints and non-goals.

If the requirement is still fuzzy, run `requirement-clarification` first.

## Workflow

1. Restate the decision.
   - What must be true for the user?
   - Which boundary is uncertain?
   - Which decision is hard to reverse?
2. Map the current system shape.
   - Main components or repositories.
   - Existing interfaces and data ownership.
   - Current tests or evidence seams.
   - Known constraints and non-goals.
3. Produce two to four options.
   - Prefer real alternatives, not cosmetic variants.
   - Include a conservative option when it is viable.
   - Include a staged option when risk is high.
4. Compare options.
   - User-visible result.
   - Repositories/windows affected.
   - Interface and data changes.
   - Failure modes and mitigation.
   - Validation path.
   - Rollout/migration/deletion path.
   - Cost, reversibility, and residual risk.
5. Recommend one option only as Design advice.
   - State what must be confirmed before execution.
   - State what evidence would invalidate the recommendation.

## Option Format

```markdown
### Option <n>: <name>

- Summary:
- User-visible behavior:
- Repositories/windows:
- Interfaces/contracts:
- Data or state ownership:
- Validation path:
- Rollout or migration:
- Risks:
- Reversibility:
- Open decisions:
- Fit:
```

## ADR Candidate Test

Suggest an ADR candidate only when all are true:

- the decision is hard or expensive to reverse;
- future maintainers would find the choice surprising without context;
- there was a real tradeoff between alternatives.

Otherwise, keep it as Design rationale.

## Allowed Outputs

- Conversational option comparison and recommendation.
- Option comparison notes.
- Architecture sketch text or Mermaid diagram when it clarifies boundaries.
- ADR candidate text.
- Controller confirmation questions.
- Requirement-design recommendations.

## Forbidden Outputs

- No implementation commits.
- No task package or dispatch.
- No final product decision.
- No empty API/interface-only option unless it names a real consumer, next
  consumption step, and validation path.
- No product ADR write unless explicitly authorized.
- No tracked Design document or board update as the first action without an
  explicit write request or confirmation.

## Quality Bar

Each option must have a real scenario, affected boundaries, interface/data
implications, validation path, and risk. The skill fails if it presents one
favored route as the only answer or if options are merely phrasing differences.
