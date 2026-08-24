---
name: design-handoff
description: Use in a Wakeflow Design window to prepare a compact handoff for controller intake from clarified requirements, option plans, requirement designs, and Design signals.
---

# Design Handoff

Prepare a concise, evidence-backed handoff from Design to the Wakeflow
controller. A handoff is an intake artifact, not an execution plan and not a
final product decision.

## Source Skills Used

- `mattpocock/skills/productivity/handoff`: compact summary, suggested skills,
  avoid duplicating existing artifacts, and redact sensitive data.
- `planning-with-files`: keep notes and deliverables separate; reference source
  artifacts instead of copying them.
- Wakeflow governance: Design signals become executable only after controller
  intake.

## Wakeflow Role

Use this skill when:

- Design has clarified a requirement enough for controller review;
- a requirement design is ready for intake;
- an option comparison needs a controller/user decision;
- open questions or risks should be preserved without becoming TODOs.

## Interaction First

Default to conversation. Use this skill to summarize handoff readiness, separate
facts from recommendations, name missing upstream Design work, and recommend the
next skill or controller action before writing any tracked handoff artifact.

Do not create or update handoff documents, deliver to the controller TODO
board, or write workspace intake records as the first action. Write files only when the user/controller
explicitly asks for a tracked artifact, confirms that the proposed content
should be recorded, or a controller state root assigns a write deliverable. If a
write is justified, state what will be written and why before editing.

## Workflow

1. Read the source artifacts.
   - clarification notes;
   - original plan;
   - requirement design;
   - option plan;
   - prior Design signal;
   - relevant code/docs references.
2. Deduplicate.
   - Do not copy full documents already available by path.
   - Quote only short decision-critical snippets when necessary.
3. Separate fact, suggestion, and decision.
   - Facts are verified from source artifacts or code/docs.
   - Suggestions are Design recommendations.
   - Decisions belong to user/controller.
4. State readiness.
   - `ready-for-controller-intake`;
   - `needs-user-decision`;
   - `needs-option-planning`;
   - `needs-requirement-design`;
   - `blocked`.
5. Recommend the next Wakeflow skill or controller action; when ready, deliver
   to the controller TODO board (see Delivering to the Controller TODO).

## Handoff Format

```markdown
## Design Handoff

- Source:
- Goal:
- Confirmed decisions:
- Design recommendations:
- Open questions:
- Non-goals:
- Risks:
- Required controller judgment:
- Suggested next action:
- Suggested skills:
- Source artifacts:
- Redaction notes:
- Intake status:
```

## Delivering to the Controller TODO

When a requirement is ready for the controller, deliver it to the workspace global TODO
board with the `wakeflow_deliver` MCP tool — Design's one controller-surface write:
append-only, with no status to maintain afterward. The controller reads the row and claims
it; Design tracks no further state.

Set the delivery's immutable `Auto Claim` property deliberately:

- **`autoClaim: true`** — for a **fully designed, user-confirmed** requirement. Authorizes
  the controller to auto-claim and init it with no fresh prompt. For `type: requirement` it
  requires linked `originalPlan` + `requirementDesign`, so a not-fully-designed requirement
  cannot be made auto-claimable — that is by design, not a limitation.
- **`autoClaim: false`** (default) — when the design is ready for the controller to review
  but you want a controller/user confirmation before intake. The controller surfaces it as a
  candidate and confirms before claiming.
- Still clarifying, comparing options, or designing — do not deliver yet; keep it upstream.

Map your readiness (Workflow step 4) to the delivery: only an intake-ready design with the
upstream facts complete and user confirmation recorded should be delivered with
`autoClaim: true`; otherwise deliver with `autoClaim: false`. Deliver one item; never edit
or re-status a delivered row.

## Redaction Rules

Never include:

- API keys, tokens, secrets, or private credentials;
- real thread ids;
- local runtime-only transport data;
- unrelated personal information;
- large duplicated source artifacts.

Use paths or URLs for source artifacts whenever possible.

## Allowed Outputs

- Conversational handoff-ready summary and suggested next action.
- Design handoff document; one `wakeflow_deliver` of a ready item to the
  controller TODO board.
- Controller intake summary.
- Suggested Wakeflow skill list.

## Forbidden Outputs

- No dispatch.
- No task package creation.
- No TODO mutation.
- No product code edits.
- No acceptance or archive decision.
- No unconfirmed recommendation presented as final scope.
- No tracked handoff document or controller-TODO delivery as the first action
  without an explicit request or confirmation.

## Quality Bar

A good handoff lets the controller quickly answer: what is the goal, what has
actually been decided, what is still a suggestion, what evidence exists, and
what the next judgment should be. It fails if it duplicates whole plans,
forgets open questions, or hides a scope change inside prose.
