# TODO And Window Scheduling Policy

Status: reusable workflow rule
Maintained Window: WakeflowFixture controller

TODOs are controller scheduling inputs. They do not replace goals, completion
definitions, evidence review, or user/developer confirmation.

## TODO Placement

- Design discussion: keep candidates in Design notes or handoff rows.
- Accepted but not active: record in `global-todo-board.md`.
- Affects current mainline: record in the current plan `TODO / Backlog`.
- Requires implementation: merge into a task package only after goal, boundary,
  validation, and first blocker are clear.

## Recommended Fields

| ID | Status | Type | Priority | Owner | TODO | Affects Dispatch | Dependency | Recommended Window |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

Statuses:

- `mainline`
- `parallel`
- `blocked`
- `observing`
- `in-progress`
- `review-needed`
- `completed`
- `cancelled`

## Window Scheduling

Send a window only when it has executable work within its responsibility and no
unresolved upstream dependency. Keep blocked, observing, completed, and no-task
windows visible in coverage tables without sending prompts.

Parallel work is allowed when it:

- has no file or module conflict with the mainline;
- does not guess an upstream contract;
- can be validated independently;
- closes a real TODO or prepares a real validation path.

Do not dispatch work merely to use an idle window.

## Review

At every acceptance or next-wave decision, roll TODOs explicitly:

- close with evidence;
- move to next package;
- block with dependency;
- cancel with reason;
- add newly discovered items.
