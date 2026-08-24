# Data Location Preflight

`N0-data-location` is mandatory before validating any chain that may read or write runtime data, generated knowledge, database files, candidates, reports, delivery output, project skills, IDE integration files, or user-global configuration.

The goal is to prove where the source tree lives, where runtime writes would go, and whether those writes are approved before any mutating command runs.

## Required Facts

Record these fields in the N0 data-location section of `report/plan.md`. Use an attachment only when the fact payload is too large to keep readable.

```json
{
  "targetProjectRoot": "/absolute/path/to/target-project",
  "projectRealpath": "/absolute/realpath/to/target-project",
  "sourceRepositoryRoot": "/absolute/path/to/source-repo-or-n/a",
  "runtimeRoot": "/absolute/path/to/runtime-root-or-n/a",
  "runtimeRootSource": "config|env|registry|default|adapter|n/a",
  "workspaceRoot": "/absolute/path/to/workspace-or-n/a",
  "databasePath": "/absolute/path/to/database-or-n/a",
  "generatedOutputRoot": "/absolute/path/to/generated-output-or-n/a",
  "deliveryOutputRoot": "/absolute/path/to/delivery-output-or-n/a",
  "integrationFiles": [
    "/absolute/path/to/integration-file-or-dir"
  ],
  "writeMode": "read-only|isolated-sandbox|local-runtime|live-target|unknown",
  "sourceTreeMutationAllowed": false,
  "runtimeMutationAllowed": false,
  "requiresUserConfirmation": true,
  "adapter": "none|workspace-specific|other",
  "adapterFacts": {}
}
```

## Rules

- Store expanded absolute paths in the plan's N0 evidence table or in a linked attachment.
- Do not store `~`, `$HOME`, environment substitutions, or relative paths as evidence values.
- `targetProjectRoot` is the real source project used for code analysis.
- `runtimeRoot` is the root for runtime data, generated project state, caches, databases, or knowledge writes.
- `generatedOutputRoot` and `deliveryOutputRoot` identify user-visible generated files separately from transient runtime state.
- In an isolated sandbox mode, runtime writes must not land in the source repository unless the user explicitly asked for that source tree mutation.
- If a project adapter exposes a resolver or registry, record facts from that resolver instead of guessing from filenames.
- Continue only after the write boundary is clear and acceptable.

## Source Checks

For source repositories, record:

- Repository root and realpath.
- Whether the repo is the tool/application being developed or a target project being acted on by that tool.
- Existing generated/runtime directories that must be ignored or preserved.
- Files, directories, and environment variables that decide runtime output locations.
- Whether the current node is allowed to edit source files, runtime data, both, or neither.

For external projects, record:

- Realpath of the target project.
- Whether runtime data will be isolated from the target source tree.
- Whether live project files can be mutated.
- Cleanup and reset rules for every write surface.

## Isolated Real-Project Runs

When validating against a real external project, prefer an isolated runtime before touching the user's live workspace:

1. Create `scratch/chain-runs/<run-id>/isolated-runtime` or a similarly named run-local directory.
2. Point the validated tool's home/config/runtime environment to that isolated directory when the tool supports it.
3. Register or configure the real project inside the isolated runtime if needed.
4. Record every resulting source, runtime, database, generated output, and delivery path.
5. Mark `writeMode` as `isolated-sandbox` and note whether the real source tree is read-only for the run.

If the objective is to validate the live workspace itself, record that as `live-target` and ask before destructive cleanup or broad mutation.

## Adapter Extensions

Workspace-specific adapters may require additional facts. Load only the adapter
named by the active controller state root, test card, or repository rules, then
copy its required fields into `adapterFacts`.

## N0 Decision

- Pass when every path is absolute or explicitly `n/a`, and the write boundary is safe.
- Block when runtime writes would land inside a source repository without explicit approval.
- Block when the external project path is unknown or not approved for mutation.
- Continue with read-only source analysis if the current node does not need runtime writes.
