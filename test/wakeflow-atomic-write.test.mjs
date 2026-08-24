#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  inspectFutureFileInside,
  WakeflowFsSafetyError,
} from "../core/scripts/lib/wakeflow-fs-safety.mjs";
import {
  atomicWriteFile,
  WakeflowAtomicWriteError,
} from "../core/scripts/lib/wakeflow-atomic-write.mjs";

function fixture() {
  const base = mkdtempSync(path.join(os.tmpdir(), "wakeflow-atomic-write-"));
  const root = path.join(base, "root");
  mkdirSync(path.join(root, "nested"), { recursive: true });
  return { base, root };
}

function cleanup(base) {
  rmSync(base, { recursive: true, force: true });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function modeOf(file) {
  return statSync(file).mode & 0o777;
}

function stageEntries(directory) {
  return readdirSync(directory).filter((entry) => entry.includes(".wakeflow-stage-"));
}

function posixAtomicTest(name, fn) {
  return test(name, {
    skip: process.platform === "win32"
      ? "atomic file-mode semantics are unsupported on Windows"
      : false,
  }, fn);
}

test("inspectFutureFileInside validates a future missing target without requiring it to exist", () => {
  const { base, root } = fixture();
  try {
    const target = path.join(root, "future", "nested", "record.json");
    const inspected = inspectFutureFileInside({ root, candidate: target, label: "record" });
    assert.equal(inspected.lexicalCandidate, target);
    assert.equal(inspected.targetType, "absent");
    assert.equal(inspected.nearestExistingAncestor, root);
    assert.deepEqual(inspected.missingSegments, ["future", "nested", "record.json"]);
  } finally {
    cleanup(base);
  }
});

test("inspectFutureFileInside rejects decorated input without executing path accessors", () => {
  let getterCalls = 0;
  const input = {};
  Object.defineProperty(input, "root", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("path getter must not execute");
    },
  });
  assert.throws(
    () => inspectFutureFileInside(input),
    (error) => error instanceof WakeflowFsSafetyError && error.code === "invalid-input",
  );
  assert.equal(getterCalls, 0);
});

test("atomicWriteFile fails closed without writing on Windows", {
  skip: process.platform !== "win32" ? "Windows-only platform contract" : false,
}, () => {
  const { base, root } = fixture();
  const target = path.join(root, "nested", "record.json");
  try {
    assert.throws(
      () => atomicWriteFile({
        root,
        target,
        content: "must not be written",
        expectation: { type: "absent" },
      }),
      (error) => error instanceof WakeflowAtomicWriteError
        && error.code === "unsupported-platform"
        && error.details.platform === "win32",
    );
    assert.equal(fs.existsSync(target), false);
    assert.deepEqual(stageEntries(path.dirname(target)), []);
  } finally {
    cleanup(base);
  }
});

posixAtomicTest("atomicWriteFile creates an absent file with default 0600 mode through a same-directory wx stage", (t) => {
  const { base, root } = fixture();
  const target = path.join(root, "nested", "record.json");
  const originalOpen = fs.openSync;
  const originalRename = fs.renameSync;
  let observedFlags = null;
  let observedStage = null;
  t.mock.method(fs, "openSync", (file, flags, mode) => {
    if (String(file).includes(".wakeflow-stage-")) observedFlags = flags;
    return originalOpen(file, flags, mode);
  });
  t.mock.method(fs, "renameSync", (source, destination) => {
    observedStage = source;
    assert.equal(path.dirname(source), path.dirname(target));
    assert.equal(destination, target);
    assert.equal(statSync(source).isFile(), true);
    originalRename(source, destination);
  });
  try {
    const result = atomicWriteFile({
      root,
      target,
      content: "new bytes\n",
      expectation: { type: "absent" },
    });
    assert.equal(readFileSync(target, "utf8"), "new bytes\n");
    assert.equal(modeOf(target), 0o600);
    assert.equal(result.previous.type, "absent");
    assert.equal(result.current.sha256, sha256("new bytes\n"));
    assert.equal(result.commit, "same-directory-rename");
    assert.match(path.basename(observedStage), /^\.record\.json\.wakeflow-stage-/);
    assert.equal((observedFlags & fs.constants.O_CREAT) !== 0, true);
    assert.equal((observedFlags & fs.constants.O_EXCL) !== 0, true);
    assert.deepEqual(stageEntries(path.dirname(target)), []);
  } finally {
    cleanup(base);
  }
});

