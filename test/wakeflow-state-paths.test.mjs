#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  resolveStateRootFilePath,
  WakeflowStatePathError,
} from "../core/scripts/lib/wakeflow-state-paths.mjs";

function fixture() {
  const base = mkdtempSync(path.join(os.tmpdir(), "wakeflow-state-paths-"));
  const stateRoot = path.join(base, "state-root");
  mkdirSync(path.join(stateRoot, "nested"), { recursive: true });
  writeFileSync(path.join(stateRoot, "nested", "existing.md"), "fixture\n");
  return { base, stateRoot };
}

function cleanup(base) {
  rmSync(base, { recursive: true, force: true });
}

test("resolveStateRootFilePath resolves an existing regular file below the state root", () => {
  const { base, stateRoot } = fixture();
  try {
    assert.equal(
      resolveStateRootFilePath(stateRoot, "nested/existing.md", {
        label: "progress doc",
        requireExisting: true,
      }),
      path.join(stateRoot, "nested", "existing.md"),
    );
  } finally {
    cleanup(base);
  }
});

test("resolveStateRootFilePath permits a missing future file only when requireExisting is false", () => {
  const { base, stateRoot } = fixture();
  try {
    const future = path.join(stateRoot, "future", "progress.md");
    assert.equal(
      resolveStateRootFilePath(stateRoot, "future/progress.md"),
      future,
    );
    assert.throws(
      () => resolveStateRootFilePath(stateRoot, "future/progress.md", {
        requireExisting: true,
      }),
      (error) => error instanceof WakeflowStatePathError
        && /does not exist/.test(error.message),
    );
  } finally {
    cleanup(base);
  }
});

test("resolveStateRootFilePath rejects absolute and escaping paths", () => {
  const { base, stateRoot } = fixture();
  try {
    assert.throws(
      () => resolveStateRootFilePath(stateRoot, path.join(base, "outside.md")),
      (error) => error instanceof WakeflowStatePathError
        && /must be relative/.test(error.message),
    );
    assert.throws(
      () => resolveStateRootFilePath(stateRoot, "../outside.md"),
      (error) => error instanceof WakeflowStatePathError
        && /below the state root/.test(error.message),
    );
    assert.throws(
      () => resolveStateRootFilePath(stateRoot, "."),
      (error) => error instanceof WakeflowStatePathError
        && /below the state root/.test(error.message),
    );
  } finally {
    cleanup(base);
  }
});

test("resolveStateRootFilePath rejects a symlinked ancestor or target", () => {
  const { base, stateRoot } = fixture();
  const outside = path.join(base, "outside");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "outside.md"), "outside\n");
  symlinkSync(outside, path.join(stateRoot, "linked-dir"), "dir");
  symlinkSync(
    path.join(outside, "outside.md"),
    path.join(stateRoot, "linked-file.md"),
  );
  try {
    assert.throws(
      () => resolveStateRootFilePath(stateRoot, "linked-dir/future.md"),
      (error) => error instanceof WakeflowStatePathError
        && /symbolic link/.test(error.message)
        && error.details.symlinkPath === path.join(stateRoot, "linked-dir"),
    );
    assert.throws(
      () => resolveStateRootFilePath(stateRoot, "linked-file.md", {
        requireExisting: true,
      }),
      (error) => error instanceof WakeflowStatePathError
        && /symbolic link/.test(error.message)
        && error.details.symlinkPath === path.join(stateRoot, "linked-file.md"),
    );
  } finally {
    cleanup(base);
  }
});

test("resolveStateRootFilePath rejects a symlinked state root", () => {
  const { base, stateRoot } = fixture();
  const linkedRoot = path.join(base, "linked-root");
  symlinkSync(stateRoot, linkedRoot, "dir");
  try {
    assert.throws(
      () => resolveStateRootFilePath(linkedRoot, "nested/existing.md", {
        requireExisting: true,
      }),
      (error) => error instanceof WakeflowStatePathError
        && /state root must not be a symbolic link/.test(error.message),
    );
  } finally {
    cleanup(base);
  }
});

test("resolveStateRootFilePath rejects directories and non-directory ancestors", () => {
  const { base, stateRoot } = fixture();
  try {
    assert.throws(
      () => resolveStateRootFilePath(stateRoot, "nested", {
        requireExisting: true,
      }),
      (error) => error instanceof WakeflowStatePathError
        && /regular file/.test(error.message),
    );
    assert.throws(
      () => resolveStateRootFilePath(stateRoot, "nested/existing.md/child.md"),
      (error) => error instanceof WakeflowStatePathError
        && /ancestor must be a directory/.test(error.message),
    );
  } finally {
    cleanup(base);
  }
});
