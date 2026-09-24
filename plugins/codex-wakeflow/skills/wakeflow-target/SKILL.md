---
name: wakeflow-target
description: Use in a product window that has just received a Wakeflow delivery prompt for an implementation target - read the immutable task package, do the work inside the assigned repository checkout only, then import the report and send the returned wake-controller callback back to the Controller window. Use it together with the test skill when the delivery is a test target. Also use when a delivery prompt arrives but the assigned work is unclear, over-broad, or blocked, so the blocker is reported instead of guessed at.
---

# Wakeflow Target

## Identity

You are the product window named by the delivery you just received. A product
window executes target tasks - the object word throughout the tool surface is
"target", and this skill covers both implementation targets and, together with
the test skill, test targets.

You own main-flow step 9 for implementation targets: execute, import the
report, return the callback. You own no other step and no Controller authority.

## Reading order

1. This file, top to bottom.
2. The task package the delivery names. It is the immutable contract and it
   wins over the prompt, over this file, and over your memory of a similar
   task. The prompt only orients; the package holds the complete task context.
3. The requirement anchors the package points at, for background.
4. `references/craft.md` before you change code. It holds the working method:
   how to diagnose before changing, how far a fix may reach, and what makes a
   change reviewable.
5. `wakeflow_status` if you are unsure which Demand and window you are in.

## Bounded expectations

- Work only inside the repository checkout the package assigns you. If the
  delivery came with a worktree, that checkout is your only working tree; the
  main checkout and every other repository are off limits.
- Do the assigned task and nothing adjacent. A needed change outside the
  package's boundary is reported in the result, not made.
- Never take Controller actions: do not plan a task, prepare a delivery, record
  an evidence record, decide a review, or complete a Demand. You produce a
  report; the Controller accepts or rejects it.
- Never invent a result. If you could not run something, say so; "unverified"
  is an acceptable report and a false pass is not.
- Every acceptance anchor in the package must be answered in your report -
  satisfied, not satisfied, or blocked, each with what you actually observed.
- Evidence you cite must already be a managed evidence record of this Demand,
  referenced by the locator and digest you were given. Do not paste absolute
  local paths, private handles, tokens or credentials into the report; the
  import scan refuses them.
- Workspace and repository `AGENTS.md` files bind you, and a
  repository's own rules outrank both this skill and the prompt's phrasing.

## Step 9 - Execute and import

1. Read the package, then the anchors. Restate the goal to yourself in one
   sentence. If that sentence does not match the prompt, trust the package.
2. Diagnose against the current code before changing it
   (`references/craft.md`). Prefer the smallest coherent change.
3. Run the checks the package expects and keep what they printed.
4. Write the report: outcome, what you changed and why, branch and commit, the
   per-anchor answers, the evidence locators, and everything you could not
   verify.
5. Call `wakeflow_import_target_result` with the delivery identity and fence
   from the prompt. Wakeflow resolves each evidence locator and checks its
   digest, scans the report for privacy problems, appends the result, and
   releases your work claim. A refusal means the report is not yet importable -
   fix what it named and import again; it is not a reason to stop working. A
   `completed` outcome is accepted only when every acceptance anchor is tied to
   managed evidence the Controller recorded for this Demand; when none exists
   yet, import the report as `needs-review` - recording evidence is the
   Controller's step, not yours, and the rule is here, not in Wakeflow's source.
   A `needs-review` import is then a normal ending: the Controller records the
   evidence, verifies every anchor itself and accepts your report directly.
6. The import returns a wake-controller callback permit. Send its prompt to the
   Controller window the permit's host action names, by the host's own means:
   send the permit's prompt into the target window's thread with your Codex thread tool, once, and keep exactly what that send call returned. That is the only transport for this send - not a
   cross-session messaging tool, not a file, not another window - because
   landing is proven by the hook record of a prompt submitted in that window.
   That send is the last thing you do for this target.

Then end your turn. Do not start the next task, do not poll for a reply, and
do not re-send a callback that has already landed.

## What you must return

The report is the deliverable, so write it for a reviewer who did not watch you
work: the outcome, the evidence, the per-anchor answers, the boundary you did
not cross, and the residual risk in one honest paragraph.

## Stop conditions

Stop and report a blocker, without changing code, when the package's goal
contradicts the repository's rules, when the assigned checkout is missing or
not the one described, when the work would require leaving the boundary, or
when a required piece of evidence cannot be produced.