posixAtomicTest("atomicWriteFile replaces only the exact expected regular file digest and applies an explicit mode", () => {
  const { base, root } = fixture();
  const target = path.join(root, "nested", "record.json");
  writeFileSync(target, "old bytes\n", { mode: 0o600 });
  try {
    const result = atomicWriteFile({
      root,
      target,
      content: Buffer.from("replacement\n"),
      expectation: { type: "file", sha256: sha256("old bytes\n") },
      mode: 0o640,
    });
    assert.equal(readFileSync(target, "utf8"), "replacement\n");
    assert.equal(modeOf(target), 0o640);
    assert.equal(result.previous.sha256, sha256("old bytes\n"));
    assert.equal(result.current.sha256, sha256("replacement\n"));

    assert.throws(
      () => atomicWriteFile({
        root,
        target,
        content: "must not land\n",
        expectation: { type: "file", sha256: sha256("stale bytes\n") },
      }),
      (error) => error instanceof WakeflowAtomicWriteError
        && error.code === "expectation-mismatch"
        && error.details.actual.sha256 === sha256("replacement\n"),
    );
    assert.equal(readFileSync(target, "utf8"), "replacement\n");
  } finally {
    cleanup(base);
  }
});

posixAtomicTest("atomicWriteFile requires an explicit absent or file+sha256 expectation", () => {
  const { base, root } = fixture();
  const target = path.join(root, "nested", "record.json");
  try {
    for (const expectation of [undefined, {}, { type: "file" }, { type: "directory" }]) {
      assert.throws(
        () => atomicWriteFile({ root, target, content: "bytes", expectation }),
        (error) => error instanceof WakeflowAtomicWriteError
          && error.code === "invalid-expectation",
      );
    }
    assert.throws(
      () => atomicWriteFile({
        root,
        target,
        content: "bytes",
        expectation: { type: "absent" },
        mode: 0o1000,
      }),
      (error) => error instanceof WakeflowAtomicWriteError
        && error.code === "invalid-mode",
    );
    atomicWriteFile({ root, target, content: "first", expectation: { type: "absent" } });
    assert.throws(
      () => atomicWriteFile({ root, target, content: "second", expectation: { type: "absent" } }),
      (error) => error instanceof WakeflowAtomicWriteError
        && error.code === "expectation-mismatch"
        && error.details.actual.type === "file",
    );
    rmSync(target);
    assert.throws(
      () => atomicWriteFile({
        root,
        target,
        content: "second",
        expectation: { type: "file", sha256: sha256("first") },
      }),
      (error) => error instanceof WakeflowAtomicWriteError
        && error.code === "expectation-mismatch"
        && error.details.actual.type === "absent",
    );
  } finally {
    cleanup(base);
  }
});

posixAtomicTest("atomicWriteFile rejects decorated operation and expectation objects without executing accessors", () => {
  const { base, root } = fixture();
  const target = path.join(root, "nested", "record.json");
  let optionGetterCalls = 0;
  let expectationGetterCalls = 0;
  try {
    const decoratedOptions = {
      target,
      content: "must not be written",
      expectation: { type: "absent" },
    };
    Object.defineProperty(decoratedOptions, "root", {
      enumerable: true,
      get() {
        optionGetterCalls += 1;
        throw new Error("operation getter must not execute");
      },
    });
    assert.throws(
      () => atomicWriteFile(decoratedOptions),
      (error) => error instanceof WakeflowAtomicWriteError
        && error.code === "invalid-options",
    );
    assert.equal(optionGetterCalls, 0);
    assert.equal(fs.existsSync(target), false);

    const decoratedExpectation = {};
    Object.defineProperty(decoratedExpectation, "type", {
      enumerable: true,
      get() {
        expectationGetterCalls += 1;
        throw new Error("expectation getter must not execute");
      },
    });
    assert.throws(
      () => atomicWriteFile({
        root,
        target,
        content: "must not be written",
        expectation: decoratedExpectation,
      }),
      (error) => error instanceof WakeflowAtomicWriteError
        && error.code === "invalid-expectation",
    );
    assert.equal(expectationGetterCalls, 0);
    assert.equal(fs.existsSync(target), false);
  } finally {
    cleanup(base);
  }
});

