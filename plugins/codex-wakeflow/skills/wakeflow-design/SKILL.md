---
name: wakeflow-design
description: Use when a Wakeflow Design window needs to clarify a requirement, compare options, prepare or revise a requirement design, propose vertical work slices, or deliver a confirmed design to its controller.
---

# Wakeflow Design

**DESIGN MAY DRAFT; ONLY AN EXPLICITLY CONFIRMED DESIGN MAY BE SUBMITTED WITH `wakeflow_deliver`.** Violating the letter of this rule is violating its spirit.

## Wakeflow Role

Design turns user intent and verified facts into controller-reviewable design
input. Design may inspect assigned context and product sources read-only, discuss
alternatives, and create an authorized draft. The controller remains the owner
of durable authority, TODO state, execution planning, dispatch, review,
acceptance, and archive decisions.

Default to conversation. Create or update a draft only when the user or
controller explicitly requests a persistent artifact, confirms that the
proposed content should be recorded, or assigns a Design deliverable that
requires one. A draft path, title, or `confirmed` label does not make it demand
authority.

## Source Skills Used

- `define-goal`, `grill-me`, and `grill-with-docs`: measurable outcome,
  evidence, bounded scope, non-goals, stop conditions, terminology checks, and
  one consequential question at a time.
- `feature-design-assistant`, `senior-architect`, and `zoom-out`: real
  alternatives, boundaries, interfaces, data ownership, failure modes,
  rollout, reversibility, and validation.
- `to-prd`, `agile-product-owner`, and `to-issues`: user stories, testing
  decisions, INVEST checks, tracer-bullet vertical slices, dependencies, and
  HITL/AFK labeling.
- `handoff` and `planning-with-files`: compact source references, redaction,
  and explicit separation of fact, recommendation, and decision.

The focused references preserve these methods while applying Wakeflow's role
and delivery boundaries.

## Route The Work

Read every reference needed for the assigned Design request, and no unrelated
method:

| Need | Required reference |
| --- | --- |
| Resolve fuzzy intent or a missing decision | [Clarification](references/clarification.md) |
| Compare two or more viable directions | [Option planning](references/option-planning.md) |
| Draft or revise controller-intake design | [Requirement design](references/requirement-design.md) |
| Propose independently valuable implementation candidates | [Work slicing](references/work-slicing.md) |
| Check readiness and submit confirmed input | [Design handoff](references/design-handoff.md) |

Use these assets only for an explicitly requested persistent draft:

- [Original plan asset](assets/original-plan.md)
- [Requirement design asset](assets/requirement-design.md)

## Workflow

1. Read the assigned Design request, user decisions, cited requirement
   evidence, and only the relevant code/docs needed to establish facts.
2. Separate verified facts, Design recommendations, user/controller decisions,
   assumptions, and open questions.
3. Run the smallest focused method that removes the current Design gap.
4. Draft in conversation first. If a persistent artifact is explicitly
   authorized, instantiate the matching asset in the Design-owned draft
   location and return its portable reference.
5. Ask for explicit confirmation of the goal, scope, non-goals, completion
   evidence, landing intent, testing decision, and remaining user decisions.
6. If confirmation or required authority input is missing, keep the work as a
   draft and report the exact blocker.
7. After explicit confirmation of both the design and its submission, follow
   the exact TODO-row procedure in [Design handoff](references/design-handoff.md)
   and call `wakeflow_deliver` once. The append creates controller intake; it
   does not validate or freeze complete demand authority. Treat the appended
   row as controller-owned and do not edit or re-status it.

## Allowed Outputs

- Conversational clarification, option comparison, and Design advice.
- Explicitly authorized original-plan or requirement-design drafts.
- Candidate vertical slices and landing suggestions for controller judgment.
- One `wakeflow_deliver` TODO submission after explicit confirmation, complete
  Design references, and an exact current-board CAS.

## Forbidden Outputs

- Do not edit product code, product tests, product configuration, or product
  documentation.
- Do not hand-edit the global TODO/Backlog, controller state roots, ledgers,
  events, task packages, dispatch packets, prompts, or acceptance records.
- Do not dispatch implementation, claim work, accept/reject target results,
  archive a demand, or make the final product decision.
- Do not present an unconfirmed recommendation as executable scope.
- Do not persist secrets, credentials, private host handles, local absolute
  paths, or duplicated source artifacts.

## Quality Bar

The output must let the controller distinguish what is known, what was
confirmed, what Design recommends, what remains open, how completion can be
observed, and whether the testing decision is complete. The controller must
still resolve the submitted references and include complete demand authority
in the initial `wakeflow_create_demand` publication whenever the demand will
need a TaskPackage. The current public surface cannot add or freeze authority
after a no-authority demand has been published. If any required Design fact is
missing, return a bounded draft or blocker instead of delivering.
