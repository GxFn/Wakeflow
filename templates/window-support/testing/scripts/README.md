# Test Scripts

Use this directory for Test-owned helper scripts such as real-project smoke
checks, reproduction probes, runtime monitoring helpers, and evidence
collection.

Scripts here should:

- resolve paths from the parent workspace or from explicit command arguments;
- avoid committed user absolute paths, secrets, tokens, and temporary ports;
- write raw evidence only under ignored `tmp/` unless the state root requires a
  durable report;
- avoid modifying product repositories unless the current test card explicitly
  authorizes a fixture or harness change;
- print concise evidence that the controller can review.

Wakeflow governance, delivery, state-root, and validation scripts stay in the
installed Wakeflow runtime.
