# Wakeflow Runtime Entrypoints

This directory is the packaged backend catalog for Wakeflow v3. Installed
workspace controllers use the named MCP tools and Skills; they do not select
internal modules or infer command flags from this directory.

## Entrypoints

- `wakeflow-cli.mjs` is the bounded-stdin mirror of the public MCP surface. It
  accepts one exact `{ "tool": "...", "arguments": { ... } }` request and
  dispatches the same registered v3 handler as MCP.
- `wakeflow-setup.mjs` is the maintenance-only backend for
  `wakeflow_maintain_workspace`. It owns `fresh-initialize`, `reconfigure`, and
  `reconcile` preview/apply/recover requests and does not admit migration.
- `wakeflow-bootstrap.mjs` is the explicit-migration backend reached only by
  the fixed sibling `bin/wakeflow-bootstrap` launcher. It is not registered as
  an MCP tool, package command, or normal-runtime fallback.
- `wakeflow-smoke.mjs` verifies the packaged v3 artifact in disposable
  Git-backed workspaces without contacting a real host session.
- `wakeflow-validate.mjs` validates package shape, public exports, schemas,
  Skills, host seams, import boundaries, and shared-core parity.
- `wakeflow-core-manifest.json` records the exact files synchronized from the
  canonical `core/` tree. It is data, not an executable entrypoint.

Modules under `scripts/lib/` are implementation owners, not a second public
CLI. Normal runtime reaches them only through the registered MCP/CLI and
maintenance graphs. Migration parsers and transforms are reachable only from
the explicit bootstrap graph; normal runtime must not import them.

## Supported Routes

| Need | Route |
| --- | --- |
| Normal installed-workspace operation | Use the exact Wakeflow MCP tool. |
| Source-level public handler probe | Send one bounded JSON request to `node scripts/wakeflow-cli.mjs --request-stdin --json`. |
| Workspace initialization or maintenance | Use `wakeflow_maintain_workspace`, whose backend is `wakeflow-setup.mjs`. |
| User-confirmed legacy migration | Invoke the selected artifact's `bin/wakeflow-bootstrap` with zero arguments and one preview/apply/recover request on stdin. |
| Validate this artifact | Run `node scripts/wakeflow-validate.mjs --root .`. |
| Disposable packaged smoke | Run `node scripts/wakeflow-smoke.mjs`. |

Migration is never an implicit compatibility fallback. A normal request that
encounters legacy material reports the migration requirement instead of
executing a retired writer or guessing ownership.

## Source-Repository Verification

When maintaining Wakeflow itself, run verification from the repository root:

- `npm run sync:core`
- `npm run check:core`
- `npm run validate`
- `npm run validate:claude`
- `npm run smoke`
- `npm run smoke:claude`
- focused `node --test ...` coverage while iterating
- `npm test` before release-ready handoff

The source repository owns test fixtures and release checks. Installed plugin
artifacts intentionally do not ship the development test tree.
