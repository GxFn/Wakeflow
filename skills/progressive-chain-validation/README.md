# Progressive Chain Validation Workspace Bridge

Development source: https://github.com/GxFn/progressive-chain-validation.git

Current observed upstream HEAD: `3322646aa57c67c164eec20626ec5edd9d05b113`

Owner: GxFn

Workspace role:

- Treat this directory as the ControlWorkspace bridge into the external PCV
  canonical source repository.
- `SKILL.md` is a lightweight routing skill for workspace use; canonical PCV
  method instructions, references, templates, and source changes remain in the
  independent `progressive-chain-validation/` checkout.
- Workspace owns the state machine. PCV node status is recorded inside
  Workspace current / ledger documents as canonical Workspace status plus PCV
  evidence labels; this bridge must not become a second state authority.
- Keep active PCV source development in the independent source repository only
  when the user wants ControlWorkspace to manage PCV source changes.
- Do not assume it is installed in Codex runtime unless a sync/link step has
  been performed and recorded.
- When pulling or syncing from the upstream repository, record the source commit
  and any local changes in the relevant workspace control document.

Intended use:

- Progressive validation of multi-step agent work.
- Useful as a complement to workspace acceptance scripts when a task needs
  staged evidence rather than one final status check.

Current contents:

- `SKILL.md` records the workspace consumption path and handoff boundaries.
- The upstream repository stores the canonical method package under
  `progressive-chain-validation/`.
