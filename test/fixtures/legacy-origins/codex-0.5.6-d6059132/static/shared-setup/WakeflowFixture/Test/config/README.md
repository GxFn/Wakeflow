# Test Configuration

Default test settings may live in `defaults.json`.

Rules:

- Keep defaults generic and workspace-relative.
- Prefer command arguments for one-off differences.
- Do not commit user absolute paths, secrets, tokens, temporary ports, process
  ids, or private machine state.
- If a setting becomes product-specific, document which controller state root or
  test card owns it.
