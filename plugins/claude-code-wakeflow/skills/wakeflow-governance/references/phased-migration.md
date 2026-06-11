# Phased Migration Reference

Use this reference for cross-repository migration, capability extraction,
cleanup, deletion, and release closure.

## Principles

- Fix shared capabilities in their owning source repository first.
- Use local configured source repositories for development and acceptance when
  available.
- Check vendor, submodule, remote pointers, or package snapshots only for
  release, plugin runtime, npm package, offline install, remote CI, or explicit
  state-root requirements.
- Do not mix copy, integration, deletion, test repair, and release-script
  changes into one unrecoverable phase.

## Contract-Only Work

Contract-only phases are allowed only when they name:

- the consumer;
- how the consumer will use the contract;
- the next phase that connects it;
- targeted verification.

No empty adapters, empty providers, unused interfaces, or type-only work may be
marked complete.

## Deletion Gate

Delete only replaced duplicate implementation. Before deleting, prove:

- import/reference scan is clean;
- replacement entrypoint is connected;
- representative build/check/lint/smoke passed;
- consumers and fallback paths are known.

Temporary compatibility code must record consumer, reason, removal condition,
cleanup trigger, and owner. Do not keep compatibility code without a consumer
and cleanup plan.