posixAtomicTest("atomicWriteFile rejects hidden operation fields and behavioral mixed-owned verdicts", () => {
  const { base, root } = fixture();
  const target = path.join(root, "nested", "settings.json");
  const original = '{"userKey":"preserve","managed":false}\n';
  writeFileSync(target, original);
  let verdictGetterCalls = 0;
  try {
    const decoratedOptions = {
      root,
      target,
      content: "must not land",
      expectation: { type: "file", sha256: sha256(original) },
    };
    Object.defineProperty(decoratedOptions, "hidden", {
      enumerable: false,
      value: true,
    });
    assert.throws(
      () => atomicWriteFile(decoratedOptions),
      (error) => error instanceof WakeflowAtomicWriteError
        && error.code === "invalid-options",
    );
    assert.equal(readFileSync(target, "utf8"), original);

    assert.throws(
      () => atomicWriteFile({
        root,
        target,
        content: '{"userKey":"preserve","managed":true}\n',
        expectation: { type: "file", sha256: sha256(original) },
        ownership: "mixed-owned",
        mixedOwnedGuard: () => {
          const verdict = {};
          Object.defineProperty(verdict, "ok", {
            enumerable: true,
            get() {
              verdictGetterCalls += 1;
              throw new Error("verdict getter must not execute");
            },
          });
          return verdict;
        },
      }),
      (error) => error instanceof WakeflowAtomicWriteError
        && error.code === "mixed-owned-guard-rejected",
    );
    assert.equal(verdictGetterCalls, 0);
    assert.equal(readFileSync(target, "utf8"), original);
    assert.deepEqual(stageEntries(path.dirname(target)), []);
  } finally {
    cleanup(base);
  }
});

posixAtomicTest("atomicWriteFile rechecks the exact source after staging and cleans the rejected stage", (t) => {
  const { base, root } = fixture();
  const target = path.join(root, "nested", "record.json");
  const original = "original\n";
  const changed = "changed by another owner\n";
  writeFileSync(target, original);
  const originalWrite = fs.writeFileSync;
  let sourceChanged = false;
  t.mock.method(fs, "writeFileSync", (file, value, options) => {
    const result = originalWrite(file, value, options);
    if (typeof file === "number" && !sourceChanged) {
      sourceChanged = true;
      originalWrite(target, changed);
    }
    return result;
  });
  try {
    assert.throws(
      () => atomicWriteFile({
        root,
        target,
        content: "must not replace the changed source\n",
        expectation: { type: "file", sha256: sha256(original) },
      }),
      (error) => error instanceof WakeflowAtomicWriteError
        && error.code === "expectation-mismatch"
        && error.details.actual.sha256 === sha256(changed),
    );
    assert.equal(readFileSync(target, "utf8"), changed);
    assert.deepEqual(stageEntries(path.dirname(target)), []);
  } finally {
    cleanup(base);
  }
});

posixAtomicTest("atomicWriteFile rechecks after a mixed-owned guard that mutates the source", () => {
  const { base, root } = fixture();
  const target = path.join(root, "nested", "settings.json");
  const original = '{"userKey":"preserve","managed":false}\n';
  const changed = '{"userKey":"changed","managed":false}\n';
  writeFileSync(target, original);
  try {
    assert.throws(
      () => atomicWriteFile({
        root,
        target,
        content: '{"userKey":"preserve","managed":true}\n',
        expectation: { type: "file", sha256: sha256(original) },
        ownership: "mixed-owned",
        mixedOwnedGuard: ({ phase }) => {
          if (phase === "before-rename") writeFileSync(target, changed);
          return { ok: true };
        },
      }),
      (error) => error instanceof WakeflowAtomicWriteError
        && error.code === "expectation-mismatch"
        && error.details.actual.sha256 === sha256(changed),
    );
    assert.equal(readFileSync(target, "utf8"), changed);
    assert.deepEqual(stageEntries(path.dirname(target)), []);
  } finally {
    cleanup(base);
  }
});

posixAtomicTest("atomicWriteFile rejects a missing parent without creating directories or stages", () => {
  const { base, root } = fixture();
  const missingParent = path.join(root, "future", "nested");
  const target = path.join(missingParent, "record.json");
  try {
    assert.throws(
      () => atomicWriteFile({
        root,
        target,
        content: "must not create parents",
        expectation: { type: "absent" },
      }),
      (error) => error instanceof WakeflowAtomicWriteError
        && error.code === "parent-missing"
        && error.details.nearestExistingAncestor === root,
    );
    assert.equal(fs.existsSync(missingParent), false);
    assert.deepEqual(stageEntries(root), []);
  } finally {
    cleanup(base);
  }
});

