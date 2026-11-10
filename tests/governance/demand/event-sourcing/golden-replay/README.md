# Golden replay corpus

Each directory holds every commit file of one archived Demand, byte for byte as an earlier
Wakeflow version wrote it, with the extension changed from `.json` to `.commit` so the formatter
and linters leave the bytes alone. `demand-event-sourcing-golden-replay.test.ts` materializes
them in a disposable private root and audits them from commit 1 with the current code
(open-items C3).

Where they come from: disposable `WakeflowTestWorkspace*` environments only, never a user's real
workspace. A history is added only after a scan shows no absolute path, session or thread
identifier, credential or personal name in it; desktop-transport deliveries carry the Controller's
desktop session id in the prompt, so those are not eligible.

Adding one: copy `ledger/archives/<demandId>/<revision>/payload/event-sourcing/commits/*.json`
into a new dated directory here as `*.commit`, run the test once to read the audited values, and
register the directory in the test's table. Never edit an existing directory or its expected
values: a failure means the code no longer reads old history.
