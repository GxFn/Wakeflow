# Testing And Validation Reference

## Controller Self-Verification

The controller should run validation it can safely reproduce:

- Wakeflow script tests;
- document checks;
- state-machine checks;
- targeted unit tests;
- minimal probes;
- runtime JSON/log review;
- lightweight integration checks.

Do not send known script, code, document, or state-machine defects to Test for
rediscovery.

## Test Handoff Gate

Use Test only for real-project or runtime evidence that cannot be safely proven
by the controller or product repository:

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
The controller must also compare the returned step-to-anchor map with the same
Test alignment contract used at dispatch. Never adopt a Test-invented node or
goal into the next rework merely because the target already spent time on it.