posixAtomicTest("write safety rejects lexical escape and root, ancestor, or target symlink/type changes", () => {
  const { base, root } = fixture();
  const outside = path.join(base, "outside");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "outside.json"), "outside\n");
  try {
    assert.throws(
      () => atomicWriteFile({
        root,
        target: path.join(root, "..", "escape.json"),
        content: "escape",
        expectation: { type: "absent" },
      }),
      (error) => error instanceof WakeflowFsSafetyError
        && error.code === "lexical-containment",
    );

    const linkedRoot = path.join(base, "linked-root");
    symlinkSync(root, linkedRoot, "dir");
    assert.throws(
      () => inspectFutureFileInside({ root: linkedRoot, candidate: path.join(linkedRoot, "new.json") }),
      (error) => error instanceof WakeflowFsSafetyError && error.code === "root-symlink",
    );

    const fileRoot = path.join(base, "file-root");
    writeFileSync(fileRoot, "not a root");
    assert.throws(
      () => inspectFutureFileInside({ root: fileRoot, candidate: path.join(fileRoot, "new.json") }),
      (error) => error instanceof WakeflowFsSafetyError && error.code === "root-type",
    );

    symlinkSync(outside, path.join(root, "linked-parent"), "dir");
    assert.throws(
      () => atomicWriteFile({
        root,
        target: path.join(root, "linked-parent", "new.json"),
        content: "escape",
        expectation: { type: "absent" },
      }),
      (error) => error instanceof WakeflowFsSafetyError
        && error.code === "ancestor-symlink",
    );

    writeFileSync(path.join(root, "file-parent"), "not a directory");
    assert.throws(
      () => inspectFutureFileInside({
        root,
        candidate: path.join(root, "file-parent", "new.json"),
      }),
      (error) => error instanceof WakeflowFsSafetyError && error.code === "ancestor-type",
    );

    symlinkSync(path.join(outside, "outside.json"), path.join(root, "linked-target.json"));
    assert.throws(
      () => atomicWriteFile({
        root,
        target: path.join(root, "linked-target.json"),
        content: "escape",
        expectation: { type: "file", sha256: sha256("outside\n") },
      }),
      (error) => error instanceof WakeflowFsSafetyError && error.code === "target-symlink",
    );

    mkdirSync(path.join(root, "directory-target"));
    assert.throws(
      () => atomicWriteFile({
        root,
        target: path.join(root, "directory-target"),
        content: "wrong type",
        expectation: { type: "absent" },
      }),
      (error) => error instanceof WakeflowFsSafetyError && error.code === "target-type",
    );
    assert.equal(readFileSync(path.join(outside, "outside.json"), "utf8"), "outside\n");
  } finally {
    cleanup(base);
  }
});

posixAtomicTest("atomicWriteFile removes its private stage when rename fails", (t) => {
  const { base, root } = fixture();
  const target = path.join(root, "nested", "record.json");
  t.mock.method(fs, "renameSync", () => {
    const error = new Error("injected rename failure");
    error.code = "EIO";
    throw error;
  });
  try {
    assert.throws(
      () => atomicWriteFile({
        root,
        target,
        content: "never committed",
        expectation: { type: "absent" },
      }),
      (error) => error instanceof WakeflowAtomicWriteError
        && error.code === "rename-failed"
        && error.details.stageDirectory === path.dirname(target),
    );
    assert.deepEqual(stageEntries(path.dirname(target)), []);
    assert.equal(fs.existsSync(target), false);
  } finally {
    cleanup(base);
  }
});

posixAtomicTest("mixed-owned writes require and honor an explicit current-bytes guard without merging", () => {
  const { base, root } = fixture();
  const target = path.join(root, "nested", "settings.json");
  const original = '{"userKey":"preserve","managed":false}\n';
  const merged = '{"userKey":"preserve","managed":true}\n';
  writeFileSync(target, original);
  const expectation = { type: "file", sha256: sha256(original) };
  const acceptedPhases = [];
  try {
    assert.throws(
      () => atomicWriteFile({
        root,
        target,
        content: merged,
        expectation,
        ownership: "mixed-owned",
      }),
      (error) => error instanceof WakeflowAtomicWriteError
        && error.code === "mixed-owned-guard-required",
    );
    assert.equal(readFileSync(target, "utf8"), original);

    assert.throws(
      () => atomicWriteFile({
        root,
        target,
        content: merged,
        expectation,
        ownership: "mixed-owned",
        mixedOwnedGuard: ({ currentBytes }) => {
          assert.equal(currentBytes.toString("utf8"), original);
          return { ok: false, reason: "managed component is not recognized" };
        },
      }),
      (error) => error instanceof WakeflowAtomicWriteError
        && error.code === "mixed-owned-guard-rejected"
        && error.details.reason === "managed component is not recognized",
    );
    assert.equal(readFileSync(target, "utf8"), original);

    const result = atomicWriteFile({
      root,
      target,
      content: merged,
      expectation,
      ownership: "mixed-owned",
      mixedOwnedGuard: ({ currentBytes, currentSha256, phase }) => {
        acceptedPhases.push(phase);
        return {
          ok: currentBytes.toString("utf8").includes('"userKey":"preserve"')
            && currentSha256 === expectation.sha256,
        };
      },
    });
    assert.equal(result.ownership, "mixed-owned");
    assert.deepEqual(acceptedPhases, ["before-stage", "before-rename"]);
    assert.equal(readFileSync(target, "utf8"), merged);
  } finally {
    cleanup(base);
  }
});
