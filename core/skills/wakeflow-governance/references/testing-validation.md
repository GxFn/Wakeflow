# Testing And Validation Reference

## Controller Functional Acceptance Gate

**NO TEST DISPATCH WHILE TOTAL CONTROL'S CURRENT VALIDATION SCOPE IS UNFINISHED.** Violating the letter of this rule is violating its spirit.

The controller owns correctness and completion. Before Test, it must review the
actual implementation and run the strongest safe validation it can reproduce:

- Wakeflow script tests;
- document checks;
- state-machine checks;
- targeted unit tests;
- minimal probes;
- runtime JSON/log review;
- lightweight integration checks;
- the requirement's real entrypoints, inputs, outputs, state/data changes,
  consumers, failure paths, and user-visible result.

Do not send known script, code, document, or state-machine defects to Test for
rediscovery. Do not leave a missing functional check for Test to perform. A
target result, Test pass, or Test report cannot replace controller acceptance.

Record the controller's concrete reruns in the card's existing
`controllerSelfChecks`. Every active/open non-Test target must be `accepted`
before the Test package is added or dispatched; canonical `superseded`
replacement history is excluded from that open set. Test-only
reproduction and environment-diagnostic demands remain valid when the
controller has already established the current scope and records why the real
scenario is still needed.

## Test Environmental Exploration Gate

Test starts after functional acceptance. Its job is to expose environment-specific
edges and hidden bugs that remain after the confirmed chain works, using only the
requirement-stage plan. Use it for:

- cold-start or rescan;
- dashboard/manual observation;
- daemon/job/log monitoring;
- real-project reproduction or regression;
- cross-repository integration smoke.

Before handoff, write:

- the single question;
- object/window/project boundary;
- what the controller already verified;
- why a real scenario is required;
- success meaning;
- failure meaning;
- conclusions the test cannot support;
- stop conditions.

Then freeze the Test alignment contract on the Test card:

- the confirmed requirement goal;
- the requirement-stage approved Test plan items;
- the exact Test skills allowed (an empty list means none; PCV must be named);
- setup/reuse policy, attempt limit, and any restart conditions.

Test may turn approved plan items into concrete commands, but every operational
step must map back to one approved item and the requirement goal. An unmapped
goal, gate, skill, environment rebuild, or test target is a blocked change
request to the controller, not something Test may execute speculatively.

For Pod Test, prepare the access plan only after every frozen product worktree
is bound, then record the independent Test window's exact probe. Only
`validated` + `direct-multi-root` coverage of every active product binding
opens dispatch. `unsupported` remains blocked; never replace Test with a
product window, read a main checkout, or claim an unverified per-repository
executor.

| Shortcut | Reality |
|---|---|
| “Test will prove the feature works.” | Total control must already have proved and accepted that. |
| “A Test pass closes missing controller evidence.” | It only narrows the approved environmental risk. |
| “A Test failure means the whole design is wrong.” | It is a defect signal to classify against the accepted goal and exact environment. |

## Acceptance Review

Acceptance requires raw evidence:

- commits or changed files;
- command output;
- runtime JSON;
- logs;
- reports;
- screenshots when relevant;
- evidence paths.

Backfill prose is input, not proof. The controller must review the actual
evidence before accepting, reworking, blocking, or dispatching the next package.
Test evidence is reviewed as environmental risk evidence, never as retroactive
proof of functional completeness. If Test finds a real defect, the controller
reopens the owning product task with the reproduced boundary and raw evidence;
if Test finds none, the controller closes only the stated environmental risk.
The controller must also compare the returned step-to-anchor map with the same
Test alignment contract used at dispatch. Never adopt a Test-invented node or
goal into the next rework merely because the target already spent time on it.
